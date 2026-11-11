/** OIDC providers: configuration, login start, and callback handling. */

import type { OidcProviderInput, OidcProviderRow } from '@netlabor/contract';
import { AppError } from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import { decryptSecret, encryptSecret, newId, randomToken } from '@netlabor/shared';
import type { SQL } from 'bun';
import { jwtVerify, SignJWT } from 'jose';
import * as client from 'openid-client';
import type { ControllerConfig } from '../config.ts';
import { createSession, sessionCookie } from './auth.ts';

interface ProviderRecord {
  id: string;
  name: string;
  issuer: string;
  client_id: string;
  client_secret_ciphertext: Uint8Array | null;
  client_secret_nonce: Uint8Array | null;
  scopes: string[] | null;
  group_claim: string;
  group_mappings: Record<string, string> | null;
  default_role_id: string | null;
  auto_create: boolean;
  enabled: boolean;
  created_at: Date;
}

function toRow(record: ProviderRecord): OidcProviderRow {
  return {
    id: record.id,
    name: record.name,
    issuer: record.issuer,
    clientId: record.client_id,
    scopes: record.scopes ?? [],
    groupClaim: record.group_claim,
    groupMappings: parseJsonColumn(record.group_mappings, {}),
    defaultRoleId: record.default_role_id,
    autoCreate: record.auto_create,
    enabled: record.enabled,
    createdAt: record.created_at.toISOString(),
  };
}

export async function listProviders(db: SQL): Promise<OidcProviderRow[]> {
  const rows = await db.unsafe<ProviderRecord[]>(
    `SELECT id, name, issuer, client_id, client_secret_ciphertext, client_secret_nonce, scopes,
            group_claim, group_mappings, default_role_id, auto_create, enabled, created_at
       FROM oidc_providers ORDER BY name ASC`,
  );
  return rows.map(toRow);
}

async function loadProvider(db: SQL, id: string): Promise<ProviderRecord> {
  const rows = await db.unsafe<ProviderRecord[]>(
    `SELECT id, name, issuer, client_id, client_secret_ciphertext, client_secret_nonce, scopes,
            group_claim, group_mappings, default_role_id, auto_create, enabled, created_at
       FROM oidc_providers WHERE id = $1`,
    [id],
  );
  const record = rows[0];
  if (!record) throw new AppError('NOT_FOUND', 'OIDC provider not found');
  return record;
}

export async function createProvider(
  db: SQL,
  config: ControllerConfig,
  input: OidcProviderInput,
): Promise<OidcProviderRow> {
  if (!input.clientSecret) throw new AppError('BAD_REQUEST', 'clientSecret is required');
  const secret = encryptSecret(input.clientSecret, config.secretKey);
  const id = newId();
  const rows = await db.unsafe<ProviderRecord[]>(
    `INSERT INTO oidc_providers
       (id, name, issuer, client_id, client_secret_ciphertext, client_secret_nonce, scopes,
        group_claim, group_mappings, default_role_id, auto_create, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
     RETURNING id, name, issuer, client_id, client_secret_ciphertext, client_secret_nonce, scopes,
               group_claim, group_mappings, default_role_id, auto_create, enabled, created_at`,
    [
      id,
      input.name,
      input.issuer,
      input.clientId,
      secret.ciphertext,
      secret.nonce,
      input.scopes,
      input.groupClaim,
      input.groupMappings,
      input.defaultRoleId ?? null,
      input.autoCreate,
      input.enabled,
    ],
  );
  if (!rows[0]) throw new AppError('INTERNAL', 'provider insert failed');
  return toRow(rows[0]);
}

export async function updateProvider(
  db: SQL,
  config: ControllerConfig,
  input: OidcProviderInput & { id: string },
): Promise<OidcProviderRow> {
  const existing = await loadProvider(db, input.id);
  const secret = input.clientSecret ? encryptSecret(input.clientSecret, config.secretKey) : null;
  const rows = await db.unsafe<ProviderRecord[]>(
    `UPDATE oidc_providers SET
       name = $2, issuer = $3, client_id = $4,
       client_secret_ciphertext = COALESCE($5, client_secret_ciphertext),
       client_secret_nonce = COALESCE($6, client_secret_nonce),
       scopes = $7, group_claim = $8, group_mappings = $9::jsonb,
       default_role_id = $10, auto_create = $11, enabled = $12
     WHERE id = $1
     RETURNING id, name, issuer, client_id, client_secret_ciphertext, client_secret_nonce, scopes,
               group_claim, group_mappings, default_role_id, auto_create, enabled, created_at`,
    [
      input.id,
      input.name,
      input.issuer,
      input.clientId,
      secret?.ciphertext ?? null,
      secret?.nonce ?? null,
      input.scopes,
      input.groupClaim,
      input.groupMappings,
      input.defaultRoleId ?? existing.default_role_id,
      input.autoCreate,
      input.enabled,
    ],
  );
  if (!rows[0]) throw new AppError('INTERNAL', 'provider update failed');
  return toRow(rows[0]);
}

async function clientConfiguration(
  db: SQL,
  config: ControllerConfig,
  providerId: string,
): Promise<{ provider: ProviderRecord; configuration: client.Configuration; redirectUri: string }> {
  const provider = await loadProvider(db, providerId);
  if (!provider.enabled) throw new AppError('FORBIDDEN', 'provider is disabled');
  if (!provider.client_secret_ciphertext || !provider.client_secret_nonce) {
    throw new AppError('BAD_REQUEST', 'provider has no client secret');
  }
  const clientSecret = decryptSecret(
    {
      ciphertext: new Uint8Array(provider.client_secret_ciphertext),
      nonce: new Uint8Array(provider.client_secret_nonce),
    },
    config.secretKey,
  );
  // Plain-HTTP issuers are only allowed for loopback providers (local mock
  // servers) unless an administrator explicitly opts in.
  const issuerUrl = new URL(provider.issuer);
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(issuerUrl.hostname);
  const insecure =
    issuerUrl.protocol === 'http:' && (loopback || process.env.NB_ALLOW_INSECURE_OIDC === '1');
  const configuration = await client.discovery(
    new URL(provider.issuer),
    provider.client_id,
    clientSecret,
    undefined,
    insecure ? { execute: [client.allowInsecureRequests] } : undefined,
  );
  const redirectUri = `${config.publicUrl}/auth/oidc/${provider.id}/callback`;
  return { provider, configuration, redirectUri };
}

interface OidcStateCookie {
  state: string;
  nonce: string;
  verifier: string;
  providerId: string;
}

const STATE_COOKIE = 'nb_oidc';

async function signState(payload: OidcStateCookie, key: Uint8Array): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(key);
}

async function verifyState(token: string, key: Uint8Array): Promise<OidcStateCookie> {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    const { state, nonce, verifier, providerId } = payload;
    if (
      typeof state !== 'string' ||
      typeof nonce !== 'string' ||
      typeof verifier !== 'string' ||
      typeof providerId !== 'string'
    ) {
      throw new Error('malformed state');
    }
    return { state, nonce, verifier, providerId };
  } catch {
    throw new AppError('BAD_REQUEST', 'invalid or expired OIDC state');
  }
}

export async function startLogin(
  db: SQL,
  config: ControllerConfig,
  providerId: string,
): Promise<{ redirectUrl: string; cookie: string }> {
  const { configuration, redirectUri } = await clientConfiguration(db, config, providerId);
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const authorizationUrl = client.buildAuthorizationUrl(configuration, {
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  const token = await signState({ state, nonce, verifier, providerId }, config.secretKey);
  const secure = config.publicUrl.startsWith('https://') ? '; Secure' : '';
  return {
    redirectUrl: authorizationUrl.href,
    cookie: `${STATE_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`,
  };
}

export interface OidcLoginResult {
  userId: string;
  sessionCookie: string;
  redirectTo: string;
}

export async function handleCallback(
  db: SQL,
  config: ControllerConfig,
  providerId: string,
  callbackUrl: URL,
  stateCookie: string | null,
): Promise<OidcLoginResult> {
  if (!stateCookie) throw new AppError('BAD_REQUEST', 'missing OIDC state cookie');
  const state = await verifyState(stateCookie, config.secretKey);
  if (state.providerId !== providerId) throw new AppError('BAD_REQUEST', 'OIDC provider mismatch');

  const { provider, configuration } = await clientConfiguration(db, config, providerId);
  let tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;
  try {
    tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
      pkceCodeVerifier: state.verifier,
      expectedState: state.state,
      expectedNonce: state.nonce,
      idTokenExpected: true,
    });
  } catch (error) {
    throw new AppError('UNAUTHORIZED', 'OIDC code exchange failed', {
      details: error instanceof Error ? error.message : String(error),
    });
  }

  const claims = tokens.claims();
  if (!claims) throw new AppError('UNAUTHORIZED', 'OIDC provider returned no ID token claims');
  const subject = claims.sub;
  const email = typeof claims.email === 'string' ? claims.email : null;

  const identity = await db.unsafe<{ user_id: string }[]>(
    'SELECT user_id FROM user_identities WHERE provider_id = $1 AND subject = $2',
    [providerId, subject],
  );
  let userId = identity[0]?.user_id ?? null;

  if (!userId) {
    if (!provider.auto_create)
      throw new AppError('FORBIDDEN', 'no account is linked to this identity');
    userId = await provisionUser(db, provider, subject, email, claims, config);
  }

  const users = await db.unsafe<{ is_active: boolean }[]>(
    'SELECT is_active FROM users WHERE id = $1',
    [userId],
  );
  if (!users[0]?.is_active) throw new AppError('FORBIDDEN', 'account is disabled');

  const session = await createSession(db, config, userId, { ip: null, userAgent: 'oidc' });
  return {
    userId,
    sessionCookie: sessionCookie(session.token, config, session.expiresAt),
    redirectTo: '/projects',
  };
}

async function provisionUser(
  db: SQL,
  provider: ProviderRecord,
  subject: string,
  email: string | null,
  claims: Record<string, unknown>,
  _config: ControllerConfig,
): Promise<string> {
  const usernameBase = (email?.split('@')[0] ?? `oidc-${subject.slice(0, 8)}`)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  let username =
    usernameBase.length >= 3
      ? usernameBase
      : `user-${randomToken(4)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 6)}`;
  let attempt = 0;
  while (
    (await db.unsafe<{ id: string }[]>('SELECT id FROM users WHERE username = $1', [username]))[0]
  ) {
    attempt++;
    username = `${usernameBase}-${attempt}`;
    if (attempt > 50) throw new AppError('CONFLICT', 'could not allocate a unique username');
  }

  const userId = newId();
  await db.begin(async (tx) => {
    const sql = tx as SQL;
    await sql.unsafe(
      `INSERT INTO users (id, username, email, display_name, password_hash, is_active)
       VALUES ($1, $2, $3, $4, NULL, true)`,
      [userId, username, email, typeof claims.name === 'string' ? claims.name : null],
    );
    await sql.unsafe(
      'INSERT INTO user_identities (user_id, provider_id, subject, email) VALUES ($1, $2, $3, $4)',
      [userId, provider.id, subject, email],
    );
    if (provider.default_role_id) {
      await sql.unsafe(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, provider.default_role_id],
      );
    }
  });

  await applyGroupMappings(db, provider, userId, claims);
  return userId;
}

async function applyGroupMappings(
  db: SQL,
  provider: ProviderRecord,
  userId: string,
  claims: Record<string, unknown>,
): Promise<void> {
  const claimValue = claims[provider.group_claim];
  const claimGroups = Array.isArray(claimValue)
    ? claimValue.filter((value): value is string => typeof value === 'string')
    : typeof claimValue === 'string'
      ? [claimValue]
      : [];
  const mappings = parseJsonColumn<Record<string, string>>(provider.group_mappings, {});
  for (const claimGroup of claimGroups) {
    const appGroupName = mappings[claimGroup];
    if (!appGroupName) continue;
    const existing = await db.unsafe<{ id: string }[]>('SELECT id FROM groups WHERE name = $1', [
      appGroupName,
    ]);
    const groupId = existing[0]?.id ?? newId();
    if (!existing[0]) {
      await db.unsafe('INSERT INTO groups (id, name, description) VALUES ($1, $2, $3)', [
        groupId,
        appGroupName,
        `mapped from ${provider.name}:${claimGroup}`,
      ]);
    }
    await db.unsafe(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [groupId, userId],
    );
  }
}

export const OIDC_STATE_COOKIE = STATE_COOKIE;

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * OIDC integration test against a local mock provider. Requires a running
 * controller (NB_TEST_API_URL); skipped otherwise. Run with:
 *   NB_TEST_API_URL=http://127.0.0.1:8080 NB_ADMIN_PASSWORD=… bun run test:integration
 */

import { describe, expect, test } from 'bun:test';
import type { AppRouter } from '@netlabor/contract';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const baseUrl = process.env.NB_TEST_API_URL ?? null;
const adminUser = process.env.NB_ADMIN_USER ?? 'admin';
const adminPassword = process.env.NB_ADMIN_PASSWORD ?? 'admin-password-1234';
const describeLive = baseUrl ? describe : describe.skip;

interface MockProvider {
  issuer: string;
  stop(): void;
  state: {
    code: string;
    redirectUri: string;
    nonce: string;
    sub: string;
    groups: string[];
    email: string;
  };
}

async function startMockProvider(): Promise<MockProvider> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  const state = {
    code: 'test-code',
    redirectUri: '',
    nonce: '',
    sub: 'oidc-subject-1',
    groups: ['eng'],
    email: `oidc-${Date.now().toString(36)}@example.com`,
  };

  let port = 0;
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const issuer = `http://127.0.0.1:${port}`;
      if (url.pathname === '/.well-known/openid-configuration') {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
          scopes_supported: ['openid', 'profile', 'email'],
          claims_supported: ['sub', 'email', 'groups'],
        });
      }
      if (url.pathname === '/jwks') {
        return Response.json({ keys: [jwk] });
      }
      if (url.pathname === '/authorize') {
        const redirectUri = url.searchParams.get('redirect_uri') ?? '';
        state.redirectUri = redirectUri;
        state.nonce = url.searchParams.get('nonce') ?? '';
        const target = new URL(redirectUri);
        target.searchParams.set('code', state.code);
        target.searchParams.set('state', url.searchParams.get('state') ?? '');
        return Response.redirect(target.toString(), 302);
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        const issuerUrl = `http://127.0.0.1:${port}`;
        const idToken = await new SignJWT({
          email: state.email,
          name: 'OIDC Test User',
          groups: state.groups,
          nonce: state.nonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
          .setIssuer(issuerUrl)
          .setAudience('netlabor-test')
          .setSubject(state.sub)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
        return Response.json({
          access_token: 'mock-access-token',
          token_type: 'Bearer',
          expires_in: 300,
          id_token: idToken,
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  port = server.port ?? 0;
  return {
    issuer: `http://127.0.0.1:${port}`,
    stop: () => server.stop(true),
    state,
  };
}

function makeClient() {
  let cookie = '';
  const client: ContractRouterClient<AppRouter> = createORPCClient(
    new RPCLink({
      url: `${baseUrl}/rpc`,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        if (cookie) headers.set('cookie', cookie);
        const response = await fetch(input, { ...init, headers });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0] ?? '';
        return response;
      },
    }),
  );
  return { client, cookie: () => cookie };
}

describeLive('OIDC login', () => {
  test('mock provider creates a user and maps groups', async () => {
    const provider = await startMockProvider();
    const admin = makeClient();
    await admin.client.auth.login({ username: adminUser, password: adminPassword });
    const roles = await admin.client.roles.list({});
    const viewerRole = roles.find((role) => role.name === 'viewer');
    if (!viewerRole) throw new Error('viewer role missing');

    const created = await admin.client.auth.oidc.create({
      name: `mock-${Date.now().toString(36)}`,
      issuer: provider.issuer,
      clientId: 'netlabor-test',
      clientSecret: 'test-secret',
      scopes: ['openid', 'profile', 'email'],
      groupClaim: 'groups',
      groupMappings: { eng: `lab-${Date.now().toString(36)}` },
      defaultRoleId: viewerRole.id,
      autoCreate: true,
      enabled: true,
    });

    try {
      // Step 1: start the login and follow the provider's redirect.
      const start = await fetch(`${baseUrl}/auth/oidc/${created.id}/start`, { redirect: 'manual' });
      expect(start.status).toBe(302);
      const authorizeUrl = start.headers.get('location');
      expect(authorizeUrl).toContain('/authorize');
      const stateCookie = start.headers.get('set-cookie')?.split(';')[0] ?? '';
      expect(stateCookie).toContain('nb_oidc=');

      const authorize = await fetch(authorizeUrl as string, { redirect: 'manual' });
      expect(authorize.status).toBe(302);
      const callbackUrl = authorize.headers.get('location');
      expect(callbackUrl).toContain('/auth/oidc/');
      expect(callbackUrl).toContain('code=test-code');

      // Step 2: callback exchanges the code and sets a session cookie.
      const callback = await fetch(callbackUrl as string, {
        redirect: 'manual',
        headers: { cookie: stateCookie },
      });
      expect(callback.status).toBe(302);
      const sessionCookie = callback.headers
        .getSetCookie()
        .map((entry) => entry.split(';')[0])
        .find((entry) => entry?.startsWith('nb_session='));
      expect(sessionCookie).toBeDefined();

      const me = await fetch(`${baseUrl}/rpc/auth/me`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: sessionCookie as string },
        body: JSON.stringify({ json: {} }),
      });
      expect(me.status).toBe(200);
      const body = (await me.json()) as { json: { username: string; roles: string[] } };
      expect(body.json.username.startsWith('oidc-')).toBe(true);
      expect(body.json.roles).toContain('viewer');
    } finally {
      await admin.client.auth.oidc.delete({ id: created.id });
      provider.stop();
    }
  });
});

/**
 * Shared client for suites that drive a live controller (`NB_TEST_API_URL`).
 * Suites skip themselves when that URL is unset, so `bun test` stays green
 * without a stack.
 */

import type { AppRouter } from '@netlabor/contract';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';

export const baseUrl = process.env.NB_TEST_API_URL ?? null;
export const adminUser = process.env.NB_ADMIN_USER ?? 'admin';
export const adminPassword = process.env.NB_ADMIN_PASSWORD ?? 'admin-password-1234';

export interface Session {
  client: ContractRouterClient<AppRouter>;
  cookie: () => string;
}

/** RPC client that replays the session cookie the controller hands out. */
export function makeSession(): Session {
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

/** Sign in and keep the resulting session cookie. */
export async function login(
  username: string = adminUser,
  password: string = adminPassword,
): Promise<Session> {
  const session = makeSession();
  await session.client.auth.login({ username, password });
  return session;
}

/** Whether the live controller still has no accounts. */
export async function needsSetup(): Promise<boolean> {
  const session = makeSession();
  const status = await session.client.auth.setup.status({});
  return status.needsSetup;
}

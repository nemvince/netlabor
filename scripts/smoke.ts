/**
 * Smoke test against a running stack: health, login, project, and node checks.
 * Usage: NB_DATABASE_URL=... bun run smoke [--login]
 */

import type { AppRouter } from '@netlabor/contract';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';

const baseUrl = (process.env.NB_SMOKE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const username = process.env.NB_SMOKE_USER ?? process.env.NB_ADMIN_USER ?? 'admin';
const password = process.env.NB_SMOKE_PASSWORD ?? process.env.NB_ADMIN_PASSWORD ?? 'admin';

let cookie = '';
const link = new RPCLink({
  url: `${baseUrl}/rpc`,
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set('cookie', cookie);
    const response = await fetch(input, { ...init, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0] ?? '';
    return response;
  },
});

const client: ContractRouterClient<AppRouter> = createORPCClient(link);

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  const status = ok ? 'ok  ' : 'FAIL';
  console.log(`${status} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  const health = await client.health.ping({});
  check('controller healthz', health.status === 'ok', `version ${health.version}`);

  const login = await client.auth.login({ username, password });
  check('login', login.user.username === username, `expires ${login.expiresAt}`);

  const me = await client.auth.me({});
  check('auth.me', me.id === login.user.id, `${me.privileges.length} privileges`);

  const projects = await client.projects.list({ limit: 50, offset: 0, includeClosed: true });
  check('projects.list', Array.isArray(projects), `${projects.length} project(s)`);

  const project = projects[0];
  if (project) {
    const nodes = await client.nodes.list({ projectId: project.id });
    check('nodes.list', Array.isArray(nodes), `${nodes.length} node(s) in "${project.name}"`);
    const links = await client.links.list({ projectId: project.id });
    check('links.list', Array.isArray(links), `${links.length} link(s)`);
  } else {
    console.log('info no projects yet; skipping node and link checks');
  }

  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('smoke passed');
}

main().catch((error) => {
  console.error('smoke failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});

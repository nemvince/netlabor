/**
 * API integration tests. They need a running controller and the test database;
 * they skip themselves when NB_TEST_API_URL is not set.
 *
 *   NB_TEST_API_URL=http://127.0.0.1:8080 \
 *   NB_ADMIN_PASSWORD=… bun run test:integration
 */

import { describe, expect, test } from 'bun:test';
import type { AppRouter } from '@netlabor/contract';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';

const baseUrl = process.env.NB_TEST_API_URL ?? null;
const adminUser = process.env.NB_ADMIN_USER ?? 'admin';
const adminPassword = process.env.NB_ADMIN_PASSWORD ?? 'admin-password-1234';

interface SessionClient {
  client: ContractRouterClient<AppRouter>;
  cookie: () => string;
}

function makeClient(): SessionClient {
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

const describeLive = baseUrl ? describe : describe.skip;

async function loginAs(
  client: ContractRouterClient<AppRouter>,
  username: string,
  password: string,
) {
  return client.auth.login({ username, password });
}

describeLive('controller API', () => {
  test('health, login, and auth.me', async () => {
    const session = makeClient();
    const health = await session.client.health.ping({});
    expect(health.status).toBe('ok');

    const login = await loginAs(session.client, adminUser, adminPassword);
    expect(login.user.username).toBe(adminUser);
    expect(session.cookie()).toContain('nb_session=');

    const me = await session.client.auth.me({});
    expect(me.id).toBe(login.user.id);
    expect(me.privileges.length).toBeGreaterThan(10);
  });

  test('unauthorized access is rejected', async () => {
    const anonymous = makeClient();
    await expect(
      anonymous.client.projects.list({ limit: 5, offset: 0, includeClosed: true }),
    ).rejects.toThrow(/authentication required|UNAUTHORIZED/i);
  });

  test('project lifecycle creates and removes its dataplane', async () => {
    const session = makeClient();
    await loginAs(session.client, adminUser, adminPassword);
    const project = await session.client.projects.create({
      name: `it-${Date.now()}`,
      description: 'integration test',
      variables: {},
      autoOpen: false,
      autoClose: false,
      autoStart: false,
    });
    try {
      const opened = await session.client.projects.open({ id: project.id });
      expect(opened.status).toBe('opened');
      const closed = await session.client.projects.close({ id: project.id });
      expect(closed.status).toBe('closed');
    } finally {
      await session.client.projects.delete({ id: project.id });
    }
  });

  test('viewer writes are rejected and audited', async () => {
    const admin = makeClient();
    await loginAs(admin.client, adminUser, adminPassword);

    const username = `viewer-${Date.now().toString(36)}`;
    const created = await admin.client.users.create({
      username,
      password: 'viewer-password-1234',
      isActive: true,
      roleIds: [],
      groupIds: [],
    });
    const roles = await admin.client.roles.list({});
    const viewerRole = roles.find((role) => role.name === 'viewer');
    if (!viewerRole) throw new Error('viewer role missing');
    await admin.client.users.update({ id: created.id, roleIds: [viewerRole.id] });

    const viewer = makeClient();
    await loginAs(viewer.client, username, 'viewer-password-1234');
    await expect(
      viewer.client.projects.create({
        name: 'nope',
        variables: {},
        autoOpen: false,
        autoClose: false,
        autoStart: false,
      }),
    ).rejects.toThrow(/missing privilege|FORBIDDEN/i);

    const audit = await admin.client.audit.list({
      action: 'projects.create denied',
      limit: 5,
      offset: 0,
    });
    expect(audit.length).toBeGreaterThan(0);

    await admin.client.users.delete({ id: created.id });
  });

  test('api keys authenticate oRPC calls', async () => {
    const admin = makeClient();
    await loginAs(admin.client, adminUser, adminPassword);
    const created = await admin.client.auth.apiKeys.create({
      name: 'integration',
      scopes: ['project.read', 'mcp.use'],
    });
    const keyClient: ContractRouterClient<AppRouter> = createORPCClient(
      new RPCLink({
        url: `${baseUrl}/rpc`,
        headers: { authorization: `Bearer ${created.plaintext}` },
      }),
    );
    const projects = await keyClient.projects.list({ limit: 5, offset: 0, includeClosed: true });
    expect(Array.isArray(projects)).toBe(true);
    await admin.client.auth.apiKeys.revoke({ id: created.key.id });
  });

  test('MCP lists tools for a scoped key and calls one', async () => {
    const admin = makeClient();
    await loginAs(admin.client, adminUser, adminPassword);
    const created = await admin.client.auth.apiKeys.create({
      name: 'mcp-integration',
      scopes: ['project.read', 'node.read', 'link.read', 'mcp.use'],
    });
    try {
      const list = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${created.plaintext}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(list.status).toBe(200);
      const body = (await list.json()) as {
        result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
      };
      const names = body.result.tools.map((tool) => tool.name);
      expect(names).toContain('project_list');
      expect(names).not.toContain('node_delete');

      const call = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${created.plaintext}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'project_list', arguments: { limit: 5, offset: 0, includeClosed: true } },
        }),
      });
      const callBody = (await call.json()) as {
        result: { isError: boolean; content: { text: string }[] };
      };
      expect(callBody.result.isError).toBe(false);
      expect(Array.isArray(JSON.parse(callBody.result.content[0]?.text ?? '[]'))).toBe(true);
    } finally {
      await admin.client.auth.apiKeys.revoke({ id: created.key.id });
    }
  });

  test('project apply upserts a manifest, keeps ids, and prunes', async () => {
    const session = makeClient();
    await loginAs(session.client, adminUser, adminPassword);
    const name = `apply-${Date.now()}`;
    const manifest = {
      name,
      nodes: [
        { name: 'sw1', template: 'Ethernet switch' },
        { name: 'sw2', template: 'Ethernet switch' },
      ],
      links: [{ a: 'sw1', b: 'sw2', type: 'ethernet' as const }],
    };

    const first = await session.client.projects.apply(manifest);
    try {
      expect(first.nodes).toHaveLength(2);
      expect(first.links).toHaveLength(1);
      expect(first.project.status).toBe('opened');

      const second = await session.client.projects.apply({
        ...manifest,
        projectId: first.projectId,
      });
      expect(second.nodes.map((node) => node.id).sort()).toEqual(
        first.nodes.map((node) => node.id).sort(),
      );
      expect(second.nodes).toHaveLength(2);
      expect(second.links).toHaveLength(1);
      expect(second.links[0]?.id).toBe(first.links[0]?.id as string);

      const pruned = await session.client.projects.apply({
        projectId: first.projectId,
        nodes: [{ name: 'sw1', template: 'Ethernet switch' }],
        prune: true,
      });
      expect(pruned.deleted.nodes).toContain('sw2');
      expect(pruned.nodes).toHaveLength(1);
      expect(pruned.links).toHaveLength(0);
    } finally {
      await session.client.projects.delete({ id: first.projectId });
    }
  });

  test('seeded catalog is present', async () => {
    const admin = makeClient();
    await loginAs(admin.client, adminUser, adminPassword);
    const templates = await admin.client.templates.list({ limit: 200, offset: 0 });
    expect(templates.length).toBeGreaterThanOrEqual(10);
    const symbols = await admin.client.symbols.list({});
    expect(symbols.length).toBeGreaterThanOrEqual(10);
  });
});

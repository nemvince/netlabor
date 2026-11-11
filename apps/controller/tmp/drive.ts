/**
 * Temporary driver: reproduce VPCS -> switch relay links end to end.
 * Usage: bun scripts/tmp-relay-drive.ts <mode>
 *   mode = full (create project and run everything) | inspect | cleanup <projectId>
 */

import type { AppRouter } from '@netlabor/contract';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';

const baseUrl = (process.env.NB_SMOKE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const username = process.env.NB_SMOKE_USER ?? 'admin';
const password = process.env.NB_SMOKE_PASSWORD ?? 'admin-password-1234';

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

function log(label: string, value?: unknown): void {
  console.log(label, value === undefined ? '' : JSON.stringify(value));
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'full';
  await client.auth.login({ username, password });

  if (mode === 'cleanup') {
    const projectId = process.argv[3];
    if (!projectId) throw new Error('cleanup needs a project id');
    const nodes = await client.nodes.list({ projectId });
    for (const node of nodes) {
      await client.nodes
        .stop({ id: node.id })
        .catch((error: unknown) => log(`stop ${node.name} failed`, String(error)));
    }
    await client.projects
      .close({ id: projectId })
      .catch((error: unknown) => log('close failed', String(error)));
    await client.projects.delete({ id: projectId });
    log('deleted project', projectId);
    return;
  }

  const project = await client.projects.create({
    name: `relay-${Date.now()}`,
    autoOpen: false,
    autoClose: false,
    autoStart: false,
    variables: {},
  });
  log('project', { id: project.id, name: project.name });
  const projectId = project.id;

  const sw = await client.nodes.create({
    projectId,
    nodeType: 'ethernet_switch',
    name: 'ethernet_switch-1',
    x: 300,
    y: 200,
    properties: { portsMapping: [] },
  });
  log('switch', { id: sw.id, ports: sw.ports.length });

  const pc1 = await client.nodes.create({
    projectId,
    nodeType: 'vpcs',
    name: 'vpcs-1',
    x: 100,
    y: 100,
    properties: {},
  });
  const pc2 = await client.nodes.create({
    projectId,
    nodeType: 'vpcs',
    name: 'vpcs-2',
    x: 500,
    y: 100,
    properties: {},
  });
  log('vpcs', { pc1: pc1.id, pc2: pc2.id, ports1: pc1.ports, ports2: pc2.ports });

  const link1 = await client.links.create({
    projectId,
    nodeAId: pc1.id,
    adapterA: 0,
    portA: 0,
    nodeBId: sw.id,
    adapterB: 0,
    portB: 0,
  });
  const link2 = await client.links.create({
    projectId,
    nodeAId: pc2.id,
    adapterA: 0,
    portA: 0,
    nodeBId: sw.id,
    adapterB: 0,
    portB: 1,
  });
  log('links', { link1: link1.id, link2: link2.id });

  await client.projects.open({ id: projectId });
  log('opened');

  const started = [];
  started.push(await client.nodes.start({ id: sw.id }));
  started.push(await client.nodes.start({ id: pc1.id }));
  started.push(await client.nodes.start({ id: pc2.id }));
  log('started', started);

  const linksAfterStart = await client.links.list({ projectId });
  log(
    'links state',
    linksAfterStart.map((row) => ({ id: row.id, status: row.status, mode: row.dataplane?.mode })),
  );

  const ip1 = await client.nodes.console.exec({
    id: pc1.id,
    commands: ['ip 10.0.0.1/24'],
    timeoutMs: 5000,
  });
  log('pc1 ip', ip1.transcript);
  const ip2 = await client.nodes.console.exec({
    id: pc2.id,
    commands: ['ip 10.0.0.2/24'],
    timeoutMs: 5000,
  });
  log('pc2 ip', ip2.transcript);

  const ping = await client.nodes.console.exec({
    id: pc1.id,
    commands: ['ping 10.0.0.2 -c 3'],
    timeoutMs: 15000,
  });
  log('ping', { ok: ping.ok, transcript: ping.transcript });

  log('PROJECT_ID', projectId);
}

main().catch((error) => {
  console.error('driver failed:', error instanceof Error ? error.message : error);
  if (error && typeof error === 'object' && 'details' in error)
    console.error(JSON.stringify(error));
  process.exit(1);
});

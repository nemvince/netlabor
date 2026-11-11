import type { AppRouter } from '@netlabor/contract';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';

const baseUrl = 'http://127.0.0.1:8080';
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
const log = (label: string, value?: unknown) =>
  console.log(label, value === undefined ? '' : JSON.stringify(value));

await client.auth.login({ username: 'admin', password: 'admin-password-1234' });
const project = await client.projects.create({
  name: `relay-final-${Date.now()}`,
  autoOpen: false,
  autoClose: false,
  autoStart: false,
  variables: {},
});
const projectId = project.id;
const sw = await client.nodes.create({
  projectId,
  nodeType: 'ethernet_switch',
  name: 'ethernet_switch-1',
  x: 300,
  y: 200,
  properties: { portsMapping: [] },
});
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
const link1 = await client.links.create({
  projectId,
  nodeAId: pc1.id,
  adapterA: 0,
  portA: 0,
  nodeBId: sw.id,
  adapterB: 0,
  portB: 0,
});
const _link2 = await client.links.create({
  projectId,
  nodeAId: pc2.id,
  adapterA: 0,
  portA: 0,
  nodeBId: sw.id,
  adapterB: 0,
  portB: 1,
});
await client.projects.open({ id: projectId });
for (const id of [sw.id, pc1.id, pc2.id]) await client.nodes.start({ id });
log(
  'links',
  (await client.links.list({ projectId })).map((row) => ({
    status: row.status,
    mode: row.dataplane?.mode,
  })),
);
log(
  'ip1',
  (await client.nodes.console.exec({ id: pc1.id, commands: ['ip 10.0.0.1/24'], timeoutMs: 8000 }))
    .transcript,
);
log(
  'ip2',
  (await client.nodes.console.exec({ id: pc2.id, commands: ['ip 10.0.0.2/24'], timeoutMs: 8000 }))
    .transcript,
);
log(
  'ping1',
  (
    await client.nodes.console.exec({
      id: pc1.id,
      commands: ['ping 10.0.0.2 -c 3'],
      timeoutMs: 15000,
    })
  ).transcript,
);

await client.links.capture.start({ linkId: link1.id, dlt: 'DLT_EN10MB' });
const ping2 = await client.nodes.console.exec({
  id: pc1.id,
  commands: ['ping 10.0.0.2 -c 3'],
  timeoutMs: 15000,
});
log('ping2', ping2.transcript);
const status = await client.links.capture.status({ linkId: link1.id });
await client.links.capture.stop({ linkId: link1.id });
log('pcap', { path: status.path, sizeBytes: status.sizeBytes });

const reset = await client.links.reset({ id: link1.id });
log('reset', { status: reset.status, lports: reset.dataplane?.endpoints.map((e) => e.lport) });
log(
  'ping3',
  (
    await client.nodes.console.exec({
      id: pc1.id,
      commands: ['ping 10.0.0.2 -c 2'],
      timeoutMs: 15000,
    })
  ).transcript,
);

for (const id of [pc2.id, pc1.id, sw.id]) await client.nodes.stop({ id });
for (const id of [sw.id, pc1.id, pc2.id]) await client.nodes.start({ id });
await client.nodes.console.exec({ id: pc1.id, commands: ['ip 10.0.0.1/24'], timeoutMs: 8000 });
await client.nodes.console.exec({ id: pc2.id, commands: ['ip 10.0.0.2/24'], timeoutMs: 8000 });
log(
  'ping4-after-restart',
  (
    await client.nodes.console.exec({
      id: pc1.id,
      commands: ['ping 10.0.0.2 -c 2'],
      timeoutMs: 15000,
    })
  ).transcript,
);
log('PROJECT_ID', projectId);
log('LINK1_ID', link1.id);

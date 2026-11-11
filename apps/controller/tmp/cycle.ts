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
const projectId = process.argv[2] as string;

await client.auth.login({ username: 'admin', password: 'admin-password-1234' });
const nodes = await client.nodes.list({ projectId });
const pc1 = nodes.find((node) => node.name === 'vpcs-1')!;
const pc2 = nodes.find((node) => node.name === 'vpcs-2')!;

await client.nodes.stop({ id: pc2.id });
console.log('stopped pc2');
const afterStop = await client.links.list({ projectId });
console.log(
  'links after stop',
  JSON.stringify(afterStop.map((row) => ({ status: row.status, dp: !!row.dataplane }))),
);
await client.nodes.start({ id: pc2.id });
console.log('started pc2');
const afterStart = await client.links.list({ projectId });
console.log(
  'links after start',
  JSON.stringify(
    afterStart.map((row) => ({
      id: row.id,
      status: row.status,
      lports: row.dataplane?.endpoints.map((e) => e.lport),
    })),
  ),
);
const ip2 = await client.nodes.console.exec({
  id: pc2.id,
  commands: ['ip 10.0.0.2/24'],
  timeoutMs: 8000,
});
console.log('pc2 ip', JSON.stringify(ip2.transcript));
const ping = await client.nodes.console.exec({
  id: pc1.id,
  commands: ['ping 10.0.0.2 -c 2'],
  timeoutMs: 15000,
});
console.log('ping after cycle', JSON.stringify(ping.transcript));

// Cleanup: stop everything, close, delete.
for (const node of nodes) {
  await client.nodes
    .stop({ id: node.id })
    .catch((error: unknown) => console.log('stop failed', node.name, String(error)));
}
await client.projects.close({ id: projectId });
await client.projects.delete({ id: projectId });
console.log('project deleted', projectId);

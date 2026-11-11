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
const linkId = process.argv[3] as string;

await client.auth.login({ username: 'admin', password: 'admin-password-1234' });
const started = await client.links.capture.start({ linkId, dlt: 'DLT_EN10MB' });
console.log('capture started', JSON.stringify(started));
const nodes = await client.nodes.list({ projectId });
const pc1 = nodes.find((node) => node.name === 'vpcs-1');
if (!pc1) throw new Error('vpcs-1 not found');
const ping = await client.nodes.console.exec({
  id: pc1.id,
  commands: ['ping 10.0.0.2 -c 3'],
  timeoutMs: 15000,
});
console.log('ping transcript', JSON.stringify(ping.transcript));
const status = await client.links.capture.status({ linkId });
console.log('capture status', JSON.stringify(status));
const stopped = await client.links.capture.stop({ linkId });
console.log('capture stopped', JSON.stringify(stopped));

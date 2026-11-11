/**
 * Load test: 100 VPCS nodes behind one switch, start/stop cycle, then verify
 * no orphan namespaces, vpcs, ubridge, or host links remain.
 *
 *   NB_SMOKE_URL=http://127.0.0.1:8080 NB_SMOKE_USER=admin NB_SMOKE_PASSWORD=… \
 *   bun run scripts/load.ts [--count 100] [--keep]
 */

import type { AppRouter } from '@netlabor/contract';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';

const baseUrl = (process.env.NB_SMOKE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const username = process.env.NB_SMOKE_USER ?? process.env.NB_ADMIN_USER ?? 'admin';
const password =
  process.env.NB_SMOKE_PASSWORD ?? process.env.NB_ADMIN_PASSWORD ?? 'admin-password-1234';
const args = process.argv.slice(2);
const countIndex = args.indexOf('--count');
const count = countIndex === -1 ? 100 : Number(args[countIndex + 1] ?? 100);
const keep = args.includes('--keep');

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

function sh(command: string): string {
  const result = Bun.spawnSync(['bash', '-lc', command], { stdout: 'pipe', stderr: 'pipe' });
  return new TextDecoder().decode(result.stdout).trim();
}

async function main() {
  await client.auth.login({ username, password });
  const computes = await client.computes.list({});
  const compute = computes.find((entry) => entry.status === 'online');
  if (!compute) throw new Error('no online compute');
  const baseline = {
    namespaces: Number(sh("sudo -n ip netns list | grep -c '^nb-' || true")),
    vpcs: Number(sh('sudo -n pgrep -c vpcs || true')),
    ubridge: Number(sh('sudo -n pgrep -c ubridge || true')),
    links: Number(sh("sudo -n ip -o link show | grep -c -E 'nbp' || true")),
  };
  console.log('baseline', baseline);

  const project = await client.projects.create({
    name: `load-${Date.now().toString(36)}`,
    variables: {},
    autoOpen: false,
    autoClose: false,
    autoStart: false,
  });
  console.log(`project ${project.name} (${project.id}) on ${compute.name}`);
  const short = project.id.replaceAll('-', '').slice(0, 10);

  const switchNode = await client.nodes.create({
    projectId: project.id,
    nodeType: 'ethernet_switch',
    computeId: compute.id,
    x: 0,
    y: 0,
    properties: { portsMapping: [] },
  });
  const pcs = [];
  for (let index = 0; index < count; index++) {
    pcs.push(
      await client.nodes.create({
        projectId: project.id,
        nodeType: 'vpcs',
        computeId: compute.id,
        x: 100 + (index % 10) * 80,
        y: 100 + Math.floor(index / 10) * 80,
      }),
    );
  }
  console.log(`created ${pcs.length} vpcs nodes + ${switchNode.name}`);

  await client.projects.open({ id: project.id });
  const started: string[] = [];
  for (const pc of pcs) {
    const result = await client.nodes.start({ id: pc.id });
    started.push(result.status);
  }
  console.log(`started ${started.filter((status) => status === 'started').length}/${pcs.length}`);

  const netnsBefore = sh('sudo -n ip netns list | wc -l');
  const vpcsBefore = sh('sudo -n pgrep -c vpcs || true');
  console.log(`during run: namespaces=${netnsBefore} vpcs=${vpcsBefore}`);

  for (const pc of pcs) {
    await client.nodes.stop({ id: pc.id });
  }
  await client.projects.close({ id: project.id });
  console.log('stopped all nodes and closed the project');

  const after = {
    namespaces: Number(sh("sudo -n ip netns list | grep -c '^nb-' || true")),
    vpcs: Number(sh('sudo -n pgrep -c vpcs || true')),
    ubridge: Number(sh('sudo -n pgrep -c ubridge || true')),
    links: Number(sh("sudo -n ip -o link show | grep -c -E 'nbp' || true")),
  };
  const projectNamespace = sh(`sudo -n ip netns list | grep -c '^nb-${short} ' || true`);
  const projectLinks = sh(`sudo -n ip -o link show | grep -c 'nbp${short}' || true`);
  const orphans = {
    projectNamespaces: Number(projectNamespace),
    projectLinks: Number(projectLinks),
    namespacesDelta: after.namespaces - baseline.namespaces,
    vpcsDelta: after.vpcs - baseline.vpcs,
    ubridgeDelta: after.ubridge - baseline.ubridge,
    linksDelta: after.links - baseline.links,
  };
  console.log('after close (delta vs baseline)', orphans);

  if (keep) {
    console.log(`kept project ${project.id}`);
  } else {
    await client.projects.delete({ id: project.id });
    console.log('project deleted');
  }

  const failures = Object.entries(orphans).filter(([, value]) => Number(value) > 0);
  if (failures.length > 0) {
    console.error('orphan objects remain:', failures);
    process.exit(1);
  }
  console.log('load test passed');
}

main().catch((error) => {
  console.error('load test failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});

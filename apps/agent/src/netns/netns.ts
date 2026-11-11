/** Linux network namespace, veth, route, and nftables primitives. */

import { run, runInNetns } from '../sys.ts';

export async function netnsExists(name: string): Promise<boolean> {
  const result = await run(['ip', 'netns', 'list'], { allowFailure: true });
  return result.stdout
    .split('\n')
    .some((line) => line.trim().startsWith(`${name} `) || line.trim() === name);
}

export async function listNetns(): Promise<string[]> {
  const result = await run(['ip', 'netns', 'list'], { allowFailure: true });
  return result.stdout
    .split('\n')
    .map((line) => line.split(' ')[0]?.trim() ?? '')
    .filter((name) => name.length > 0);
}

export async function addNetns(name: string): Promise<void> {
  await run(['ip', 'netns', 'add', name]);
}

export async function deleteNetns(name: string): Promise<void> {
  await run(['ip', 'netns', 'delete', name], { allowFailure: true });
}

export async function linkExists(netns: string | null, name: string): Promise<boolean> {
  const argv = netns === null ? ['ip', 'link', 'show', name] : ['ip', 'link', 'show', name];
  const result =
    netns === null
      ? await run(argv, { allowFailure: true })
      : await runInNetns(netns, argv, { allowFailure: true });
  return result.code === 0;
}

/** Create a veth pair in the host namespace; the caller moves the peer. */
export async function createVethPair(hostEnd: string, peerEnd: string): Promise<void> {
  await run(['ip', 'link', 'add', hostEnd, 'type', 'veth', 'peer', 'name', peerEnd], {
    allowFailure: false,
  });
}

export async function setLinkUp(netns: string | null, name: string): Promise<void> {
  const command = ['ip', 'link', 'set', name, 'up'];
  if (netns === null) await run(command);
  else await runInNetns(netns, command);
}

export async function addAddress(netns: string | null, name: string, cidr: string): Promise<void> {
  const command = ['ip', 'addr', 'add', cidr, 'dev', name];
  if (netns === null) await run(command);
  else await runInNetns(netns, command);
}

export async function moveLinkToNetns(name: string, netns: string): Promise<void> {
  await run(['ip', 'link', 'set', name, 'netns', netns]);
}

export async function renameLink(netns: string, from: string, to: string): Promise<void> {
  await runInNetns(netns, ['ip', 'link', 'set', from, 'name', to]);
}

export async function addRoute(
  netns: string | null,
  destination: string,
  dev: string,
): Promise<void> {
  const command = ['ip', 'route', 'add', destination, 'dev', dev];
  if (netns === null) await run(command, { allowFailure: true });
  else await runInNetns(netns, command, { allowFailure: true });
}

export async function addDefaultRoute(netns: string, gateway: string, dev: string): Promise<void> {
  await runInNetns(netns, ['ip', 'route', 'add', 'default', 'via', gateway, 'dev', dev], {
    allowFailure: true,
  });
}

export async function deleteLink(name: string): Promise<void> {
  await run(['ip', 'link', 'delete', name], { allowFailure: true });
}

export async function interfaceNames(): Promise<string[]> {
  const result = await run(['ip', '-o', 'link', 'show'], { allowFailure: true });
  return result.stdout
    .split('\n')
    .map((line) => /^\d+:\s+([^:@]+)[:@]/.exec(line)?.[1]?.trim() ?? '')
    .filter((name) => name.length > 0);
}

/** Delete stale host links left behind by a previous agent process. */
export async function pruneStaleLinks(
  prefixes: string[],
  keepNetns: Set<string>,
): Promise<string[]> {
  const removed: string[] = [];
  const names = await interfaceNames();
  for (const name of names) {
    if (!prefixes.some((prefix) => name.startsWith(prefix))) continue;
    // Skip veth host ends whose peer is still enslaved to a live namespace.
    if (keepNetns.size > 0) {
      const result = await run(['ip', '-o', 'link', 'show', name], { allowFailure: true });
      if (/master /.test(result.stdout)) continue;
    }
    await deleteLink(name);
    removed.push(name);
  }
  return removed;
}

const NFT_TABLE = 'netlabor';

/** Install (idempotently) the forward policy and per-project source drops. */
export async function installNftRules(underlayInterface: string): Promise<void> {
  await run(['nft', 'list', 'table', 'inet', NFT_TABLE], { allowFailure: true }).then(
    async (result) => {
      if (result.code !== 0) {
        await run(['nft', 'add', 'table', 'inet', NFT_TABLE], { allowFailure: true });
      }
    },
  );
  await run(['nft', 'flush', 'chain', 'inet', NFT_TABLE, 'forward'], { allowFailure: true });
  await run(
    [
      'nft',
      'add',
      'chain',
      'inet',
      NFT_TABLE,
      'forward',
      '{ type filter hook forward priority 0; policy drop; }',
    ],
    { allowFailure: true },
  );
  const rules = [
    `ct state established,related accept`,
    `iifname "nt*" accept`,
    `iifname "${underlayInterface}" oifname "nbp*" ip daddr 10.99.0.0/16 udp dport 50000-59999 accept`,
    `iifname "nbp*" oifname "${underlayInterface}" ip saddr 10.99.0.0/16 udp sport 50000-59999 accept`,
    `iifname "nbp*" oifname "nbp*" drop`,
  ];
  for (const rule of rules) {
    await run(['nft', 'add', 'rule', 'inet', NFT_TABLE, 'forward', ...rule.split(' ')], {
      allowFailure: true,
    });
  }
}

export async function enableIpForwarding(): Promise<void> {
  try {
    await Bun.write('/proc/sys/net/ipv4/ip_forward', '1');
  } catch {
    await run(['sysctl', '-w', 'net.ipv4.ip_forward=1'], { allowFailure: true });
  }
}

/** Names of kernel bridges that belong to Netlabor (lk*, sw*, hb*). */
export async function listNetlaborBridges(): Promise<string[]> {
  const result = await run(['ip', '-o', 'link', 'show', 'type', 'bridge'], { allowFailure: true });
  return result.stdout
    .split('\n')
    .map((line) => /^\d+:\s+([^:@]+)[:@]/.exec(line)?.[1]?.trim() ?? '')
    .filter((name) => name.startsWith('lk') || name.startsWith('sw') || name.startsWith('hb'));
}

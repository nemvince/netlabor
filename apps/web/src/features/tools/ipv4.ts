/** IPv4 CIDR helpers for the browser-side network tools. */

export interface Ipv4Network {
  address: number;
  network: number;
  broadcast: number;
  prefix: number;
  mask: number;
  wildcard: number;
  total: number;
  usable: number;
  firstHost: number;
  lastHost: number;
}

export function parseIpv4(value: string): number {
  const parts = value.trim().split('.');
  if (parts.length !== 4) throw new Error('An IPv4 address needs four octets.');
  let address = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) throw new Error('IPv4 octets must be decimal 0–255.');
    const octet = Number(part);
    if (octet > 255) throw new Error('IPv4 octets must be decimal 0–255.');
    address = address * 256 + octet;
  }
  return address >>> 0;
}

export function formatIpv4(value: number): string {
  const address = value >>> 0;
  return [address >>> 24, (address >>> 16) & 255, (address >>> 8) & 255, address & 255].join('.');
}

export function maskForPrefix(prefix: number): number {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error('Prefix must be an integer between 0 and 32.');
  }
  if (prefix === 0) return 0;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

export function prefixForMask(mask: number): number {
  let value = mask >>> 0;
  let prefix = 0;
  while (value !== 0) {
    prefix += value & 1;
    value >>>= 1;
  }
  return prefix;
}

export function parseCidr(value: string): Ipv4Network {
  const input = value.trim();
  const slash = input.lastIndexOf('/');
  if (slash <= 0) throw new Error('Enter a network as address/prefix, e.g. 10.0.0.0/24.');
  const address = parseIpv4(input.slice(0, slash));
  const prefix = Number(input.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error('Prefix must be an integer between 0 and 32.');
  }
  const mask = maskForPrefix(prefix);
  const network = (address & mask) >>> 0;
  const wildcard = ~mask >>> 0;
  const broadcast = (network | wildcard) >>> 0;
  const total = 2 ** (32 - prefix);
  const usable = prefix >= 31 ? total : Math.max(0, total - 2);
  return {
    address,
    network,
    broadcast,
    prefix,
    mask,
    wildcard,
    total,
    usable,
    firstHost: prefix >= 31 ? network : network + 1,
    lastHost: prefix >= 31 ? broadcast : broadcast - 1,
  };
}

export function networkLabel(network: number, prefix: number): string {
  return `${formatIpv4(network)}/${prefix}`;
}

export function hostRange(network: Ipv4Network): string {
  return `${formatIpv4(network.firstHost)} – ${formatIpv4(network.lastHost)}`;
}

export interface SplitSubnet extends Ipv4Network {
  index: number;
}

export function splitSubnets(
  base: Ipv4Network,
  newPrefix: number,
  limit = 256,
): { subnets: SplitSubnet[]; count: number; truncated: boolean } {
  if (!Number.isInteger(newPrefix) || newPrefix < base.prefix || newPrefix > 32) {
    throw new Error(`New prefix must be between /${base.prefix} and /32.`);
  }
  const count = 2 ** (newPrefix - base.prefix);
  const size = 2 ** (32 - newPrefix);
  const rows = Math.min(count, Math.max(1, limit));
  const subnets: SplitSubnet[] = [];
  for (let index = 0; index < rows; index++) {
    const network = base.network + index * size;
    subnets.push({ ...parseCidr(`${formatIpv4(network)}/${newPrefix}`), index });
  }
  return { subnets, count, truncated: count > rows };
}

export interface VlsmRequirement {
  name: string;
  request: string;
}

export interface VlsmAllocation {
  name: string;
  request: string;
  prefix: number;
  network: number;
  broadcast: number;
  firstHost: number;
  lastHost: number;
  usable: number;
  fits: boolean;
  note?: string;
}

export function prefixForHosts(hosts: number): number {
  if (!Number.isInteger(hosts) || hosts < 1) throw new Error('Host count must be at least 1.');
  if (hosts > 2 ** 31) throw new Error('Host count is too large.');
  return Math.max(0, 32 - Math.ceil(Math.log2(hosts + 2)));
}

export function parseVlsmRequest(
  request: string,
): { prefix: number; label: string; hosts?: number } {
  const value = request.trim();
  if (value.startsWith('/')) {
    const prefix = Number(value.slice(1));
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new Error('A prefix request must look like /28.');
    }
    return { prefix, label: `/${prefix}` };
  }
  const hosts = Number(value);
  if (!Number.isInteger(hosts) || hosts < 1) {
    throw new Error('A host request must be a positive integer or /prefix.');
  }
  return { prefix: prefixForHosts(hosts), label: `${hosts} hosts`, hosts };
}

export interface VlsmPlan {
  allocations: VlsmAllocation[];
  usedAddresses: number;
  freeAddresses: number;
  errors: string[];
}

export function planVlsm(base: Ipv4Network, requirements: VlsmRequirement[]): VlsmPlan {
  const errors: string[] = [];
  const parsed: { name: string; request: string; prefix: number; label: string }[] = [];
  for (const requirement of requirements) {
    if (requirement.name.trim() === '' && requirement.request.trim() === '') continue;
    try {
      const request = parseVlsmRequest(requirement.request);
      if (request.prefix < base.prefix) {
        throw new Error(
          `${requirement.name || 'Requirement'} needs /${request.prefix}, larger than the base /${base.prefix}.`,
        );
      }
      parsed.push({
        name: requirement.name.trim() || 'Subnet',
        request: request.label,
        prefix: request.prefix,
        label: requirement.request.trim(),
      });
    } catch (error) {
      errors.push(
        `${requirement.name || 'Requirement'}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  parsed.sort((left, right) => left.prefix - right.prefix);
  let cursor = base.network;
  let usedAddresses = 0;
  const allocations: VlsmAllocation[] = [];
  for (const item of parsed) {
    const size = 2 ** (32 - item.prefix);
    const aligned = Math.ceil(cursor / size) * size;
    const broadcast = aligned + size - 1;
    if (broadcast > base.broadcast) {
      allocations.push({
        name: item.name,
        request: item.request,
        prefix: item.prefix,
        network: aligned,
        broadcast,
        firstHost: aligned,
        lastHost: broadcast,
        usable: size,
        fits: false,
        note: 'Does not fit in the base network.',
      });
      continue;
    }
    usedAddresses += size;
    const network = parseCidr(`${formatIpv4(aligned)}/${item.prefix}`);
    allocations.push({
      name: item.name,
      request: item.request,
      prefix: item.prefix,
      network: network.network,
      broadcast: network.broadcast,
      firstHost: network.firstHost,
      lastHost: network.lastHost,
      usable: network.usable,
      fits: true,
    });
    cursor = aligned + size;
  }
  return {
    allocations,
    usedAddresses,
    freeAddresses: Math.max(0, base.total - usedAddresses),
    errors,
  };
}

export interface OverlapResult {
  overlap: boolean;
  container: 'a' | 'b' | null;
  intersection: Ipv4Network | null;
}

export function checkOverlap(left: Ipv4Network, right: Ipv4Network): OverlapResult {
  const overlap = left.network <= right.broadcast && right.network <= left.broadcast;
  const aContainsB = left.network <= right.network && left.broadcast >= right.broadcast;
  const bContainsA = right.network <= left.network && right.broadcast >= left.broadcast;
  let intersection: Ipv4Network | null = null;
  if (overlap) {
    const start = Math.max(left.network, right.network);
    const largest = Math.max(left.prefix, right.prefix);
    intersection = parseCidr(`${formatIpv4(start)}/${largest}`);
  }
  return {
    overlap,
    container: aContainsB ? 'a' : bContainsA ? 'b' : null,
    intersection,
  };
}

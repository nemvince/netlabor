import { describe, expect, test } from 'bun:test';
import {
  checkOverlap,
  formatIpv4,
  parseCidr,
  planVlsm,
  prefixForHosts,
  splitSubnets,
} from './ipv4.ts';

describe('ipv4 tools', () => {
  test('parses networks and derives ranges', () => {
    const network = parseCidr('10.0.0.130/24');
    expect(formatIpv4(network.network)).toBe('10.0.0.0');
    expect(formatIpv4(network.broadcast)).toBe('10.0.0.255');
    expect(network.usable).toBe(254);
    expect(formatIpv4(network.firstHost)).toBe('10.0.0.1');
    expect(formatIpv4(network.lastHost)).toBe('10.0.0.254');
  });

  test('handles /31 and /32 usable counts', () => {
    expect(parseCidr('10.0.0.0/31').usable).toBe(2);
    expect(parseCidr('10.0.0.1/32').usable).toBe(1);
    expect(formatIpv4(parseCidr('10.0.0.1/32').firstHost)).toBe('10.0.0.1');
  });

  test('splits a network and reports truncation', () => {
    const base = parseCidr('10.0.0.0/24');
    const split = splitSubnets(base, 26, 2);
    expect(split.count).toBe(4);
    expect(split.truncated).toBe(true);
    expect(split.subnets.map((row) => formatIpv4(row.network))).toEqual(['10.0.0.0', '10.0.0.64']);
  });

  test('rejects an invalid split direction', () => {
    expect(() => splitSubnets(parseCidr('10.0.0.0/24'), 16)).toThrow();
  });

  test('sizes prefixes from host counts', () => {
    expect(prefixForHosts(2)).toBe(30);
    expect(prefixForHosts(50)).toBe(26);
    expect(prefixForHosts(100)).toBe(25);
  });

  test('plans VLSM allocations largest first', () => {
    const plan = planVlsm(parseCidr('10.0.0.0/24'), [
      { name: 'LAN', request: '100' },
      { name: 'WAN', request: '2' },
      { name: 'DMZ', request: '50' },
    ]);
    expect(plan.allocations.map((row) => `${row.name} /${row.prefix}`)).toEqual([
      'LAN /25',
      'DMZ /26',
      'WAN /30',
    ]);
    expect(formatIpv4(plan.allocations[0]!.network)).toBe('10.0.0.0');
    expect(formatIpv4(plan.allocations[1]!.network)).toBe('10.0.0.128');
    expect(formatIpv4(plan.allocations[2]!.network)).toBe('10.0.0.192');
    expect(plan.freeAddresses).toBe(60);
  });

  test('reports requirements that do not fit', () => {
    const plan = planVlsm(parseCidr('10.0.0.0/24'), [{ name: 'Too big', request: '300' }]);
    expect(plan.allocations).toHaveLength(0);
    expect(plan.errors[0]).toContain('larger than the base');
  });

  test('checks overlap and containment', () => {
    const outer = parseCidr('10.0.0.0/16');
    const inner = parseCidr('10.0.4.0/24');
    expect(checkOverlap(outer, inner).overlap).toBe(true);
    expect(checkOverlap(outer, inner).container).toBe('a');
    expect(checkOverlap(parseCidr('10.0.0.0/24'), parseCidr('10.0.1.0/24')).overlap).toBe(false);
  });
});

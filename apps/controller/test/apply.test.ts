import { describe, expect, test } from 'bun:test';
import type { LinkRow, LinkType, ProjectApplyLinkInput } from '@netlabor/contract';
import { type ApplyNodePlan, planApplyLinks } from '../src/services/apply.ts';

const PROJECT_ID = '11111111-1111-7111-8111-111111111111';
const NODE_A = '22222222-2222-7222-8222-222222222222';
const NODE_B = '33333333-3333-7333-8333-333333333333';
const NODE_C = '44444444-4444-7444-8444-444444444444';
const IT = '2026-01-01T00:00:00.000+00:00';

function switchPlan(name: string, portCount: number, existingId: string | null): ApplyNodePlan {
  return {
    name,
    existingId,
    ports: Array.from({ length: portCount }, (_unused, index) => ({
      adapter: 0,
      port: index,
      name: `Ethernet${index}`,
      type: 'ethernet' as const,
    })),
  };
}

function linkRow(
  id: string,
  a: string,
  aPort: number,
  b: string,
  bPort: number,
  linkType: LinkType = 'ethernet',
): LinkRow {
  return {
    id,
    projectId: PROJECT_ID,
    linkType,
    nodeAId: a,
    nodeAName: 'a',
    adapterA: 0,
    portA: aPort,
    nodeBId: b,
    nodeBName: 'b',
    adapterB: 0,
    portB: bPort,
    suspend: false,
    status: 'active',
    style: { type: 'orthogonal' },
    filters: {},
    capture: null,
    dataplane: null,
    createdAt: IT,
    updatedAt: IT,
  };
}

function manifestLinks(
  ...entries: { a: string; b: string; aPort?: string; bPort?: string }[]
): ProjectApplyLinkInput[] {
  return entries.map((entry) => ({
    a: entry.a,
    b: entry.b,
    type: 'ethernet',
    ...(entry.aPort ? { aPort: entry.aPort } : {}),
    ...(entry.bPort ? { bPort: entry.bPort } : {}),
  }));
}

describe('planApplyLinks', () => {
  test('allocates the next free port and fails once a node runs out', () => {
    const plans = new Map<string, ApplyNodePlan>([
      ['a', switchPlan('a', 2, NODE_A)],
      ['b', switchPlan('b', 2, NODE_B)],
      ['c', switchPlan('c', 2, NODE_C)],
    ]);
    const existing = [linkRow('55555555-5555-7555-8555-555555555555', NODE_A, 0, NODE_C, 0)];

    const [plan] = planApplyLinks(plans, existing, manifestLinks({ a: 'a', b: 'b' }));
    expect(plan?.matched).toBeNull();
    expect(plan?.a).toMatchObject({ adapter: 0, port: 1 });
    expect(plan?.b).toMatchObject({ adapter: 0, port: 0 });

    const single = new Map<string, ApplyNodePlan>([
      ['a', switchPlan('a', 1, NODE_A)],
      ['b', switchPlan('b', 1, NODE_B)],
      ['c', switchPlan('c', 1, NODE_C)],
    ]);
    expect(() => planApplyLinks(single, existing, manifestLinks({ a: 'a', b: 'b' }))).toThrow(
      /no free ethernet port on node a/,
    );
  });

  test('reuses an existing link between the same nodes in reverse orientation', () => {
    const plans = new Map<string, ApplyNodePlan>([
      ['a', switchPlan('a', 2, NODE_A)],
      ['b', switchPlan('b', 2, NODE_B)],
    ]);
    const existing = [linkRow('55555555-5555-7555-8555-555555555555', NODE_B, 1, NODE_A, 0)];

    const result = planApplyLinks(plans, existing, manifestLinks({ a: 'a', b: 'b' }));
    expect(result).toHaveLength(1);
    expect(result[0]?.matched?.id).toBe(existing[0]?.id as string);
    expect(result[0]?.a).toMatchObject({ adapter: 0, port: 0 });
    expect(result[0]?.b).toMatchObject({ adapter: 0, port: 1 });
  });

  test('rejects one-sided explicit ports and unknown nodes', () => {
    const plans = new Map<string, ApplyNodePlan>([
      ['a', switchPlan('a', 2, NODE_A)],
      ['b', switchPlan('b', 2, NODE_B)],
    ]);
    expect(() =>
      planApplyLinks(plans, [], manifestLinks({ a: 'a', b: 'b', aPort: 'Ethernet0' })),
    ).toThrow(/aPort and bPort must be supplied together/);
    expect(() => planApplyLinks(plans, [], manifestLinks({ a: 'a', b: 'zz' }))).toThrow(
      /unknown node zz/,
    );
  });

  test('rejects an explicit port that an existing link already uses', () => {
    const plans = new Map<string, ApplyNodePlan>([
      ['a', switchPlan('a', 2, NODE_A)],
      ['b', switchPlan('b', 2, NODE_B)],
      ['c', switchPlan('c', 2, NODE_C)],
    ]);
    const existing = [linkRow('55555555-5555-7555-8555-555555555555', NODE_A, 0, NODE_C, 0)];

    expect(() =>
      planApplyLinks(
        plans,
        existing,
        manifestLinks({ a: 'a', b: 'b', aPort: 'Ethernet0', bPort: 'Ethernet0' }),
      ),
    ).toThrow(/port Ethernet0 on node a is already linked/);
  });
});

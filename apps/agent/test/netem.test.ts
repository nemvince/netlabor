import { describe, expect, test } from 'bun:test';
import { netemArgs } from '../src/dataplane/link.ts';

describe('netemArgs', () => {
  test('empty filters produce no qdisc', () => {
    expect(netemArgs({})).toEqual([]);
  });

  test('all parameters compose into one arg list', () => {
    expect(
      netemArgs({ delayMs: 100, jitterMs: 20, lossPct: 5, corruptPct: 1, rateKbps: 2048 }),
    ).toEqual(['delay', '100ms', 'jitter', '20ms', 'loss', '5%', 'corrupt', '1%', 'rate', '2048kbit']);
  });

  test('jitter without delay is dropped (tc netem requirement)', () => {
    expect(netemArgs({ jitterMs: 20 })).toEqual([]);
    expect(netemArgs({ delayMs: 0, jitterMs: 20 })).toEqual([]);
  });

  test('loss-only links work (single qdisc, no change calls)', () => {
    expect(netemArgs({ lossPct: 10 })).toEqual(['loss', '10%']);
  });
});

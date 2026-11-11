import { describe, expect, test } from 'bun:test';
import { parseMarkerLine } from '../src/markers/sink.ts';

describe('ubridge marker lines', () => {
  test('parses a tx hit', () => {
    const hit = parseMarkerLine(
      'MARK 1699999999.123456 node=proj1 filter=icmp link=abc tag=7 len=98 dir=tx',
    );
    expect(hit).toEqual({
      ts: 1699999999.123456,
      nodeId: 'proj1',
      filter: 'icmp',
      linkId: 'abc',
      tag: 7,
      length: 98,
      direction: 'tx',
    });
  });

  test('rejects unrelated lines', () => {
    expect(parseMarkerLine('MARK blah')).toBeNull();
    expect(parseMarkerLine('')).toBeNull();
    expect(parseMarkerLine('100-OK')).toBeNull();
  });
});

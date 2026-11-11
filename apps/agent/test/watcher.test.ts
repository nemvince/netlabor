import { describe, expect, test } from 'bun:test';
import { readFrames } from '../src/markers/watcher.ts';

function pcap(packets: number[][]): Uint8Array {
  const header = new Uint8Array(24);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0xa1b2c3d4, true);
  view.setUint32(4, 2, true);
  view.setUint32(20, 65535, true);
  const parts: Uint8Array[] = [header];
  for (const packet of packets) {
    const record = new Uint8Array(16);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(8, packet.length, true);
    recordView.setUint32(12, packet.length, true);
    parts.push(record, new Uint8Array(packet));
  }
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

describe('marker pcap reader', () => {
  test('reads complete frames only', () => {
    const bytes = pcap([
      [1, 2, 3, 4],
      [5, 6, 7],
    ]);
    const { lengths, offset } = readFrames(bytes, 24);
    expect(lengths).toEqual([4, 3]);
    expect(offset).toBe(bytes.byteLength);
  });

  test('stops at a partial trailing record', () => {
    const bytes = pcap([[1, 2, 3, 4]]);
    const truncated = bytes.subarray(0, bytes.byteLength - 2);
    const { lengths, offset } = readFrames(truncated, 24);
    expect(lengths).toEqual([]);
    expect(offset).toBe(24);
  });

  test('resumes from a previous offset', () => {
    const bytes = pcap([
      [1, 2],
      [3, 4],
    ]);
    const first = readFrames(bytes, 24);
    expect(first.lengths).toEqual([2, 2]);
    const second = readFrames(bytes, first.offset);
    expect(second.lengths).toEqual([]);
  });
});

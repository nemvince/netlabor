import { describe, expect, test } from 'bun:test';
import { TelnetCodec, telnetEncode, telnetWindowSize } from '../src/telnet.ts';

function collect() {
  const data: Uint8Array[] = [];
  const windows: Array<{ cols: number; rows: number }> = [];
  const codec = new TelnetCodec({
    onData: (chunk) => data.push(chunk),
    onWindowSize: (cols, rows) => windows.push({ cols, rows }),
    onTerminalType: () => 'xterm-256color',
  });
  return { codec, data, windows, text: () => new TextDecoder().decode(concat(data)) };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe('telnet codec', () => {
  test('passes plain data through', () => {
    const { codec, text } = collect();
    codec.push(new TextEncoder().encode('Router#'));
    expect(text()).toBe('Router#');
  });

  test('unescapes 0xFF', () => {
    const { codec, data } = collect();
    codec.push(new Uint8Array([0x41, 0xff, 0xff, 0x42]));
    expect(data.flatMap((chunk) => [...chunk])).toEqual([0x41, 0xff, 0x42]);
  });

  test('handles negotiation split across chunks', () => {
    const verbs: string[] = [];
    const codec = new TelnetCodec({
      onData: () => undefined,
      onNegotiation: (verb, option) => verbs.push(`${verb}:${option}`),
    });
    codec.push(new Uint8Array([255, 251]));
    codec.push(new Uint8Array([1]));
    expect(verbs).toEqual(['will:1']);
  });

  test('parses NAWS window size', () => {
    const { codec, windows } = collect();
    codec.push(new Uint8Array([255, 250, 31, 0, 120, 0, 40, 255, 240]));
    expect(windows).toEqual([{ cols: 120, rows: 40 }]);
  });

  test('encodes escapes and window size', () => {
    expect([...telnetEncode(new Uint8Array([0xff]))]).toEqual([0xff, 0xff]);
    expect([...telnetWindowSize(80, 24)]).toEqual([255, 250, 31, 0, 80, 0, 24, 255, 240]);
  });
});

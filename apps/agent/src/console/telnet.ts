/** Minimal telnet server negotiation for emulator serial consoles. */

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;

/**
 * Strip server-side telnet negotiation from an upstream console stream.
 * Replies are returned separately so the caller can write them back upstream.
 */
export class TelnetFilter {
  private state: 'data' | 'iac' | 'verb' | 'option' | 'subneg' | 'subnegIac' = 'data';
  private verb = 0;

  feed(chunk: Uint8Array): { data: Uint8Array; replies: Uint8Array } {
    const data: number[] = [];
    const replies: number[] = [];
    for (const byte of chunk) {
      switch (this.state) {
        case 'data':
          if (byte === IAC) this.state = 'iac';
          else data.push(byte);
          break;
        case 'iac':
          if (byte === IAC) {
            data.push(IAC);
            this.state = 'data';
          } else if (byte === WILL || byte === WONT || byte === DO || byte === DONT) {
            this.verb = byte;
            this.state = 'option';
          } else if (byte === SB) {
            this.state = 'subneg';
          } else {
            this.state = 'data';
          }
          break;
        case 'option':
          if (this.verb === WILL) replies.push(IAC, DO, byte);
          else if (this.verb === WONT) replies.push(IAC, DONT, byte);
          else if (this.verb === DO) replies.push(IAC, WILL, byte);
          else replies.push(IAC, WONT, byte);
          this.state = 'data';
          break;
        case 'subneg':
          if (byte === IAC) this.state = 'subnegIac';
          break;
        case 'subnegIac':
          this.state = byte === SE ? 'data' : 'subneg';
          break;
      }
    }
    return { data: Uint8Array.from(data), replies: Uint8Array.from(replies) };
  }
}

/** Encode a NAWS window-size frame (client -> server). */
export function nawsFrame(cols: number, rows: number): Uint8Array {
  return Uint8Array.from([
    IAC,
    SB,
    31,
    (cols >> 8) & 255,
    cols & 255,
    (rows >> 8) & 255,
    rows & 255,
    IAC,
    SE,
  ]);
}

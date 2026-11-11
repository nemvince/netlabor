/**
 * Telnet codec: IAC negotiation, NAWS window sizing, TTYPE, and SGA/ECHO.
 * Used by the agent both as a server (external clients) and as a client
 * (QEMU serial ports), so it is direction-agnostic: it parses incoming bytes
 * and emits negotiation events the caller can answer.
 */

export const TELNET = {
  SE: 240,
  SB: 250,
  WILL: 251,
  WONT: 252,
  DO: 253,
  DONT: 254,
  IAC: 255,
} as const;

export const OPTION = {
  ECHO: 1,
  SGA: 3,
  TTYPE: 24,
  NAWS: 31,
} as const;

export interface TelnetHandlers {
  onData(data: Uint8Array): void;
  onWindowSize?(cols: number, rows: number): void;
  /** Return the terminal type string to answer a TTYPE SEND request with. */
  onTerminalType?(): string;
  onNegotiation?(verb: 'will' | 'wont' | 'do' | 'dont', option: number): void;
}

enum State {
  Data,
  Iac,
  Negotiation,
  SubnegOption,
  SubnegData,
  SubnegIac,
}

/** Escape raw payload bytes for transmission (0xFF doubled). */
export function telnetEncode(payload: Uint8Array): Uint8Array {
  let escapes = 0;
  for (const byte of payload) if (byte === TELNET.IAC) escapes++;
  if (escapes === 0) return payload;
  const out = new Uint8Array(payload.length + escapes);
  let index = 0;
  for (const byte of payload) {
    out[index++] = byte;
    if (byte === TELNET.IAC) out[index++] = TELNET.IAC;
  }
  return out;
}

export function telnetCommand(
  verb: typeof TELNET.WILL | typeof TELNET.WONT | typeof TELNET.DO | typeof TELNET.DONT,
  option: number,
): Uint8Array {
  return new Uint8Array([TELNET.IAC, verb, option]);
}

/** Server-side opening negotiation: we echo, suppress GA, and ask for NAWS/TTYPE. */
export function initialServerNegotiation(): Uint8Array {
  return new Uint8Array([
    TELNET.IAC,
    TELNET.WILL,
    OPTION.ECHO,
    TELNET.IAC,
    TELNET.WILL,
    OPTION.SGA,
    TELNET.IAC,
    TELNET.DO,
    OPTION.SGA,
    TELNET.IAC,
    TELNET.DO,
    OPTION.NAWS,
    TELNET.IAC,
    TELNET.DO,
    OPTION.TTYPE,
  ]);
}

export class TelnetCodec {
  private state: State = State.Data;
  private verb = 0;
  private subnegOption = 0;
  private subneg = new Uint8Array(256);
  private subnegLength = 0;
  private pendingData: Uint8Array[] = [];

  constructor(private readonly handlers: TelnetHandlers) {}

  push(chunk: Uint8Array): void {
    for (const byte of chunk) this.consume(byte);
    if (this.pendingData.length > 0) {
      const total = this.pendingData.reduce((sum, part) => sum + part.length, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const part of this.pendingData) {
        merged.set(part, offset);
        offset += part.length;
      }
      this.pendingData = [];
      this.handlers.onData(merged);
    }
  }

  private flushData(byte: number): void {
    // Accumulate one byte at a time; adjacent bytes are merged by push().
    this.pendingData.push(new Uint8Array([byte]));
  }

  private consume(byte: number): void {
    switch (this.state) {
      case State.Data:
        if (byte === TELNET.IAC) this.state = State.Iac;
        else this.flushData(byte);
        return;

      case State.Iac:
        if (byte === TELNET.IAC) {
          this.flushData(TELNET.IAC);
          this.state = State.Data;
        } else if (byte === TELNET.SB) {
          this.state = State.SubnegOption;
        } else if (
          byte === TELNET.WILL ||
          byte === TELNET.WONT ||
          byte === TELNET.DO ||
          byte === TELNET.DONT
        ) {
          this.verb = byte;
          this.state = State.Negotiation;
        } else {
          this.state = State.Data;
        }
        return;

      case State.Negotiation: {
        this.state = State.Data;
        const verb =
          this.verb === TELNET.WILL
            ? 'will'
            : this.verb === TELNET.WONT
              ? 'wont'
              : this.verb === TELNET.DO
                ? 'do'
                : 'dont';
        this.handlers.onNegotiation?.(verb, byte);
        return;
      }

      case State.SubnegOption:
        this.subnegOption = byte;
        this.subnegLength = 0;
        this.state = State.SubnegData;
        return;

      case State.SubnegData:
        if (byte === TELNET.IAC) this.state = State.SubnegIac;
        else if (this.subnegLength < this.subneg.length) this.subneg[this.subnegLength++] = byte;
        return;

      case State.SubnegIac:
        if (byte === TELNET.IAC) {
          if (this.subnegLength < this.subneg.length) this.subneg[this.subnegLength++] = byte;
          this.state = State.SubnegData;
        } else if (byte === TELNET.SE) {
          this.handleSubnegotiation(this.subnegOption, this.subneg.subarray(0, this.subnegLength));
          this.state = State.Data;
        } else {
          this.state = State.Data;
        }
        return;
    }
  }

  private handleSubnegotiation(option: number, payload: Uint8Array): void {
    if (option === OPTION.NAWS && payload.length >= 4) {
      const cols = ((payload[0] ?? 0) << 8) | (payload[1] ?? 0);
      const rows = ((payload[2] ?? 0) << 8) | (payload[3] ?? 0);
      this.handlers.onWindowSize?.(cols, rows);
      return;
    }
    if (option === OPTION.TTYPE && payload[0] === 1 /* SEND */) {
      const type = this.handlers.onTerminalType?.() ?? 'xterm-256color';
      const bytes = new TextEncoder().encode(type);
      const answer = new Uint8Array(bytes.length + 6);
      answer.set([TELNET.IAC, TELNET.SB, OPTION.TTYPE, 0 /* IS */]);
      answer.set(bytes, 4);
      answer[4 + bytes.length] = TELNET.IAC;
      answer[5 + bytes.length] = TELNET.SE;
      this.handlers.onData(answer);
    }
  }
}

/** Encode a NAWS payload for clients that negotiate NAWS as a client. */
export function telnetWindowSize(cols: number, rows: number): Uint8Array {
  return new Uint8Array([
    TELNET.IAC,
    TELNET.SB,
    OPTION.NAWS,
    (cols >> 8) & 0xff,
    cols & 0xff,
    (rows >> 8) & 0xff,
    rows & 0xff,
    TELNET.IAC,
    TELNET.SE,
  ]);
}

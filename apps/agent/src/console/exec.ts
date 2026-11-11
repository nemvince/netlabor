/** Console command execution: driven by fault injection and integration tests. */

import { AppError } from '@netlabor/contract';
import type { ProjectRegistry } from '../state.ts';

export interface ExecConsoleOptions {
  projectId: string;
  nodeId: string;
  commands: string[];
  timeoutMs: number;
  prompt?: string | null;
  terminalLengthZero?: boolean;
}

const DEFAULT_PROMPT = /[>#]\s*$/;

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;

/**
 * Strip telnet negotiation from the console stream and decline every option.
 * VPCS waits for option replies before it accepts commands, while IOS-style
 * consoles send no IAC at all and pass through untouched.
 */
function telnetFilter(write: (bytes: Uint8Array) => void): (chunk: Uint8Array) => string {
  let state: 'data' | 'iac' | 'option' | 'subneg' | 'subnegIac' = 'data';
  let verb = 0;
  return (chunk) => {
    const out: number[] = [];
    for (const byte of chunk) {
      switch (state) {
        case 'data':
          if (byte === IAC) state = 'iac';
          else out.push(byte);
          break;
        case 'iac':
          if (byte === IAC) {
            out.push(IAC);
            state = 'data';
          } else if (byte === WILL || byte === DO || byte === WONT || byte === DONT) {
            verb = byte;
            state = 'option';
          } else if (byte === SB) {
            state = 'subneg';
          } else {
            state = 'data';
          }
          break;
        case 'option':
          if (verb === WILL) write(new Uint8Array([IAC, DONT, byte]));
          else if (verb === DO) write(new Uint8Array([IAC, WONT, byte]));
          state = 'data';
          break;
        case 'subneg':
          if (byte === IAC) state = 'subnegIac';
          break;
        case 'subnegIac':
          state = byte === SE ? 'data' : 'subneg';
          break;
      }
    }
    return new TextDecoder().decode(Uint8Array.from(out));
  };
}

/** Send command lines to a node's internal console and return the transcript. */
export async function execConsole(
  registry: ProjectRegistry,
  options: ExecConsoleOptions,
  dockerSocket?: string,
): Promise<{ transcript: string; ok: boolean; timedOut: boolean }> {
  const node = registry.node(options.nodeId);
  if (node?.status !== 'started') {
    throw new AppError('NODE_NOT_RUNNING', 'node is not running');
  }
  if (node.nodeType === 'qemu') {
    const { serialExec } = await import('./serial.ts');
    const prompt = options.prompt ? new RegExp(options.prompt) : DEFAULT_PROMPT;
    return serialExec(options.nodeId, options.commands, options.timeoutMs, prompt);
  }
  if (node.nodeType === 'iou') {
    const { execIouConsole } = await import('../emulators/iou.ts');
    const prompt = options.prompt ? new RegExp(options.prompt) : DEFAULT_PROMPT;
    const commands =
      options.terminalLengthZero === false
        ? options.commands
        : ['terminal length 0', ...options.commands];
    return execIouConsole(registry, options.nodeId, commands, options.timeoutMs, prompt);
  }
  if (node.nodeType === 'docker') {
    const containerId = node.extra.containerId;
    if (!containerId || !dockerSocket) {
      throw new AppError('BAD_REQUEST', 'container is not available for exec');
    }
    const { DockerClient } = await import('../emulators/docker-client.ts');
    const client = new DockerClient(dockerSocket);
    const response = await client.execAttached(containerId, [
      '/bin/sh',
      '-lc',
      options.commands.join('\n'),
    ]);
    const transcript = await response.text();
    return { transcript, ok: true, timedOut: false };
  }
  const internalPort = node.internalConsolePort;
  const project = registry.get(options.projectId);
  if (!internalPort || !project) throw new AppError('BAD_REQUEST', 'node has no console');
  const prompt = options.prompt ? new RegExp(options.prompt) : DEFAULT_PROMPT;

  const commands =
    options.terminalLengthZero !== false &&
    (node.nodeType === 'iou' || node.nodeType === 'dynamips')
      ? ['terminal length 0', ...options.commands]
      : options.commands;

  let transcript = '';
  let timedOut = false;
  let filter: ((chunk: Uint8Array) => string) | null = null;

  const socket = await Bun.connect({
    hostname: project.projectIp,
    port: internalPort,
    socket: {
      data(_socket, data) {
        transcript += filter?.(new Uint8Array(data)) ?? '';
      },
      open() {},
      close() {},
      error() {},
    },
  });
  filter = telnetFilter((bytes) => socket.write(bytes));

  /**
   * Wait until the transcript past `cursor` ends with the prompt. Matching only
   * fresh output avoids treating the prompt printed before the command as the
   * completion of the command.
   */
  const waitForPrompt = async (cursor: number, timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (prompt.test(transcript.slice(cursor))) return true;
      await Bun.sleep(50);
    }
    return false;
  };

  try {
    // Wait for the banner/prompt so the first command is not eaten by telnet
    // option negotiation. If a device is sitting at an unexpected prompt,
    // retain the banner in the returned transcript instead of hiding the clue.
    const ready = await waitForPrompt(0, Math.min(options.timeoutMs, 5_000));
    if (ready) transcript = '';
    for (const command of commands) {
      const cursor = transcript.length;
      socket.write(`${command}\r\n`);
      const matched = await waitForPrompt(cursor, options.timeoutMs);
      if (!matched) {
        timedOut = true;
        break;
      }
    }
    await Bun.sleep(50);
  } finally {
    socket.end();
  }

  return { transcript, ok: !timedOut, timedOut };
}

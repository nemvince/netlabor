/**
 * ubridge marker sink: a UDP socket per project that receives
 * `MARK <ts> node=<id> filter=<name> link=<id> tag=<n> len=<n> dir=<tx|rx>`
 * lines and forwards them as marker.hit events.
 */

import type { Logger } from '@netlabor/shared';

export interface MarkerHit {
  projectId: string;
  ts: number;
  nodeId: string;
  filter: string;
  linkId: string;
  tag: number;
  length: number;
  direction: 'tx' | 'rx';
}

const LINE =
  /MARK\s+(\S+)\s+node=(\S+)\s+filter=(\S+)\s+link=(\S+)\s+tag=(\d+)\s+len=(\d+)\s+dir=(tx|rx)/;

export type ParsedMarker = Omit<MarkerHit, 'projectId'>;

/** Parse one ubridge marker line; returns null for anything else. */
export function parseMarkerLine(line: string): ParsedMarker | null {
  const match = LINE.exec(line.trim());
  if (!match) return null;
  const [, timestamp, nodeId, filter, linkId, tag, length, direction] = match;
  return {
    ts: Number(timestamp) || 0,
    nodeId: nodeId ?? '',
    filter: filter ?? '',
    linkId: linkId ?? '',
    tag: Number(tag ?? 0),
    length: Number(length ?? 0),
    direction: direction === 'rx' ? 'rx' : 'tx',
  };
}

export interface MarkerSink {
  port: number;
  stop(): void;
}

/** Bind the sink UDP port on the host veth address for a project. */
export async function startMarkerSink(options: {
  host: string;
  port: number;
  projectId: string;
  logger: Logger;
  onHit: (hit: MarkerHit) => void;
}): Promise<MarkerSink> {
  const socket = await Bun.udpSocket({
    hostname: options.host,
    port: options.port,
    socket: {
      data(_socket, data) {
        const text = new TextDecoder().decode(data);
        options.logger.debug('marker datagram', {
          projectId: options.projectId,
          text: text.slice(0, 120),
        });
        for (const line of text.split('\n')) {
          const parsed = parseMarkerLine(line);
          if (!parsed) continue;
          const hit: MarkerHit = { ...parsed, projectId: options.projectId };
          try {
            options.onHit(hit);
          } catch (error) {
            options.logger.warn('marker callback failed', {
              projectId: options.projectId,
              err: error instanceof Error ? error.message : String(error),
            });
          }
        }
      },
    },
  });
  options.logger.info('marker sink listening', {
    projectId: options.projectId,
    host: options.host,
    port: options.port,
  });
  return {
    port: options.port,
    stop() {
      try {
        socket.close();
      } catch {
        // already closed
      }
    },
  };
}

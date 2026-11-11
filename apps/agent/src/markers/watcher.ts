/**
 * Marker hit watcher. ubridge writes matching packets to a per-marker pcap;
 * the watcher tails those files and emits one hit per new frame, which keeps
 * hit events working for both kernel and relay links.
 */

import type { Logger } from '@netlabor/shared';

export interface MarkerDescriptor {
  projectId: string;
  linkId: string;
  name: string;
  tag: number;
  direction: 'tx' | 'rx' | null;
  pcapPath: string;
}

export interface MarkerHitEvent {
  projectId: string;
  linkId: string;
  name: string;
  tag: number;
  direction: 'tx' | 'rx';
  length: number;
  timestampMs: number;
}

const PCAP_HEADER = 24;
const RECORD_HEADER = 16;

interface MarkerState {
  descriptor: MarkerDescriptor;
  offset: number;
  frames: number;
}

/** Count packets in a pcap byte range, returning frame lengths and new offset. */
export function readFrames(
  buffer: Uint8Array,
  fromOffset: number,
): { lengths: number[]; offset: number } {
  const lengths: number[] = [];
  let offset = Math.max(fromOffset, PCAP_HEADER);
  while (offset + RECORD_HEADER <= buffer.byteLength) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset, RECORD_HEADER);
    const inclLength = view.getUint32(8, true);
    if (offset + RECORD_HEADER + inclLength > buffer.byteLength) break;
    lengths.push(inclLength);
    offset += RECORD_HEADER + inclLength;
  }
  return { lengths, offset };
}

export class MarkerWatcher {
  private readonly markers = new Map<string, MarkerState>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly logger: Logger,
    private readonly emit: (event: MarkerHitEvent) => void,
  ) {}

  start(intervalMs = 500): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  register(
    projectId: string,
    linkId: string,
    markers: Omit<MarkerDescriptor, 'projectId' | 'linkId'>[],
  ): void {
    this.unregisterLink(projectId, linkId);
    for (const marker of markers) {
      const key = `${projectId}:${linkId}:${marker.name}`;
      this.markers.set(key, {
        descriptor: { ...marker, projectId, linkId },
        offset: PCAP_HEADER,
        frames: 0,
      });
    }
  }

  unregisterLink(projectId: string, linkId: string): void {
    for (const [key, state] of this.markers) {
      if (state.descriptor.projectId === projectId && state.descriptor.linkId === linkId) {
        this.markers.delete(key);
      }
    }
  }

  private async poll(): Promise<void> {
    for (const state of this.markers.values()) {
      const { descriptor } = state;
      try {
        const file = Bun.file(descriptor.pcapPath);
        const size = await file.size;
        if (size <= state.offset) continue;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { lengths, offset } = readFrames(bytes, state.offset);
        state.offset = offset;
        state.frames += lengths.length;
        for (const length of lengths) {
          this.emit({
            projectId: descriptor.projectId,
            linkId: descriptor.linkId,
            name: descriptor.name,
            tag: descriptor.tag,
            direction: descriptor.direction ?? 'tx',
            length,
            timestampMs: Date.now(),
          });
        }
      } catch (error) {
        this.logger.debug('marker pcap read failed', {
          projectId: descriptor.projectId,
          linkId: descriptor.linkId,
          name: descriptor.name,
          err: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

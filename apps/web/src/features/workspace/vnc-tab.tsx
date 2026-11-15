import type { ConsoleTicketOutput } from '@netlabor/contract';
import RFB from '@novnc/novnc';
import { MonitorIcon as Monitor  } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { client } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';

function socketUrl(wsUrl: string): string {
  // The controller ticket endpoint reports the console path for both purposes;
  // the VNC ticket is only accepted by the /ws/vnc upgrade.
  const path = wsUrl.replace('/ws/console/', '/ws/vnc/');
  if (path.startsWith('/')) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${path}`;
  }
  return path;
}

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';
type ConsoleTicket = z.infer<typeof ConsoleTicketOutput>;

interface RfbCursor {
  change(rgba: Uint8Array, hotx: number, hoty: number, w: number, h: number): void;
}

interface RfbDisplay {
  scale: number;
  _rescale(factor: number): void;
}

/**
 * noVNC draws the server cursor at framebuffer size even when the framebuffer
 * is scaled to fit, so its hotspot drifts from the pointer (novnc/noVNC#1128).
 * Redraw the cursor, hotspot included, at the current display scale.
 */
function scaleCursorWithViewport(rfb: RFB): void {
  const internals = rfb as unknown as { _display?: RfbDisplay; _cursor?: RfbCursor };
  const display = internals._display;
  const cursor = internals._cursor;
  if (!display || !cursor) return;

  const originalChange = cursor.change.bind(cursor);
  let last: { rgba: Uint8Array; hotx: number; hoty: number; w: number; h: number } | null = null;

  const draw = () => {
    if (!last) return;
    const { rgba, hotx, hoty, w, h } = last;
    const scale = display.scale;
    if (!Number.isFinite(scale) || scale <= 0 || scale === 1 || w === 0 || h === 0) {
      originalChange(rgba, hotx, hoty, w, h);
      return;
    }
    const width = Math.max(1, Math.round(w * scale));
    const height = Math.max(1, Math.round(h * scale));
    const source = document.createElement('canvas');
    source.width = w;
    source.height = h;
    source.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
    const scaled = document.createElement('canvas');
    scaled.width = width;
    scaled.height = height;
    const context = scaled.getContext('2d');
    if (!context) {
      originalChange(rgba, hotx, hoty, w, h);
      return;
    }
    context.drawImage(source, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    originalChange(
      new Uint8Array(image.data.buffer),
      Math.round(hotx * scale),
      Math.round(hoty * scale),
      width,
      height,
    );
  };

  cursor.change = (rgba, hotx, hoty, w, h) => {
    last = { rgba, hotx, hoty, w, h };
    draw();
  };
  if (typeof display._rescale === 'function') {
    const rescale = display._rescale.bind(display);
    display._rescale = (factor) => {
      rescale(factor);
      draw();
    };
  }
}

interface RfbDetail {
  clean?: boolean;
  name?: string;
  reason?: string;
  status?: string;
}

function rfbDetail(event: Event): RfbDetail {
  if (!(event instanceof CustomEvent)) return {};
  const detail: unknown = event.detail;
  if (typeof detail !== 'object' || detail === null) return {};
  const result: RfbDetail = {};
  if ('clean' in detail && typeof detail.clean === 'boolean') result.clean = detail.clean;
  if ('name' in detail && typeof detail.name === 'string') result.name = detail.name;
  if ('reason' in detail && typeof detail.reason === 'string') result.reason = detail.reason;
  if ('status' in detail && typeof detail.status === 'string') result.status = detail.status;
  return result;
}

/**
 * noVNC surface over the controller VNC WebSocket. Tickets are single-use, so
 * every reconnect buys a fresh one before handing the URL to noVNC.
 */
export function VncTab({ nodeId, label }: { nodeId: string; label: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ConnectionState>('connecting');
  const [notice, setNotice] = useState<string | null>(null);
  const [desktop, setDesktop] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let rfb: RFB | null = null;
    let retryTimer: number | undefined;
    let attempt = 0;

    const scheduleReconnect = () => {
      if (disposed) return;
      const delay = Math.min(800 * 2 ** attempt, 10_000);
      attempt += 1;
      setState('closed');
      retryTimer = window.setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      if (disposed) return;
      setState('connecting');
      setNotice(null);
      let ticket: ConsoleTicket;
      try {
        ticket = await client.nodes.consoleTicket({ id: nodeId, purpose: 'vnc' });
      } catch (error) {
        if (disposed) return;
        setState('error');
        setNotice(messageOf(error));
        scheduleReconnect();
        return;
      }
      if (disposed) return;

      try {
        rfb = new RFB(container, socketUrl(ticket.wsUrl), { shared: true });
      } catch (error) {
        setState('error');
        setNotice(messageOf(error));
        scheduleReconnect();
        return;
      }

      const surface = rfb;
      surface.background = '#111417';
      surface.scaleViewport = true;
      surface.resizeSession = true;
      surface.focusOnClick = true;
      surface.showDotCursor = true;
      scaleCursorWithViewport(surface);

      surface.addEventListener('connect', () => {
        if (disposed) return;
        attempt = 0;
        setState('open');
        setNotice(null);
        surface.focus();
      });
      surface.addEventListener('desktopname', (event) => {
        const detail = rfbDetail(event);
        if (detail.name) setDesktop(detail.name);
      });
      surface.addEventListener('credentialsrequired', () => {
        if (disposed) return;
        setNotice('The VNC server requested credentials. Set the node console password.');
      });
      surface.addEventListener('securityfailure', (event) => {
        const detail = rfbDetail(event);
        setState('error');
        setNotice(`VNC security failure: ${detail.reason ?? detail.status ?? 'unknown'}`);
      });
      surface.addEventListener('disconnect', (event) => {
        if (disposed) return;
        if (rfbDetail(event).clean === true) setNotice('The VNC server closed the session.');
        scheduleReconnect();
      });
    };

    void connect();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      if (rfb) {
        const surface = rfb;
        rfb = null;
        try {
          surface.disconnect();
        } catch {
          // The RFB connection can already be gone.
        }
      }
    };
  }, [nodeId]);

  return (
    <section className="relative h-full w-full" aria-label={`VNC console for ${label}`}>
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ background: 'var(--color-panel-sunken)' }}
      />
      {state !== 'open' ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{ background: 'color-mix(in oklab, var(--color-panel-sunken) 78%, transparent)' }}
          role="status"
        >
          <div className="flex items-center gap-2 text-[12px]">
            <Monitor size={14} aria-hidden style={{ color: 'var(--color-ink-faint)' }} />
            <span
              style={{
                color: state === 'error' ? 'var(--color-signal-down)' : 'var(--color-ink-dim)',
              }}
            >
              {notice ?? (state === 'connecting' ? 'connecting to VNC…' : 'reconnecting…')}
            </span>
          </div>
        </div>
      ) : null}
      {desktop ? (
        <div
          className="pointer-events-none absolute top-1 right-2 rounded-[2px] border px-1.5 text-[10px]"
          style={{
            borderColor: 'var(--color-rule)',
            background: 'var(--color-panel)',
            color: 'var(--color-ink-faint)',
          }}
        >
          {desktop}
        </div>
      ) : null}
    </section>
  );
}

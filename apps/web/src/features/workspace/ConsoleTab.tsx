import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { ConsoleTicketOutput } from '@netlabor/contract';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { client } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';

function socketUrl(wsUrl: string): string {
  if (wsUrl.startsWith('/')) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${wsUrl}`;
  }
  return wsUrl;
}

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';
type ConsoleTicket = z.infer<typeof ConsoleTicketOutput>;

/**
 * xterm console over the controller console WebSocket. Tickets are single-use,
 * so every reconnect asks for a fresh one; backoff caps at ten seconds.
 */
export function ConsoleTab({ nodeId, label }: { nodeId: string; label: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ConnectionState>('connecting');
  const [lastError, setLastError] = useState<string | null>(null);

  const sendControl = useCallback((socket: WebSocket | null, cols: number, rows: number) => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'resize', cols, rows }));
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: '#121413',
        foreground: '#e9eee9',
        cursor: '#c98a52',
        selectionBackground: '#3a4a3f',
        black: '#121413',
        red: '#d9705f',
        green: '#79c98a',
        yellow: '#e0b45c',
        blue: '#7ba7d1',
        magenta: '#b48cc9',
        cyan: '#7bc9c4',
        white: '#e9eee9',
      },
    });
    const fit = new FitAddon();
    const links = new WebLinksAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(links);
    terminal.open(container);

    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let attempt = 0;

    function fitTerminal() {
      try {
        fit.fit();
      } catch {
        // The container can be zero-sized while the tab is hidden.
      }
    }

    function scheduleReconnect() {
      if (disposed) return;
      const delay = Math.min(1000 * 2 ** attempt, 10_000);
      attempt += 1;
      setState('closed');
      retryTimer = window.setTimeout(() => void connect(), delay);
    }

    async function connect() {
      if (disposed) return;
      setState('connecting');
      setLastError(null);
      let ticket: ConsoleTicket;
      try {
        ticket = await client.nodes.consoleTicket({ id: nodeId, purpose: 'console' });
      } catch (error) {
        if (disposed) return;
        setState('error');
        setLastError(messageOf(error));
        terminal.writeln(`\r\n\x1b[31m${messageOf(error)}\x1b[0m`);
        scheduleReconnect();
        return;
      }
      if (disposed) return;

      const next = new WebSocket(socketUrl(ticket.wsUrl));
      socket = next;
      next.binaryType = 'arraybuffer';
      next.onopen = () => {
        attempt = 0;
        setState('open');
        fitTerminal();
        sendControl(next, terminal.cols, terminal.rows);
        terminal.focus();
      };
      next.onmessage = (event: MessageEvent<string | ArrayBuffer | Blob>) => {
        if (typeof event.data === 'string') {
          terminal.write(event.data);
          return;
        }
        if (event.data instanceof ArrayBuffer) {
          terminal.write(new Uint8Array(event.data));
          return;
        }
        void event.data.arrayBuffer().then((buffer) => {
          if (!disposed) terminal.write(new Uint8Array(buffer));
        });
      };
      next.onerror = () => {
        if (next.readyState !== WebSocket.CLOSED) next.close();
      };
      next.onclose = () => {
        if (socket === next) socket = null;
        if (!disposed) scheduleReconnect();
      };
    }

    const dataSubscription = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(data);
    });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      sendControl(socket, cols, rows);
    });
    const observer = new ResizeObserver(() => fitTerminal());
    observer.observe(container);
    fitTerminal();
    void connect();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      observer.disconnect();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
      terminal.dispose();
    };
  }, [nodeId, sendControl]);

  return (
    <section className="relative h-full w-full" aria-label={`Console for ${label}`}>
      <div
        ref={containerRef}
        className="h-full w-full px-2 py-1"
        style={{ background: 'var(--color-panel-sunken)' }}
      />
      {state !== 'open' ? (
        <div
          className="pointer-events-none absolute top-1 right-2 rounded-[2px] border px-1.5 text-[10px]"
          style={{
            borderColor: 'var(--color-rule)',
            background: 'var(--color-panel)',
            color: lastError ? 'var(--color-signal-down)' : 'var(--color-signal-warn)',
          }}
          role="status"
        >
          {state === 'connecting'
            ? 'connecting…'
            : state === 'error'
              ? (lastError ?? 'console error')
              : 'reconnecting…'}
        </div>
      ) : null}
    </section>
  );
}

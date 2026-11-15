import type { CaptureTicketOutput } from '@netlabor/contract';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  CaretDownIcon as ChevronDown,
  CaretRightIcon as ChevronRight,
  DownloadSimpleIcon as Download,
  FunnelIcon as Filter,
  GitBranchIcon as GitBranch,
  CircleNotchIcon as LoaderCircle,
  ArrowsClockwiseIcon as RefreshCw,
  MagnifyingGlassIcon as Search,
  XIcon as X,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Badge } from '../../components/badge.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { Field, Input, Select } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { client } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { PacketAnalysisPanel } from './packet-analysis-panel.tsx';
import { Button, buttonVariants } from '@netlabor/ui/components/button';

interface WireFrameRow {
  num: number;
  c?: string[];
  bg?: string;
  fg?: string;
}

interface DetailNode {
  l?: string;
  f?: string;
  fn?: string;
  h?: [number, number];
  n?: DetailNode[];
}

interface SharkdStatus {
  frames?: number;
  columns?: string[];
  filename?: string;
}

interface FollowPayload {
  n: number;
  d: string;
  s?: number;
}

interface FollowResult {
  shost?: string;
  sport?: string;
  sbytes?: number;
  chost?: string;
  cport?: string;
  cbytes?: number;
  payloads?: FollowPayload[];
}

interface FollowerChoice {
  name: string;
  tap: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type SessionState = 'connecting' | 'live' | 'reconnecting' | 'closed';
type CaptureTicket = z.infer<typeof CaptureTicketOutput>;

const WsEnvelopeSchema = z.object({
  op: z.string().optional(),
  requestId: z.number().int().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

const SharkdStatusObjectSchema = z.object({
  frames: z.number().int().optional(),
  columns: z.array(z.string()).optional(),
  filename: z.string().optional(),
});
const SharkdStatusSchema = z.union([SharkdStatusObjectSchema, z.array(z.string())]);

const WireFrameRowSchema = z.object({
  num: z.number().int(),
  c: z.array(z.string()).optional(),
  bg: z.string().optional(),
  fg: z.string().optional(),
});

const FramesResultSchema = z.union([
  z.array(WireFrameRowSchema),
  z.object({ frames: z.array(WireFrameRowSchema) }),
]);

const DetailNodeSchema: z.ZodType<DetailNode> = z.lazy(() =>
  z.object({
    l: z.string().optional(),
    f: z.string().optional(),
    fn: z.string().optional(),
    h: z.tuple([z.number(), z.number()]).optional(),
    n: z.array(DetailNodeSchema).optional(),
  }),
);

const FrameResultSchema = z.object({
  tree: z.array(DetailNodeSchema).optional(),
  bytes: z.string().optional(),
});

const FollowerSchema = z.object({ name: z.string(), tap: z.string() });
const InfoResultSchema = z.object({ follow: z.array(FollowerSchema).optional() });

const FollowPayloadSchema = z.object({
  n: z.number().int(),
  d: z.string(),
  s: z.number().int().optional(),
});

const FollowResultSchema = z.object({
  shost: z.string().optional(),
  sport: z.string().optional(),
  sbytes: z.number().optional(),
  chost: z.string().optional(),
  cport: z.string().optional(),
  cbytes: z.number().optional(),
  payloads: z.array(FollowPayloadSchema).optional(),
});

const CheckResultSchema = z.object({ status: z.string().optional() });

const FALLBACK_COLUMNS = [
  'No.',
  'Time',
  'Delta',
  'Source',
  'Destination',
  'Protocol',
  'Length',
  'Info',
];

const FALLBACK_FOLLOWERS: FollowerChoice[] = [
  { name: 'Follow/TCP', tap: 'follow:TCP' },
  { name: 'Follow/UDP', tap: 'follow:UDP' },
  { name: 'Follow/TLS', tap: 'follow:TLS' },
  { name: 'Follow/HTTP', tap: 'follow:HTTP' },
];

function socketUrl(wsUrl: string): string {
  if (wsUrl.startsWith('/')) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${wsUrl}`;
  }
  return wsUrl;
}

function errorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return messageOf(error);
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function frameRows(result: unknown): WireFrameRow[] {
  const parsed = FramesResultSchema.safeParse(result);
  if (!parsed.success) return [];
  return Array.isArray(parsed.data) ? parsed.data : parsed.data.frames;
}

function parseStatus(result: unknown): SharkdStatus {
  const parsed = SharkdStatusSchema.safeParse(result);
  if (!parsed.success) return {};
  if (Array.isArray(parsed.data)) return { columns: parsed.data };
  return parsed.data;
}

function columnsOf(result: unknown): string[] {
  return parseStatus(result).columns ?? [];
}

function followerChoices(result: unknown): FollowerChoice[] {
  const parsed = InfoResultSchema.safeParse(result);
  if (!parsed.success) return [];
  return (parsed.data.follow ?? []).map((entry) => ({
    name: entry.name.replace(/^Follow\//, ''),
    tap: entry.tap.replace(/^follow:/, ''),
  }));
}

function checkStatus(result: unknown): string | undefined {
  const parsed = CheckResultSchema.safeParse(result);
  return parsed.success ? parsed.data.status : undefined;
}

function parseFrameResult(result: unknown): { tree: DetailNode[]; bytes: string | null } {
  const parsed = FrameResultSchema.safeParse(result);
  if (!parsed.success) return { tree: [], bytes: null };
  return { tree: parsed.data.tree ?? [], bytes: parsed.data.bytes ?? null };
}

function parseFollowResult(result: unknown): FollowResult | null {
  const parsed = FollowResultSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

function columnTemplate(columns: string[]): string {
  return columns
    .map((column) => {
      switch (column.toLowerCase()) {
        case 'no.':
          return '56px';
        case 'time':
          return '104px';
        case 'delta':
          return '82px';
        case 'source':
        case 'destination':
          return 'minmax(112px, 0.8fr)';
        case 'protocol':
          return '84px';
        case 'length':
          return '62px';
        case 'info':
          return 'minmax(240px, 2.2fr)';
        default:
          return 'minmax(84px, 1fr)';
      }
    })
    .join(' ');
}

/** Frames viewport: a virtualized table that keeps column geometry stable. */
function FrameTable({
  rows,
  columns,
  selected,
  onSelect,
}: {
  rows: WireFrameRow[];
  columns: string[];
  selected: number | null;
  onSelect: (frame: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 22,
    overscan: 14,
  });
  const template = columnTemplate(columns);

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      style={{ background: 'var(--color-panel)' }}
    >
      <div className="flex shrink-0 border-b" style={{ borderColor: 'var(--color-rule)' }}>
        <div className="grid min-w-[760px] flex-1" style={{ gridTemplateColumns: template }}>
          {columns.map((column) => (
            <span key={column} className="nb-rule-label truncate px-2 py-1">
              {column}
            </span>
          ))}
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div
            className="flex h-full min-h-24 items-center justify-center px-4 text-center text-[11px]"
            style={{ color: 'var(--color-ink-faint)' }}
          >
            No frames match the current filter. Start a capture and generate traffic, then refresh.
          </div>
        ) : (
          <div className="relative min-w-[760px]" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              const isSelected = selected === row.num;
              return (
                <button
                  key={`${row.num}-${item.index}`}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`Frame ${row.num}`}
                  className="absolute top-0 left-0 grid w-full border-b text-left text-[11px] hover:bg-white/[0.03]"
                  style={{
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                    gridTemplateColumns: template,
                    borderColor: 'color-mix(in oklab, var(--color-rule) 55%, transparent)',
                    background: isSelected ? 'var(--color-panel-raised)' : 'transparent',
                    boxShadow: isSelected ? 'inset 2px 0 0 var(--color-copper)' : undefined,
                  }}
                  onClick={() => onSelect(row.num)}
                >
                  {columns.map((column, index) => (
                    <span
                      key={`${column}:${row.num}`}
                      className={`truncate px-2 leading-[21px] ${index === 0 ? 'tabular' : ''}`}
                      style={{
                        color:
                          column.toLowerCase() === 'info'
                            ? 'var(--color-ink-dim)'
                            : 'var(--color-ink)',
                      }}
                    >
                      {row.c?.[index] ?? ''}
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailTree({
  nodes,
  depth,
  path,
  expanded,
  onToggle,
  onFilter,
  onBytes,
}: {
  nodes: DetailNode[];
  depth: number;
  path: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onFilter: (filter: string) => void;
  onBytes: (range: [number, number]) => void;
}) {
  return (
    <ul className="flex flex-col">
      {nodes.map((node, index) => {
        const nodePath = `${path}.${index}`;
        const children = Array.isArray(node.n) ? node.n : [];
        const open = expanded.has(nodePath);
        const label = node.l ?? (node.f ? String(node.f) : '');
        const byteRange = node.h;
        if (!label && children.length === 0) return null;
        return (
          <li key={nodePath}>
            <div
              className="group flex items-start gap-1 py-px pr-1 text-[11px] leading-[1.45] hover:bg-white/[0.03]"
              style={{ paddingLeft: depth * 12 + 2 }}
            >
              {children.length > 0 ? (
                <button
                  type="button"
                  aria-label={open ? 'Collapse node' : 'Expand node'}
                  className="mt-[1px] shrink-0"
                  style={{ color: 'var(--color-ink-faint)' }}
                  onClick={() => onToggle(nodePath)}
                >
                  {open ? (
                    <ChevronDown size={11} aria-hidden />
                  ) : (
                    <ChevronRight size={11} aria-hidden />
                  )}
                </button>
              ) : (
                <span className="w-[11px] shrink-0" aria-hidden />
              )}
              {byteRange ? (
                <button
                  type="button"
                  className="min-w-0 text-left hover:underline"
                  title={label}
                  onClick={() => onBytes(byteRange)}
                >
                  {label}
                </button>
              ) : (
                <span className="min-w-0" title={label}>
                  {label}
                </span>
              )}
              {node.f ? (
                <button
                  type="button"
                  className="ml-auto shrink-0 opacity-0 group-hover:opacity-100"
                  title={`Filter: ${node.f}`}
                  aria-label={`Apply filter ${node.f}`}
                  style={{ color: 'var(--color-copper)' }}
                  onClick={() => onFilter(String(node.f))}
                >
                  <Filter size={10} aria-hidden />
                </button>
              ) : null}
            </div>
            {children.length > 0 && open ? (
              <DetailTree
                nodes={children}
                depth={depth + 1}
                path={nodePath}
                expanded={expanded}
                onToggle={onToggle}
                onFilter={onFilter}
                onBytes={onBytes}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function HexPane({ bytes, range }: { bytes: Uint8Array | null; range: [number, number] | null }) {
  const lines = useMemo(() => {
    if (!bytes) return [];
    const output: { offset: number; hex: string; ascii: string }[] = [];
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const slice = bytes.subarray(offset, offset + 16);
      const hex = [...slice]
        .map((byte, index) => {
          const absolute = offset + index;
          const active = range !== null && absolute >= range[0] && absolute < range[0] + range[1];
          return { text: byte.toString(16).padStart(2, '0'), active };
        })
        .reduce<string[]>((groups, byte, index) => {
          const text = byte.active ? `\u001b[4m${byte.text}\u001b[0m` : byte.text;
          if (index % 8 === 0 && index > 0) groups.push('');
          groups.push(text);
          return groups;
        }, [])
        .join(' ');
      const ascii = [...slice]
        .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'))
        .join('');
      output.push({ offset, hex, ascii });
    }
    return output;
  }, [bytes, range]);

  if (!bytes) {
    return (
      <p className="p-2 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
        Select a frame to read its bytes.
      </p>
    );
  }

  return (
    <div className="tabular overflow-auto p-2 text-[10px] leading-[1.55]">
      {lines.map((line) => (
        <div key={line.offset} className="flex gap-3 whitespace-pre">
          <span style={{ color: 'var(--color-ink-faint)' }}>
            {line.offset.toString(16).padStart(4, '0')}
          </span>
          <span style={{ color: 'var(--color-ink-dim)' }}>{line.hex}</span>
          <span style={{ color: 'var(--color-ink)' }}>{line.ascii}</span>
        </div>
      ))}
    </div>
  );
}

function FollowDialog({
  open,
  onOpenChange,
  followers,
  defaultFilter,
  onRun,
  result,
  error,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followers: FollowerChoice[];
  defaultFilter: string;
  onRun: (follow: string, filter: string) => void;
  result: FollowResult | null;
  error: string | null;
  pending: boolean;
}) {
  const [protocol, setProtocol] = useState('TCP');
  const [filter, setFilter] = useState(defaultFilter);

  useEffect(() => {
    if (open) setFilter(defaultFilter);
  }, [open, defaultFilter]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Follow stream"
      description="Payloads are decoded from the capture and grouped by direction."
      width={720}
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[180px_1fr] gap-2">
          <Field label="Protocol" htmlFor="follow-protocol">
            <Select
              id="follow-protocol"
              value={protocol}
              onChange={(event) => setProtocol(event.target.value)}
            >
              {followers.map((follower) => (
                <option key={follower.tap} value={follower.tap}>
                  {follower.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Stream filter" htmlFor="follow-filter" hint="Wireshark display filter.">
            <Input
              id="follow-filter"
              className="tabular text-[11px]"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="tcp.stream eq 0"
            />
          </Field>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {result ? (
          <div className="flex flex-col gap-2">
            <div
              className="tabular flex flex-wrap gap-3 rounded-[2px] border px-2 py-1 text-[10px]"
              style={{ borderColor: 'var(--color-rule)', color: 'var(--color-ink-dim)' }}
            >
              <span>
                {result.shost ?? '—'}:{result.sport ?? '—'} → {result.chost ?? '—'}:
                {result.cport ?? '—'}
              </span>
              <span style={{ color: 'var(--color-signal-info)' }}>{result.sbytes ?? 0} bytes</span>
              <span style={{ color: 'var(--color-signal-warn)' }}>{result.cbytes ?? 0} bytes</span>
            </div>
            <pre
              className="tabular max-h-72 overflow-auto rounded-[2px] border p-2 text-[10px] leading-[1.5] whitespace-pre-wrap"
              style={{
                borderColor: 'var(--color-rule)',
                background: 'var(--color-panel-sunken)',
                color: 'var(--color-ink)',
              }}
            >
              {(result.payloads ?? []).length === 0
                ? 'No stream payloads were found for this follower and filter.'
                : (result.payloads ?? [])
                    .map((payload) => {
                      const text = new TextDecoder('utf-8', { fatal: false }).decode(
                        decodeBase64(payload.d),
                      );
                      return `# frame ${payload.n}${payload.s ? ' ← server' : ' → client'}\n${text}`;
                    })
                    .join('\n')}
            </pre>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
            Close
          </Button>
          <Button
            type="button"
            disabled={pending || filter.trim() === ''}
            onClick={() => onRun(protocol, filter.trim())}
            variant="default"
            size="sm"
          >
            {pending ? 'Following…' : 'Follow'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

/**
 * Web Wireshark: one sharkd session per tab over the controller WebSocket,
 * with a live filter bar, virtualized frames, detail tree, and byte pane.
 */
export function WiresharkTab({ linkId, label }: { linkId: string; label: string }) {
  const [session, setSession] = useState<SessionState>('connecting');
  const [view, setView] = useState<'packets' | 'analyze'>('packets');
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>(FALLBACK_COLUMNS);
  const [frames, setFrames] = useState<WireFrameRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [tree, setTree] = useState<DetailNode[]>([]);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [byteRange, setByteRange] = useState<[number, number] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [followers, setFollowers] = useState<FollowerChoice[]>(FALLBACK_FOLLOWERS);
  const [followOpen, setFollowOpen] = useState(false);
  const [followResult, setFollowResult] = useState<FollowResult | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);
  const [followPending, setFollowPending] = useState(false);
  const [framePending, setFramePending] = useState(false);
  const [pcapUrl, setPcapUrl] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef(new Map<number, PendingRequest>());
  const nextIdRef = useRef(1);
  const filterRef = useRef('');
  const sequenceRef = useRef(0);

  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const request = useCallback((op: string, params: Record<string, unknown> = {}) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('the Wireshark session is not connected'));
    }
    const requestId = nextIdRef.current;
    nextIdRef.current += 1;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    pendingRef.current.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ op, requestId, params }));
    return promise;
  }, []);

  const loadFrames = useCallback(
    async (displayFilter: string) => {
      const sequence = sequenceRef.current + 1;
      sequenceRef.current = sequence;
      const status = parseStatus(await request('status', {}));
      if (sequence !== sequenceRef.current) return;
      const nextColumns = status.columns ?? [];
      if (nextColumns.length > 0) setColumns(nextColumns);
      setTotal(typeof status.frames === 'number' ? status.frames : null);

      const result = await request('frames', {
        limit: 1000,
        ...(displayFilter === '' ? {} : { filter: displayFilter }),
      });
      if (sequence !== sequenceRef.current) return;
      const rows = frameRows(result);
      setFrames(rows);
      setLoaded(true);
    },
    [request],
  );

  const refresh = useCallback(async () => {
    const displayFilter = filterRef.current.trim();
    setSessionError(null);
    try {
      if (displayFilter !== '') {
        setChecking(true);
        const check = checkStatus(await request('check', { filter: displayFilter }));
        if (check !== 'OK') throw new Error('The display filter is not valid.');
        setFilterError(null);
      }
      await loadFrames(displayFilter);
    } catch (error) {
      if (displayFilter !== '') setFilterError(errorMessage(error));
      else setSessionError(errorMessage(error));
    } finally {
      setChecking(false);
    }
  }, [loadFrames, request]);

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retryTimer: number | undefined;

    const rejectPending = (reason: string) => {
      for (const pending of pendingRef.current.values()) pending.reject(new Error(reason));
      pendingRef.current.clear();
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      const delay = Math.min(1000 * 2 ** attempt, 10_000);
      attempt += 1;
      setSession('reconnecting');
      retryTimer = window.setTimeout(() => void connect(), delay);
    };

    const handleMessage = (event: MessageEvent<string>) => {
      if (disposed || typeof event.data !== 'string') return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = WsEnvelopeSchema.safeParse(raw);
      if (!parsed.success) return;
      const envelope = parsed.data;
      if (envelope.op === 'result') {
        const pending = pendingRef.current.get(envelope.requestId ?? 0);
        if (pending) {
          pendingRef.current.delete(envelope.requestId ?? 0);
          pending.resolve(envelope.result);
        }
        return;
      }
      if (envelope.op === 'error') {
        const message = envelope.error?.message ?? 'sharkd reported an error';
        const pending = pendingRef.current.get(envelope.requestId ?? 0);
        if (pending) {
          pendingRef.current.delete(envelope.requestId ?? 0);
          pending.reject(new Error(message));
        } else if ((envelope.requestId ?? 0) === 0) {
          setSessionError(message);
        }
        return;
      }
      if (envelope.op === 'loaded') {
        setLoaded(true);
        const nextColumns = columnsOf(envelope.result);
        if (nextColumns.length > 0) setColumns(nextColumns);
        void refresh();
        void request('info', {})
          .then((info) => {
            const nextFollowers = followerChoices(info);
            if (nextFollowers.length > 0) setFollowers(nextFollowers);
          })
          .catch(() => undefined);
        return;
      }
      if (envelope.op === 'status') {
        const status = parseStatus(envelope.result);
        const nextColumns = status.columns ?? [];
        if (nextColumns.length > 0) setColumns(nextColumns);
        if (typeof status.frames === 'number') setTotal(status.frames);
        return;
      }
      if (envelope.op === 'reload') {
        setReloadNonce((value) => value + 1);
      }
    };

    const connect = async () => {
      if (disposed) return;
      setSession('connecting');
      setSessionError(null);
      setLoaded(false);
      setFrames([]);
      setSelectedFrame(null);
      setTree([]);
      setBytes(null);
      let ticket: CaptureTicket;
      try {
        ticket = await client.links.capture.ticket({ linkId });
      } catch (error) {
        if (disposed) return;
        setSession('closed');
        setSessionError(messageOf(error));
        scheduleReconnect();
        return;
      }
      if (disposed) return;
      setPcapUrl(ticket.pcapUrl);
      const socket = new WebSocket(socketUrl(ticket.wsUrl));
      socketRef.current = socket;
      socket.onopen = () => {
        if (disposed) return;
        attempt = 0;
        setSession('live');
      };
      socket.onmessage = handleMessage;
      socket.onerror = () => {
        if (socket.readyState !== WebSocket.CLOSED) socket.close();
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (disposed) return;
        setLoaded(false);
        rejectPending('the Wireshark session closed');
        scheduleReconnect();
      };
    };

    void connect();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      rejectPending('the Wireshark tab closed');
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    };
  }, [linkId, refresh, request]);

  // only reacts to frame arrival.
  useEffect(() => {
    if (!loaded || frames.length === 0) return;
    if (selectedFrame !== null) return;
    const first = frames[0];
    if (first) void selectFrame(first.num);
  }, [loaded, frames, selectedFrame]);

  useEffect(() => {
    if (!loaded) return;
    if (reloadNonce === 0) return;
    void refresh();
  }, [loaded, reloadNonce, refresh]);

  useEffect(() => {
    if (!loaded) return;
    const value = filter.trim();
    if (value === '') {
      setFilterError(null);
      void loadFrames('').catch((error) => setSessionError(errorMessage(error)));
      return;
    }
    const timer = window.setTimeout(() => {
      setChecking(true);
      request('check', { filter: value })
        .then((result) => {
          if (checkStatus(result) !== 'OK') throw new Error('The display filter is not valid.');
          setFilterError(null);
          return loadFrames(value);
        })
        .catch((error) => setFilterError(errorMessage(error)))
        .finally(() => setChecking(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [filter, loaded, loadFrames, request]);

  async function selectFrame(frame: number) {
    setSelectedFrame(frame);
    setFramePending(true);
    setByteRange(null);
    try {
      const result = parseFrameResult(await request('frame', { frame, proto: true, bytes: true }));
      setTree(result.tree);
      setExpanded(new Set(result.tree.map((_node, index) => `0.${index}`).concat('0')));
      setBytes(result.bytes ? decodeBase64(result.bytes) : null);
    } catch (error) {
      setSessionError(errorMessage(error));
      setTree([]);
      setBytes(null);
    } finally {
      setFramePending(false);
    }
  }

  async function runFollow(follow: string, streamFilter: string) {
    setFollowPending(true);
    setFollowError(null);
    setFollowResult(null);
    try {
      const result = parseFollowResult(await request('follow', { follow, filter: streamFilter }));
      if (!result) throw new Error('the follow result had an unexpected shape');
      setFollowResult(result);
    } catch (error) {
      setFollowError(errorMessage(error));
    } finally {
      setFollowPending(false);
    }
  }

  function applyDetailFilter(nextFilter: string) {
    setFilter(nextFilter);
  }

  const activeColumns = columns.length > 0 ? columns : FALLBACK_COLUMNS;
  const filterLabel = filter.trim() === '' ? 'no filter' : filter.trim();

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={`Wireshark capture for ${label}`}>
      <div
        className="flex h-[28px] shrink-0 items-center gap-2 border-b px-2"
        style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
      >
        <span className="nb-rule-label flex items-center gap-1">
          <GitBranch size={11} aria-hidden /> {label}
        </span>
        <Badge tone={session === 'live' ? 'up' : session === 'reconnecting' ? 'warn' : 'down'}>
          {session}
        </Badge>
        <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
          {frames.length} shown{total === null ? '' : ` / ${total} frames`} · {filterLabel}
        </span>
        <span
          className="ml-1 flex items-center rounded-[3px] border"
          style={{ borderColor: 'var(--color-rule)' }}
          role="tablist"
          aria-label="Capture view"
        >
          {(
            [
              ['packets', 'Packets'],
              ['analyze', 'Analyze'],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              className="px-2 py-0.5 text-[10px]"
              style={{
                color: view === value ? 'var(--color-ink)' : 'var(--color-ink-dim)',
                background: view === value ? 'var(--color-panel-raised)' : 'transparent',
                borderBottom:
                  view === value ? '1px solid var(--color-copper)' : '1px solid transparent',
              }}
              onClick={() => setView(value)}
            >
              {text}
            </button>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            title="Reload frames"
            aria-label="Reload frames"
            disabled={session !== 'live'}
            onClick={() => void refresh()}
            variant="ghost"
            size="xs"
          >
            <RefreshCw size={12} aria-hidden />
          </Button>
          <Button
            type="button"
            title="Follow stream"
            aria-label="Follow stream"
            disabled={session !== 'live'}
            onClick={() => {
              setFollowResult(null);
              setFollowError(null);
              setFollowOpen(true);
            }}
            variant="ghost"
            size="xs"
          >
            <Search size={12} aria-hidden /> Follow
          </Button>
          <a
            href={pcapUrl ?? `/api/links/${linkId}/capture.pcap`}
            download
            title="Download capture"
            aria-label="Download capture"
            className={buttonVariants({ variant: 'ghost', size: 'xs' })}
          >
            <Download size={12} aria-hidden />
          </a>
        </span>
      </div>

      <div
        className="flex h-[34px] shrink-0 items-center gap-2 border-b px-2"
        style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
      >
        <label className="nb-rule-label flex items-center gap-1" htmlFor={`wire-filter-${linkId}`}>
          <Filter size={11} aria-hidden /> Display filter
        </label>
        <input
          id={`wire-filter-${linkId}`}
          className="tabular h-6 flex-1 py-0 text-[11px]"
          placeholder="icmp or tcp.port == 80"
          spellCheck={false}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {checking ? (
          <LoaderCircle
            size={12}
            className="animate-spin"
            aria-hidden
            style={{ color: 'var(--color-ink-faint)' }}
          />
        ) : null}
        {filter !== '' ? (
          <Button
            type="button"
            aria-label="Clear display filter"
            title="Clear display filter"
            onClick={() => setFilter('')}
            variant="ghost"
            size="xs"
          >
            <X size={11} aria-hidden />
          </Button>
        ) : null}
        {filterError ? (
          <span
            role="alert"
            className="max-w-[40%] truncate text-[10px]"
            title={filterError}
            style={{ color: 'var(--color-signal-down)' }}
          >
            {filterError}
          </span>
        ) : null}
      </div>

      {sessionError ? (
        <div className="shrink-0 px-2 pt-1">
          <Notice tone="error">{sessionError}</Notice>
        </div>
      ) : null}

      {framePending ? (
        <div
          className="shrink-0 px-2 py-0.5 text-[10px]"
          style={{ color: 'var(--color-ink-faint)' }}
          role="status"
        >
          reading frame…
        </div>
      ) : null}

      {view === 'analyze' ? (
        <PacketAnalysisPanel linkId={linkId} filter={filter} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <FrameTable
            rows={frames}
            columns={activeColumns}
            selected={selectedFrame}
            onSelect={(frame) => void selectFrame(frame)}
          />
          <section
            className="flex w-[430px] shrink-0 flex-col border-l"
            style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
            aria-label="Frame detail"
          >
            <div
              className="flex h-[24px] shrink-0 items-center justify-between border-b px-2"
              style={{ borderColor: 'var(--color-rule)' }}
            >
              <span className="nb-rule-label">
                {selectedFrame === null ? 'Frame detail' : `Frame ${selectedFrame}`}
              </span>
              {byteRange ? (
                <button
                  type="button"
                  className="text-[10px] underline"
                  style={{ color: 'var(--color-ink-faint)' }}
                  onClick={() => setByteRange(null)}
                >
                  clear bytes
                </button>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {tree.length === 0 ? (
                <p className="p-2 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                  Select a frame to inspect its protocol tree.
                </p>
              ) : (
                <DetailTree
                  nodes={tree}
                  depth={0}
                  path="0"
                  expanded={expanded}
                  onToggle={(nodePath) =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(nodePath)) next.delete(nodePath);
                      else next.add(nodePath);
                      return next;
                    })
                  }
                  onFilter={applyDetailFilter}
                  onBytes={setByteRange}
                />
              )}
            </div>
            <div
              className="flex h-[112px] shrink-0 flex-col border-t"
              style={{ borderColor: 'var(--color-rule)' }}
            >
              <div
                className="flex h-[22px] shrink-0 items-center border-b px-2"
                style={{ borderColor: 'var(--color-rule)' }}
              >
                <span className="nb-rule-label">Bytes</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <HexPane bytes={bytes} range={byteRange} />
              </div>
            </div>
          </section>
        </div>
      )}

      <FollowDialog
        open={followOpen}
        onOpenChange={setFollowOpen}
        followers={followers}
        defaultFilter={filter}
        onRun={(follow, streamFilter) => void runFollow(follow, streamFilter)}
        result={followResult}
        error={followError}
        pending={followPending}
      />
    </section>
  );
}

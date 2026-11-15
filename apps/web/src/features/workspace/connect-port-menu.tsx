import type { LinkRow, NodeRow } from '@netlabor/contract';
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type PortRow = NodeRow['ports'][number];

function keyOf(port: Pick<PortRow, 'adapter' | 'port'>): string {
  return `${port.adapter}:${port.port}`;
}

function labelOf(port: PortRow): string {
  return `${port.name} · ${port.adapter}/${port.port}`;
}

function usedPorts(links: LinkRow[]): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const add = (nodeId: string, adapter: number, port: number) => {
    const set = used.get(nodeId) ?? new Set<string>();
    set.add(keyOf({ adapter, port }));
    used.set(nodeId, set);
  };
  for (const link of links) {
    add(link.nodeAId, link.adapterA, link.portA);
    add(link.nodeBId, link.adapterB, link.portB);
  }
  return used;
}

/** Compact port search anchored where the node was clicked. */
export function ConnectPortMenu({
  node,
  links,
  role,
  point,
  onChoose,
  onClose,
}: {
  node: NodeRow;
  links: LinkRow[];
  role: 'source' | 'target';
  point: { x: number; y: number };
  onChoose: (port: PortRow) => void;
  onClose: () => void;
}) {
  const used = useMemo(() => usedPorts(links).get(node.id), [links, node.id]);
  const ports = useMemo(
    () => node.ports.filter((port) => !used?.has(keyOf(port))),
    [node.ports, used],
  );
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ports;
    return ports.filter(
      (port) =>
        labelOf(port).toLowerCase().includes(q) ||
        port.name.toLowerCase().includes(q) ||
        keyOf(port) === q ||
        `${port.adapter}/${port.port}` === q,
    );
  }, [ports, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setActive(0);
  }, []);

  const width = 300;
  const height = 300;
  const left = Math.max(8, Math.min(point.x + 8, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(point.y + 8, window.innerHeight - height - 8));

  function choose(port: PortRow | undefined) {
    if (!port) return;
    onChoose(port);
  }

  return (
    <div
      className="fixed z-[70] flex flex-col overflow-hidden rounded-[3px] border shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
      style={{
        left,
        top,
        width,
        maxHeight: height,
        background: 'var(--color-panel)',
        borderColor: 'var(--color-rule-strong)',
      }}
      role="dialog"
      aria-label={`${role === 'source' ? 'Source' : 'Target'} port for ${node.name}`}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActive((value) => Math.min(value + 1, Math.max(0, filtered.length - 1)));
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActive((value) => Math.max(value - 1, 0));
        } else if (event.key === 'Enter') {
          event.preventDefault();
          choose(filtered[active] ?? filtered[0]);
        }
      }}
    >
      <div
        className="flex items-center justify-between border-b px-2.5 py-1.5"
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <div className="min-w-0">
          <span className="block text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
            {role === 'source' ? 'Source port' : 'Target port'}
          </span>
          <span className="block truncate text-[12px] font-semibold">{node.name}</span>
        </div>
        <button
          type="button"
          aria-label="Close port menu"
          className="flex size-6 items-center justify-center rounded-[2px] hover:bg-white/[0.08]"
          style={{ color: 'var(--color-ink-dim)' }}
          onClick={onClose}
        >
          <X size={12} aria-hidden />
        </button>
      </div>
      <div className="relative border-b px-2 py-1.5" style={{ borderColor: 'var(--color-rule)' }}>
        <Search
          size={12}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2"
          style={{ color: 'var(--color-ink-faint)' }}
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a port…"
          className="nb-field py-1 text-[12px]"
          style={{ paddingLeft: 30 }}
          aria-label="Search ports"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1" role="listbox" aria-label="Ports">
        {filtered.length === 0 ? (
          <p className="px-2 py-2 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
            {ports.length === 0 ? 'No free ports on this node.' : 'No matching ports.'}
          </p>
        ) : (
          filtered.map((port, index) => (
            <button
              key={keyOf(port)}
              type="button"
              role="option"
              aria-selected={index === active}
              className="flex w-full items-center justify-between gap-2 rounded-[2px] px-2 py-1 text-left text-[12px]"
              style={{
                background:
                  index === active
                    ? 'color-mix(in oklab, var(--color-copper) 16%, transparent)'
                    : undefined,
                color: 'var(--color-ink)',
              }}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(port)}
            >
              <span className="truncate">{port.name}</span>
              <span
                className="shrink-0 font-mono text-[10px]"
                style={{ color: 'var(--color-ink-faint)' }}
              >
                {port.adapter}/{port.port}
              </span>
            </button>
          ))
        )}
      </div>
      <div
        className="flex items-center justify-between border-t px-2.5 py-1 text-[10px]"
        style={{ borderColor: 'var(--color-rule)', color: 'var(--color-ink-faint)' }}
      >
        <span>↑↓ navigate · Enter choose · Esc close</span>
        <span>{ports.length} free</span>
      </div>
    </div>
  );
}

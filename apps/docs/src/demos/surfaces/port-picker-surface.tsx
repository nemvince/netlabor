import type { NodeRow } from '@netlabor/contract';
import { ConnectPortMenu } from '@web/features/workspace/connect-port-menu.tsx';
import { useEffect, useRef, useState } from 'react';
import { links as fixtureLinks, nodeByName } from '../fixtures/workspace.ts';
import { Button } from '@netlabor/ui/components/button';

export interface PortPickerSurfaceProps {
  /** Fixture node whose port list opens in the menu. */
  nodeName?: string;
  /** Fixture link ids whose endpoints are already claimed. */
  linkedIds?: string[];
  role?: 'source' | 'target';
}

/**
 * The real anchored port picker, opened from a button that stands in for the
 * canvas node. Claimed ports are excluded by the component itself; choosing a
 * port closes the menu and reports it.
 */
export default function PortPickerSurface({
  nodeName = 'sw1',
  linkedIds = [fixtureLinks[0]?.id ?? ''],
  role = 'source',
}: PortPickerSurfaceProps) {
  const node: NodeRow | undefined = nodeByName.get(nodeName);
  const links = fixtureLinks.filter((link) => linkedIds.includes(link.id));
  const claimed = node
    ? node.ports.filter((port) =>
        links.some(
          (link) =>
            (link.nodeAId === node.id &&
              link.adapterA === port.adapter &&
              link.portA === port.port) ||
            (link.nodeBId === node.id &&
              link.adapterB === port.adapter &&
              link.portB === port.port),
        ),
      )
    : [];
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState({ x: 24, y: 120 });
  const [selected, setSelected] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (wasOpen.current && !open) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!node) return null;

  function openMenu() {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPoint({ x: rect.right - 140, y: rect.bottom - 6 });
    setOpen(true);
  }

  return (
    <div className="docs-ui-port-demo">
      <div className="docs-ui-node-anchor">
        <span className="docs-ui-node-anchor__name">{node.name}</span>
        <span className="docs-ui-node-anchor__meta">
          {node.nodeType} · {node.ports.length} ports ·{' '}
          {claimed.length === 0
            ? 'no linked ports'
            : `${claimed.map((port) => port.name).join(', ')} linked`}
        </span>
      </div>
      <Button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openMenu}
        variant="default"
        size="sm"
      >
        Choose a port
      </Button>
      <p className="docs-ui-status" role="status" aria-live="polite">
        {selected ? (
          <>
            selected <span className="docs-ui-status__value">{selected}</span>
          </>
        ) : (
          'no port chosen'
        )}
      </p>
      {open ? (
        <ConnectPortMenu
          node={node}
          links={links}
          role={role}
          point={point}
          onChoose={(port) => {
            setSelected(port.name);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

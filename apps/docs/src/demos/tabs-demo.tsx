import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { Button } from '@netlabor/ui/components/button';

const TABS = [
  {
    id: 'console',
    label: 'Console',
    body: 'Serial or VNC console, proxied over a single-use WebSocket ticket.',
  },
  {
    id: 'files',
    label: 'Files',
    body: 'Node files are addressable only while the node is stopped.',
  },
  {
    id: 'stats',
    label: 'Stats',
    body: 'Polled counters stay comparable because the caller fixes the value domain.',
  },
];

export default function TabsDemo() {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : TABS.length - 1;
    const next = (active + offset) % TABS.length;
    setActive(next);
    buttons.current[next]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label="Node dock" className="docs-stack" onKeyDown={onKeyDown}>
        {TABS.map((tab, index) => (
          <Button
            key={tab.id}
            ref={(element: HTMLButtonElement | null) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.id}`}
            aria-selected={active === index}
            aria-controls={`${baseId}-panel-${tab.id}`}
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
            variant="outline"
            size="xs"
          >
            {tab.label}
          </Button>
        ))}
      </div>
      {TABS.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={active !== index}
          className="mt-2 rounded-[3px] border border-[var(--color-rule)] bg-[var(--color-panel-sunken)] px-3 py-2 text-[12px] text-[var(--color-ink-dim)]"
        >
          {tab.body}
        </div>
      ))}
    </div>
  );
}

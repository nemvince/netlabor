import { Palette } from '@web/features/workspace/Palette.tsx';
import { useEffect, useRef, useState } from 'react';
import { symbols, templates } from '../fixtures/workspace.ts';

function templateAt(target: EventTarget | null) {
  if (!(target instanceof Element)) return undefined;
  const button = target.closest('button');
  // The favourite star carries an aria-label; rows are the only titled buttons.
  if (!button || button.getAttribute('aria-label')) return undefined;
  const title = button.getAttribute('title') ?? '';
  return templates.find(
    (template) =>
      title === `Drag or double-click to add ${template.name}` ||
      title.startsWith(`${template.name} ·`),
  );
}

export interface PaletteSurfaceProps {
  /** Panel height in px; the palette scrolls inside it. */
  height?: number;
  /** Show the "would place" status line next to the rail. */
  showStatus?: boolean;
}

/**
 * The real catalog palette. It keeps its own search and favourites state; the
 * docs only report what a double-click would add instead of mutating a project.
 */
export default function PaletteSurface({ height = 320, showStatus = true }: PaletteSurfaceProps) {
  const [placed, setPlaced] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);

  function report(templateId: string) {
    const template = templates.find((entry) => entry.id === templateId);
    if (template) setPlaced(template.name);
  }

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    // Passive delegation: the rows are already buttons; this only mirrors the
    // row under the pointer into the status line.
    function onClick(event: Event) {
      const template = templateAt(event.target);
      if (template) setPlaced(template.name);
    }
    element.addEventListener('click', onClick);
    return () => element.removeEventListener('click', onClick);
  }, []);

  return (
    <div className="docs-ui-palette-wrap" ref={host}>
      <div className="docs-ui-panel docs-ui-palette" style={{ height }}>
        <Palette
          templates={templates}
          images={undefined}
          symbols={symbols}
          isLoading={false}
          error={null}
          disabled={false}
          onAddAtCenter={report}
        />
      </div>
      {showStatus ? (
        <p className="docs-ui-status" role="status" aria-live="polite">
          {placed ? (
            <>
              would place: <span className="docs-ui-status__value">{placed}</span>
            </>
          ) : (
            'select a palette row to add it at the canvas centre'
          )}
        </p>
      ) : null}
    </div>
  );
}

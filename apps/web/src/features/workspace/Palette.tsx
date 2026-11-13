import type { AgentCapabilities, ImageRow, TemplateRow } from '@netlabor/contract';
import { ImageOff, Plug, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Notice } from '../../components/Notice.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { SymbolGlyph } from '../../components/SymbolGlyph.tsx';
import { missingRequiredImages } from '../../lib/template-images.ts';

export const TEMPLATE_MIME = 'application/netlabor-template';

const FAVORITES_KEY = 'netlabor-palette-favorites';

function readFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Searchable device catalog grouped by category, drag or double-click to add. */
export function Palette({
  templates,
  images,
  computes,
  symbols,
  isLoading,
  error,
  disabled,
  onAddAtCenter,
}: {
  templates: TemplateRow[];
  images: ImageRow[] | undefined;
  computes?: { status: string; capabilities: AgentCapabilities | null }[];
  symbols: Map<string, string>;
  isLoading: boolean;
  error: unknown;
  disabled: boolean;
  onAddAtCenter: (templateId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>(readFavorites);

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  function toggleFavorite(templateId: string) {
    setFavorites((current) =>
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId],
    );
  }

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = (template: TemplateRow) =>
      query === '' ||
      template.name.toLowerCase().includes(query) ||
      template.category.toLowerCase().includes(query) ||
      template.nodeType.toLowerCase().includes(query);
    const byName = (left: TemplateRow, right: TemplateRow) => left.name.localeCompare(right.name);
    const pinned = templates
      .filter((template) => favorites.includes(template.id) && matches(template))
      .sort(byName);
    const rest = templates.filter(
      (template) => !favorites.includes(template.id) && matches(template),
    );
    const byCategory = new Map<string, TemplateRow[]>();
    for (const template of rest) {
      const list = byCategory.get(template.category) ?? [];
      list.push(template);
      byCategory.set(template.category, list);
    }
    const groups: { category: string; templates: TemplateRow[] }[] = [];
    if (pinned.length > 0) groups.push({ category: 'Favorites', templates: pinned });
    for (const [category, list] of [...byCategory.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      groups.push({ category, templates: [...list].sort(byName) });
    }
    return groups;
  }, [templates, search, favorites]);

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-r"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
      aria-label="Device palette"
    >
      <div className="border-b px-3 py-2" style={{ borderColor: 'var(--color-rule)' }}>
        <div className="nb-rule-label mb-1.5">Palette</div>
        <SearchInput
          label="Search templates"
          placeholder="Search devices"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {isLoading ? (
          <p className="px-1 text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
            Reading catalog…
          </p>
        ) : error ? (
          <Notice tone="error">The device catalog could not be read.</Notice>
        ) : groups.length === 0 ? (
          <p className="px-1 text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
            No template matches the search.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.category} className="mb-2">
              <div className="nb-rule-label px-1 py-1">{group.category}</div>
              <div className="flex flex-col gap-px">
                {group.templates.map((template) => {
                  const icon = symbols.get(template.symbol);
                  const missing = images ? missingRequiredImages(template, images) : [];
                  const pinned = favorites.includes(template.id);
                  // Host-side setup the template needs beyond an image.
                  const online = computes?.filter((compute) => compute.status === 'online') ?? [];
                  const hostMissing =
                    template.nodeType === 'nat'
                      ? online.length > 0 && !online.some((c) => c.capabilities?.natBridge)
                        ? 'no compute has a NAT bridge (run scripts/provision-nat-bridge.sh on the agent host)'
                        : null
                      : template.nodeType === 'cloud'
                        ? online.length > 0 &&
                          !online.some((c) => (c.capabilities?.cloudInterfaces?.length ?? 0) > 0)
                          ? 'no compute allowlists cloud interfaces (set NB_CLOUD_INTERFACES on the agent)'
                          : null
                        : null;
                  return (
                    <div key={template.id} className="flex items-start gap-0.5">
                      <button
                        type="button"
                        draggable={!disabled}
                        disabled={disabled}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(TEMPLATE_MIME, template.id);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onDoubleClick={() => onAddAtCenter(template.id)}
                        title={
                          hostMissing
                            ? `${template.name} · ${hostMissing}`
                            : missing.length > 0
                              ? `${template.name} · missing images: ${missing.join(', ')}`
                              : `Drag or double-click to add ${template.name}`
                        }
                        className="flex min-h-7 min-w-0 flex-1 items-start gap-2 rounded-[2px] px-1 py-1 text-left text-[12px] leading-[1.3] hover:bg-[var(--color-panel-raised)] disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ color: 'var(--color-ink)' }}
                      >
                        <SymbolGlyph svg={icon} className="mt-px size-4 shrink-0" />
                        <span className="line-clamp-2 min-w-0 flex-1 break-words">
                          {template.name}
                        </span>
                        {missing.length > 0 ? (
                          <span
                            className="flex items-center gap-0.5 text-[10px]"
                            style={{ color: 'var(--color-signal-warn)' }}
                          >
                            <ImageOff size={11} aria-hidden />
                            image
                          </span>
                        ) : null}
                        {hostMissing ? (
                          <span
                            className="flex items-center gap-0.5 text-[10px]"
                            style={{ color: 'var(--color-signal-warn)' }}
                            title={hostMissing}
                          >
                            <Plug size={11} aria-hidden />
                            setup
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="flex size-6 shrink-0 items-center justify-center rounded-[2px] hover:bg-white/[0.08]"
                        aria-label={
                          pinned ? `Unpin ${template.name}` : `Pin ${template.name} to favorites`
                        }
                        aria-pressed={pinned}
                        title={pinned ? 'Remove from favorites' : 'Add to favorites'}
                        onClick={() => toggleFavorite(template.id)}
                        style={{ color: pinned ? 'var(--color-copper)' : 'var(--color-ink-faint)' }}
                      >
                        <Star size={12} aria-hidden fill={pinned ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
      <div
        className="border-t px-3 py-1.5 text-[10px]"
        style={{ borderColor: 'var(--color-rule)', color: 'var(--color-ink-faint)' }}
      >
        {templates.length} templates. Drag one onto the canvas.
      </div>
    </aside>
  );
}

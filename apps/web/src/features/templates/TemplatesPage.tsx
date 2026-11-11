import { useNavigate } from '@tanstack/react-router';
import { FileCode2, LayoutTemplate } from 'lucide-react';
import { useState } from 'react';
import { Loading, Page, PageHeader } from '../../components/Page.tsx';
import { NotAllowed } from '../auth/require-auth.tsx';
import { useMe } from '../auth/use-me.ts';
import { DeviceTemplatesPanel } from './DeviceTemplatesPanel.tsx';
import { SymbolsPanel } from './SymbolsPanel.tsx';

type View = 'templates' | 'symbols';

const TABS: { id: View; label: string; icon: typeof LayoutTemplate }[] = [
  { id: 'templates', label: 'Device templates', icon: LayoutTemplate },
  { id: 'symbols', label: 'Symbols', icon: FileCode2 },
];

/**
 * Template library: device templates with their scopes (global and per project)
 * and symbol administration. The OS repository and appliance builds live on the
 * Images page, which templates link to.
 */
export function TemplatesPage() {
  const { me, can } = useMe();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('templates');

  if (!me) return <Loading label="Loading account…" />;
  if (!can('template.read')) return <NotAllowed requirement="template.read" />;

  return (
    <Page>
      <PageHeader
        title="Templates"
        description="Device templates for the palette, scoped globally or to a single project, plus the symbols they use."
      />

      <div
        className="mt-4 flex items-center gap-1 border-b"
        style={{ borderColor: 'var(--color-rule)' }}
        role="tablist"
        aria-label="Template library sections"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className="flex items-center gap-1 px-3 py-1.5 text-[12px]"
              style={{
                color: active ? 'var(--color-ink)' : 'var(--color-ink-dim)',
                borderBottom: active ? '2px solid var(--color-copper)' : '2px solid transparent',
              }}
              onClick={() => setView(tab.id)}
            >
              <Icon size={13} aria-hidden /> {tab.label}
            </button>
          );
        })}
      </div>

      {view === 'symbols' ? (
        <SymbolsPanel canWrite={can('template.write')} />
      ) : (
        <DeviceTemplatesPanel
          canWrite={can('template.write')}
          canReadImages={can('image.read')}
          onOpenAppliances={() => void navigate({ to: '/images', search: { tab: 'appliances' } })}
        />
      )}
    </Page>
  );
}

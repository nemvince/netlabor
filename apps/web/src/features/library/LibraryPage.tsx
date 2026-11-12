import { useNavigate, useSearch } from '@tanstack/react-router';
import { Cable, FileCode2, HardDrive, LayoutTemplate } from 'lucide-react';
import { Loading, Page, PageHeader } from '../../components/Page.tsx';
import { ApplianceImagesPanel } from '../appliances/ApplianceImagesPanel.tsx';
import { NotAllowed } from '../auth/require-auth.tsx';
import { useMe } from '../auth/use-me.ts';
import { LibraryImagesPanel } from '../images/LibraryImagesPanel.tsx';
import { DeviceTemplatesPanel } from '../templates/DeviceTemplatesPanel.tsx';
import { SymbolsPanel } from '../templates/SymbolsPanel.tsx';

type Tab = 'templates' | 'appliances' | 'images' | 'symbols';

const TABS: { id: Tab; label: string; icon: typeof LayoutTemplate; needs: 'template' | 'image' }[] =
  [
    { id: 'templates', label: 'Device templates', icon: LayoutTemplate, needs: 'template' },
    { id: 'appliances', label: 'Appliances', icon: Cable, needs: 'image' },
    { id: 'images', label: 'Image library', icon: HardDrive, needs: 'image' },
    { id: 'symbols', label: 'Symbols', icon: FileCode2, needs: 'template' },
  ];

/**
 * One page for everything that feeds the workspace palette: device templates,
 * appliance builds from the OS repository, the image library, and symbols.
 * The tab is deep-linkable via `?tab=`.
 */
export function LibraryPage() {
  const { me, can } = useMe();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: Tab };

  if (!me) return <Loading label="Loading account…" />;

  const allowed = TABS.filter((tab) =>
    can(tab.needs === 'template' ? 'template.read' : 'image.read'),
  );
  if (allowed.length === 0) return <NotAllowed requirement="template.read" />;

  const view = allowed.find((tab) => tab.id === search.tab)?.id ?? allowed[0]?.id ?? 'templates';

  return (
    <Page>
      <PageHeader
        title="Library"
        description="Device templates and appliance builds that feed the workspace palette, plus the images and symbols they need."
      />

      <div
        className="mt-4 flex items-center gap-1 border-b"
        style={{ borderColor: 'var(--color-rule)' }}
        role="tablist"
        aria-label="Library sections"
      >
        {allowed.map((tab) => {
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
              onClick={() =>
                void navigate({
                  to: '/library',
                  search: { tab: tab.id === 'templates' ? undefined : tab.id },
                  replace: true,
                })
              }
            >
              <Icon size={13} aria-hidden /> {tab.label}
            </button>
          );
        })}
      </div>

      {view === 'templates' ? (
        <DeviceTemplatesPanel
          canWrite={can('template.write')}
          canReadImages={can('image.read')}
          onOpenAppliances={() => void navigate({ to: '/library', search: { tab: 'appliances' } })}
        />
      ) : null}
      {view === 'appliances' ? (
        <ApplianceImagesPanel
          canWrite={can('image.write')}
          canCreateTemplates={can('template.write')}
        />
      ) : null}
      {view === 'images' ? <LibraryImagesPanel /> : null}
      {view === 'symbols' ? <SymbolsPanel canWrite={can('template.write')} /> : null}
    </Page>
  );
}

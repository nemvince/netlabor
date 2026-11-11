import { useNavigate, useSearch } from '@tanstack/react-router';
import { HardDrive, HardDriveDownload } from 'lucide-react';
import { Loading, Page, PageHeader } from '../../components/Page.tsx';
import { ApplianceImagesPanel } from '../appliances/ApplianceImagesPanel.tsx';
import { NotAllowed } from '../auth/require-auth.tsx';
import { useMe } from '../auth/use-me.ts';
import { LibraryImagesPanel } from './LibraryImagesPanel.tsx';

type View = 'library' | 'appliances';

const TABS: { id: View; label: string; icon: typeof HardDrive }[] = [
  { id: 'library', label: 'Library images', icon: HardDrive },
  { id: 'appliances', label: 'OS repository & builds', icon: HardDriveDownload },
];

/**
 * Image page: the library (sha256 rows, replicas, sync, prune) and the global
 * OS repository that feeds appliance builds. `?tab=appliances` deep-links the
 * repository from templates and build links.
 */
export function ImagesPage() {
  const { me, can } = useMe();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: 'appliances' };
  const view: View = search.tab === 'appliances' ? 'appliances' : 'library';

  if (!me) return <Loading label="Loading account…" />;
  if (!can('image.read')) return <NotAllowed requirement="image.read" />;

  function select(next: View) {
    void navigate({
      to: '/images',
      search: (previous: { tab?: 'appliances' }) => ({
        ...previous,
        tab: next === 'appliances' ? ('appliances' as const) : undefined,
      }),
      replace: true,
    });
  }

  return (
    <Page>
      <PageHeader
        title="Images"
        description="Library images by sha256 with their replicas, plus the global OS repository and the appliance images built from it."
      />

      <div
        className="mt-4 flex items-center gap-1 border-b"
        style={{ borderColor: 'var(--color-rule)' }}
        role="tablist"
        aria-label="Image sections"
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
              onClick={() => select(tab.id)}
            >
              <Icon size={13} aria-hidden /> {tab.label}
            </button>
          );
        })}
      </div>

      {view === 'appliances' ? (
        <div className="mt-4">
          <ApplianceImagesPanel
            canWrite={can('image.write')}
            canCreateTemplates={can('template.write')}
          />
        </div>
      ) : (
        <LibraryImagesPanel />
      )}
    </Page>
  );
}

import { useNavigate, useSearch } from '@tanstack/react-router';
import { Cable, FileCode2, HardDrive, LayoutTemplate, Store } from 'lucide-react';
import { Loading, Page, PageHeader } from '../../components/Page.tsx';
import { TabBar } from '../../components/TabBar.tsx';
import { ApplianceImagesPanel } from '../appliances/ApplianceImagesPanel.tsx';
import { NotAllowed } from '../auth/require-auth.tsx';
import { useMe } from '../auth/use-me.ts';
import { LibraryImagesPanel } from '../images/LibraryImagesPanel.tsx';
import { DeviceTemplatesPanel } from '../templates/DeviceTemplatesPanel.tsx';
import { SymbolsPanel } from '../templates/SymbolsPanel.tsx';
import { CatalogPanel } from './CatalogPanel.tsx';

type Tab = 'templates' | 'appliances' | 'catalog' | 'images' | 'symbols';

const TABS: { id: Tab; label: string; icon: typeof LayoutTemplate; needs: 'template' | 'image' }[] =
  [
    { id: 'templates', label: 'Device templates', icon: LayoutTemplate, needs: 'template' },
    { id: 'appliances', label: 'Appliances', icon: Cable, needs: 'image' },
    { id: 'catalog', label: 'Appliance catalog', icon: Store, needs: 'template' },
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

      <div className="mt-4">
        <TabBar
          label="Library sections"
          value={view}
          items={allowed}
          onChange={(id) =>
            void navigate({
              to: '/library',
              search: { tab: id === 'templates' ? undefined : id },
              replace: true,
            })
          }
        />
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
      {view === 'catalog' ? (
        <CatalogPanel
          canInstall={can('image.write') && can('template.write')}
          onOpenTemplates={() => void navigate({ to: '/library', search: { tab: 'templates' } })}
        />
      ) : null}
      {view === 'images' ? <LibraryImagesPanel /> : null}
      {view === 'symbols' ? <SymbolsPanel canWrite={can('template.write')} /> : null}
    </Page>
  );
}

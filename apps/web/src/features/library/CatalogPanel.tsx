/** Appliance marketplace: browse the curated catalog and install entries. */

import { useQuery } from '@tanstack/react-query';
import { Check, Download } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/Badge.tsx';
import { Loading } from '../../components/Page.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { toast } from '../../components/Toast.tsx';
import { client, orpc } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { messageOf } from '../../lib/errors.ts';
import { waitForJob } from '../../lib/jobs.ts';
import { queryClient } from '../../lib/queryClient.ts';

export function CatalogPanel({
  canInstall,
  onOpenTemplates,
}: {
  canInstall: boolean;
  onOpenTemplates: () => void;
}) {
  const [search, setSearch] = useState('');
  const [progress, setProgress] = useState<Record<string, number>>({});
  const catalog = useQuery({
    ...orpc.marketplace.list.queryOptions({ input: { search: search || undefined } }),
    retry: false,
  });

  async function install(applianceId: string, name: string) {
    setProgress((current) => ({ ...current, [applianceId]: 0 }));
    try {
      const job = await client.marketplace.install({ applianceId });
      await waitForJob(job.id, {
        onUpdate: (update) =>
          setProgress((current) => ({ ...current, [applianceId]: update.progress })),
      });
      toast.success(`${name} installed into the template library.`);
      await queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() });
      await queryClient.invalidateQueries({ queryKey: orpc.marketplace.list.key() });
      await queryClient.invalidateQueries({ queryKey: orpc.images.list.key() });
    } catch (error) {
      toast.error(messageOf(error));
    } finally {
      setProgress((current) => {
        const next = { ...current };
        delete next[applianceId];
        return next;
      });
    }
  }

  const rows = catalog.data ?? [];

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          id="catalog-search"
          label="Search known appliances"
          placeholder="Search known appliances"
          wrapperStyle={{ width: 260 }}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
          Curated from the GNS3 appliance registry. Installing downloads the image once and creates
          a device template.
        </span>
      </div>

      {catalog.isPending ? (
        <Loading label="Reading the catalog…" />
      ) : catalog.isError ? (
        <p className="text-[12px]" style={{ color: 'var(--color-signal-down)' }}>
          {messageOf(catalog.error)}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--color-ink-dim)' }}>
          No appliance matches “{search}”.
        </p>
      ) : (
        <div
          className="overflow-hidden rounded-[3px] border"
          style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
        >
          <ul>
            {rows.map((appliance) => {
              const percent = progress[appliance.id];
              const busy = percent !== undefined;
              return (
                <li
                  key={appliance.id}
                  className="relative flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2.5 last:border-b-0"
                  style={{ borderColor: 'var(--color-rule)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium">{appliance.name}</span>
                      <Badge tone={appliance.status === 'stable' ? 'up' : 'warn'}>
                        {appliance.status}
                      </Badge>
                      <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                        {appliance.category}
                      </span>
                    </div>
                    <p
                      className="mt-0.5 line-clamp-2 text-[11px] leading-[1.5]"
                      style={{ color: 'var(--color-ink-dim)' }}
                    >
                      {appliance.description}
                    </p>
                    <p
                      className="tabular mt-1 text-[10px]"
                      style={{ color: 'var(--color-ink-faint)' }}
                    >
                      {appliance.vendor} ·{' '}
                      {appliance.nodeType === 'docker' ? 'Docker' : 'QEMU'}
                      {appliance.version ? ` · ${appliance.version}` : ''}
                      {appliance.sizeBytes > 0 ? ` · ${formatBytes(appliance.sizeBytes)}` : ''}
                    </p>
                  </div>
                  {appliance.installed ? (
                    <button
                      type="button"
                      className="nb-button"
                      data-size="sm"
                      data-variant="ghost"
                      onClick={onOpenTemplates}
                    >
                      <Check size={12} aria-hidden /> Installed
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="nb-button"
                      data-size="sm"
                      data-variant="primary"
                      disabled={!canInstall || busy}
                      title={canInstall ? undefined : 'Requires image.write and template.write'}
                      onClick={() => void install(appliance.id, appliance.name)}
                    >
                      <Download size={12} aria-hidden />
                      {busy ? `${percent}%` : 'Install'}
                    </button>
                  )}
                  {busy ? (
                    <div className="absolute inset-x-0 bottom-0 h-px">
                      <div
                        className="h-full"
                        style={{
                          width: `${Math.max(2, Math.min(100, percent))}%`,
                          background: 'var(--color-copper)',
                        }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { orpc } from '../lib/api.ts';

export function OverviewPage() {
  const health = useQuery(orpc.health.ping.queryOptions({ input: {} }));

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Control plane</h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--color-ink-dim)' }}>
        One controller owns the database, the API, and every compute agent.
      </p>

      <div className="nb-panel mt-6 divide-y" style={{ borderColor: 'var(--color-rule)' }}>
        <Row label="Controller API">
          {health.isPending ? (
            <span style={{ color: 'var(--color-ink-faint)' }}>contacting…</span>
          ) : health.isError ? (
            <span style={{ color: 'var(--color-signal-down)' }}>{health.error.message}</span>
          ) : (
            <span style={{ color: 'var(--color-signal-up)' }}>reachable</span>
          )}
        </Row>
        <Row label="Version">
          <span className="tabular">{health.data?.version ?? '—'}</span>
        </Row>
        <Row label="Checked">
          <span className="tabular">
            {health.data ? new Date(health.data.time).toLocaleTimeString() : '—'}
          </span>
        </Row>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="nb-rule-label">{label}</span>
      <span className="text-[13px]">{children}</span>
    </div>
  );
}

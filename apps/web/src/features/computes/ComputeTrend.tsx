import type { ComputeRow } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Sparkline } from '../../components/Sparkline.tsx';
import { orpc } from '../../lib/api.ts';

interface TrendSample {
  cpu: number;
  load: number;
  memory: number;
}

const MAX_SAMPLES = 32;
const POLL_MS = 10_000;

/** Consecutive `computes.stats` polls condensed into three fixed-domain trends. */
export function ComputeTrend({ compute }: { compute: ComputeRow }) {
  const [samples, setSamples] = useState<TrendSample[]>([]);

  const stats = useQuery({
    ...orpc.computes.stats.queryOptions({ input: { id: compute.id } }),
    enabled: compute.status === 'online',
    retry: false,
    refetchInterval: POLL_MS,
  });

  useEffect(() => {
    if (!stats.data) return;
    const sample: TrendSample = {
      cpu:
        stats.data.cpuCount > 0
          ? Math.min(100, (stats.data.loadAverage[0] / stats.data.cpuCount) * 100)
          : 0,
      load: stats.data.loadAverage[0],
      memory:
        stats.data.memoryTotalBytes > 0
          ? Math.min(
              100,
              Math.max(0, (stats.data.memoryUsedBytes / stats.data.memoryTotalBytes) * 100),
            )
          : 0,
    };
    setSamples((current) => [...current, sample].slice(-MAX_SAMPLES));
  }, [stats.data]);

  if (compute.status !== 'online') {
    return (
      <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
        offline
      </span>
    );
  }

  if (stats.isError) {
    return (
      <span className="text-[10px]" style={{ color: 'var(--color-signal-down)' }}>
        stats unavailable
      </span>
    );
  }

  const latest = samples[samples.length - 1];
  return (
    <div className="flex w-[176px] flex-col gap-1" title={`Statistics trend for ${compute.name}`}>
      <Sparkline
        values={samples.map((sample) => sample.cpu)}
        max={100}
        color="var(--color-copper)"
        label="CPU"
        valueLabel={latest ? `${latest.cpu.toFixed(0)}%` : '—'}
      />
      <Sparkline
        values={samples.map((sample) => sample.load)}
        max={Math.max(1, ...samples.map((sample) => sample.load))}
        color="var(--color-signal-info)"
        label="Load"
        valueLabel={latest ? latest.load.toFixed(2) : '—'}
      />
      <Sparkline
        values={samples.map((sample) => sample.memory)}
        max={100}
        color="var(--color-signal-up)"
        label="Memory"
        valueLabel={latest ? `${latest.memory.toFixed(0)}%` : '—'}
      />
    </div>
  );
}

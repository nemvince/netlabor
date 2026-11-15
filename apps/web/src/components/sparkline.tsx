import { useId } from 'react';

/**
 * Small SVG trend line for polled counters. The value domain is fixed by the
 * caller so consecutive polls stay comparable instead of auto-scaling.
 */
export function Sparkline({
  values,
  max,
  color,
  label,
  valueLabel,
}: {
  values: number[];
  max: number;
  color: string;
  label: string;
  valueLabel: string;
}) {
  const gradientId = useId();
  const boundedMax = max > 0 ? max : 1;
  const series = values.length === 1 && values[0] !== undefined ? [values[0], values[0]] : values;
  const points = series.map((value, index) => {
    const x = series.length <= 1 ? 0 : (index / (series.length - 1)) * 100;
    const y = 22 - Math.min(1, Math.max(0, value / boundedMax)) * 20;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = points.length > 0 ? points.join(' ') : '0,22 100,22';

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-1">
        <span className="nb-rule-label truncate">{label}</span>
        <span className="tabular text-[10px]" style={{ color }}>
          {valueLabel}
        </span>
      </div>
      <svg
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        className="h-4 w-full"
        role="img"
        aria-label={`${label}: ${valueLabel}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1="22" x2="100" y2="22" stroke="var(--color-border)" strokeWidth="0.6" />
        {points.length > 1 ? (
          <polygon points={`0,22 ${line} 100,22`} fill={`url(#${gradientId})`} stroke="none" />
        ) : null}
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="1.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

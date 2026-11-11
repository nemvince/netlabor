import { messageOf } from '../lib/errors.ts';

/** Router error boundary: an unreachable controller or failed guard lands here. */
export function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-3 px-8">
      <div className="nb-rule-label">controller response</div>
      <h1 className="text-xl font-semibold tracking-tight">The page could not load</h1>
      <p className="text-[13px]" style={{ color: 'var(--color-ink-dim)' }}>
        {messageOf(error)}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="nb-button" data-variant="primary" onClick={reset}>
          Try again
        </button>
        <a href="/login" className="nb-button" style={{ textDecoration: 'none' }}>
          Go to sign in
        </a>
      </div>
    </div>
  );
}

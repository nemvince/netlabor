import { Page } from '../components/page.tsx';
import { messageOf } from '../lib/errors.ts';

/** Router error boundary: an unreachable controller or failed guard lands here. */
export function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <Page wide={false}>
      <div className="nb-panel mt-6 px-5 py-6">
        <div className="nb-rule-label">Controller response</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">The page could not load</h1>
        <p className="mt-2 max-w-prose text-[13px]" style={{ color: 'var(--color-ink-dim)' }}>
          {messageOf(error)}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="nb-button" data-variant="primary" onClick={reset}>
            Try again
          </button>
          <a href="/login" className="nb-button" style={{ textDecoration: 'none' }}>
            Go to sign in
          </a>
        </div>
      </div>
    </Page>
  );
}

import { Page } from '../components/page.tsx';
import { messageOf } from '../lib/errors.ts';
import { Button } from '@netlabor/ui/components/button';

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
          <Button type="button" onClick={reset} variant="default" size="sm">
            Try again
          </Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<a href="/login" />}>
            Go to sign in
          </Button>
        </div>
      </div>
    </Page>
  );
}

import { Link } from '@tanstack/react-router';
import { Page } from '../components/page.tsx';
import { buttonVariants } from '@netlabor/ui/components/button';

export function NotFoundPage() {
  return (
    <Page wide={false}>
      <div className="nb-panel mt-6 px-5 py-6">
        <div className="nb-rule-label">404</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">No such page</h1>
        <p className="mt-2 max-w-prose text-[13px]" style={{ color: 'var(--color-ink-dim)' }}>
          The route you asked for is not part of this controller.
        </p>
        <Link to="/" className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mt-5' })}>
          Back to control plane
        </Link>
      </div>
    </Page>
  );
}

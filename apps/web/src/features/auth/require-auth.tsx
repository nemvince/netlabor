import { Link, redirect } from '@tanstack/react-router';
import { ShieldSlashIcon as ShieldOff  } from '@phosphor-icons/react';
import { EmptyState } from '../../components/empty-state.tsx';
import { Page, PageHeader } from '../../components/page.tsx';
import { orpc } from '../../lib/api.ts';
import { isUnauthorized } from '../../lib/errors.ts';
import { queryClient } from '../../lib/query-client.ts';
import { buttonVariants } from '@netlabor/ui/components/button';

/**
 * Route guard for every protected route. It resolves `auth.me` through the
 * cache (so navigation is cheap) and sends anonymous visitors to /login with
 * the requested location remembered.
 */
export async function requireAuth({ location }: { location: { href: string } }): Promise<void> {
  try {
    await queryClient.fetchQuery({ ...orpc.auth.me.queryOptions({ input: {} }), retry: false });
  } catch (error) {
    if (isUnauthorized(error)) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    throw error;
  }
}

/** Rendered in place of a page whose privilege requirement is not met. */
export function NotAllowed({ requirement }: { requirement: string }) {
  return (
    <Page wide={false}>
      <PageHeader
        title="Not allowed"
        description={`This page requires the ${requirement} privilege.`}
      />
      <div className="mt-6">
        <EmptyState
          icon={ShieldOff}
          title="Your account cannot open this page"
          description={`Ask an administrator to add ${requirement} to one of your roles, or go back to a page you can read.`}
          action={
            <Link to="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Back to overview
            </Link>
          }
        />
      </div>
    </Page>
  );
}

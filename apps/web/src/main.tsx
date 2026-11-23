import { QueryClientProvider, useMutation } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
  Outlet,
  RouterProvider,
  useNavigate,
} from '@tanstack/react-router';
import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Notice } from './components/notice.tsx';
import { Loading } from './components/page.tsx';
import { requireAuth } from './features/auth/require-auth.tsx';
import { SetupWizard } from './features/setup/setup-wizard.tsx';
import { AppShell } from './lib/app-shell.tsx';
import { client, orpc } from './lib/api.ts';
import { messageOf } from './lib/errors.ts';
import { queryClient } from './lib/query-client.ts';
import { LoginPage } from './routes/login.tsx';
import { NotFoundPage } from './routes/not-found.tsx';
import { RouteError } from './routes/route-error.tsx';
import './styles.css';

/**
 * Every page after sign-in is code-split: the login and setup screens must not
 * download the workspace (React Flow, terminals, VNC) before anyone uses them.
 */
const OverviewPage = lazyRouteComponent(() => import('./routes/overview.tsx'), 'OverviewPage');
const ProjectsPage = lazyRouteComponent(() => import('./routes/projects.tsx'), 'ProjectsPage');
const GroupsPage = lazyRouteComponent(() => import('./routes/groups.tsx'), 'GroupsPage');
const ComputesPage = lazyRouteComponent(() => import('./routes/computes.tsx'), 'ComputesPage');
const LibraryPage = lazyRouteComponent(
  () => import('./features/library/library-page.tsx'),
  'LibraryPage',
);
const ToolsPage = lazyRouteComponent(() => import('./features/tools/tools-page.tsx'), 'ToolsPage');
const WorkspacePage = lazyRouteComponent(
  () => import('./features/workspace/workspace-page.tsx'),
  'WorkspacePage',
);
const ProfilePage = lazyRouteComponent(() => import('./routes/profile.tsx'), 'ProfilePage');
const UsersAdminPage = lazyRouteComponent(
  () => import('./routes/admin/users.tsx'),
  'UsersAdminPage',
);
const RolesAdminPage = lazyRouteComponent(
  () => import('./routes/admin/roles.tsx'),
  'RolesAdminPage',
);
const AuditAdminPage = lazyRouteComponent(
  () => import('./routes/admin/audit.tsx'),
  'AuditAdminPage',
);
const OidcAdminPage = lazyRouteComponent(() => import('./routes/admin/oidc.tsx'), 'OidcAdminPage');
const ApiKeysAdminPage = lazyRouteComponent(
  () => import('./routes/admin/api-keys.tsx'),
  'ApiKeysAdminPage',
);
const SettingsAdminPage = lazyRouteComponent(
  () => import('./routes/admin/settings.tsx'),
  'SettingsAdminPage',
);

function loginSearch(search: Record<string, unknown>): {
  redirect?: string;
  error?: string;
  notice?: string;
} {
  const out: { redirect?: string; error?: string; notice?: string } = {};
  if (typeof search.redirect === 'string') out.redirect = search.redirect;
  if (typeof search.error === 'string') out.error = search.error;
  if (typeof search.notice === 'string') out.notice = search.notice;
  return out;
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <AppShell>
      <NotFoundPage />
    </AppShell>
  ),
  errorComponent: RouteError,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: loginSearch,
  component: LoginPage,
});

const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/s/$token',
  component: ShareRoutePage,
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: SetupWizard,
});

/** Redeem a read-only share link, then open the lab as its guest session. */
function ShareRoutePage() {
  const { token } = shareRoute.useParams();
  const navigate = useNavigate();
  const started = useRef(false);
  const redeem = useMutation({
    mutationFn: () => client.shares.redeem({ token }),
    onSuccess: async (result) => {
      queryClient.removeQueries({ queryKey: orpc.auth.me.key() });
      await queryClient.invalidateQueries();
      await navigate({
        to: '/projects/$projectId',
        params: { projectId: result.projectId },
        replace: true,
      });
    },
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    redeem.mutate();
  }, [redeem]);

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px]">
        {redeem.isError ? (
          <>
            <Notice tone="error">{messageOf(redeem.error)}</Notice>
            <p className="mt-4 text-[12px]" style={{ color: 'var(--color-ink-dim)' }}>
              Ask the person who shared the lab for a fresh link, or{' '}
              <Link to="/login" style={{ color: 'var(--color-copper)' }}>
                sign in
              </Link>
              .
            </p>
          </>
        ) : (
          <Loading label="Opening the shared lab…" />
        )}
      </div>
    </main>
  );
}

/** Pathless layout: the rail and status bar wrap every protected route. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
  beforeLoad: requireAuth,
  pendingComponent: () => (
    <div className="p-6">
      <Loading label="Checking session…" />
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: OverviewPage,
});

const projectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects',
  component: ProjectsPage,
});

const groupsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/groups',
  component: GroupsPage,
});

const computesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/computes',
  component: ComputesPage,
});

function librarySearch(search: Record<string, unknown>): { tab?: TabId } {
  const tab = search.tab;
  return typeof tab === 'string' ? { tab: tab as TabId } : {};
}

type TabId = 'templates' | 'appliances' | 'catalog' | 'images' | 'symbols';

const libraryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/library',
  validateSearch: librarySearch,
  component: LibraryPage,
});

function toolsSearch(search: Record<string, unknown>): { tab?: string } {
  return typeof search.tab === 'string' ? { tab: search.tab } : {};
}

const toolsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tools',
  validateSearch: toolsSearch,
  component: ToolsPage,
});

const workspaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/$projectId',
  component: WorkspaceRoutePage,
});

function WorkspaceRoutePage() {
  const { projectId } = workspaceRoute.useParams();
  return <WorkspacePage projectId={projectId} />;
}

const profileRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/profile',
  component: ProfilePage,
});

const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/users',
  component: UsersAdminPage,
});

const rolesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/roles',
  component: RolesAdminPage,
});

const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/audit',
  component: AuditAdminPage,
});

const oidcRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/oidc',
  component: OidcAdminPage,
});

const apiKeysRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/api-keys',
  component: ApiKeysAdminPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/settings',
  component: SettingsAdminPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  shareRoute,
  setupRoute,
  appRoute.addChildren([
    indexRoute,
    projectsRoute,
    groupsRoute,
    computesRoute,
    libraryRoute,
    toolsRoute,
    workspaceRoute,
    profileRoute,
    usersRoute,
    rolesRoute,
    auditRoute,
    oidcRoute,
    apiKeysRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingMs: 150,
  defaultPendingComponent: () => (
    <div className="p-6">
      <Loading label="Loading…" />
    </div>
  ),
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById('root');
if (!container) throw new Error('root element missing');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

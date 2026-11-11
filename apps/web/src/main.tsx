import { QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Loading } from './components/Page.tsx';
import { requireAuth } from './features/auth/require-auth.tsx';
import { ToolsPage } from './features/tools/ToolsPage.tsx';
import { WorkspacePage } from './features/workspace/WorkspacePage.tsx';
import { AppShell } from './lib/AppShell.tsx';
import { queryClient } from './lib/queryClient.ts';
import { ApiKeysAdminPage } from './routes/admin/api-keys.tsx';
import { AuditAdminPage } from './routes/admin/audit.tsx';
import { OidcAdminPage } from './routes/admin/oidc.tsx';
import { RolesAdminPage } from './routes/admin/roles.tsx';
import { SettingsAdminPage } from './routes/admin/settings.tsx';
import { UsersAdminPage } from './routes/admin/users.tsx';
import { ComputesPage } from './routes/computes.tsx';
import { ImagesRoutePage } from './routes/images.tsx';
import { LoginPage } from './routes/login.tsx';
import { NotFoundPage } from './routes/not-found.tsx';
import { OverviewPage } from './routes/overview.tsx';
import { ProfilePage } from './routes/profile.tsx';
import { ProjectsPage } from './routes/projects.tsx';
import { RouteError } from './routes/route-error.tsx';
import { TemplatesRoutePage } from './routes/templates.tsx';
import './styles.css';

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

const computesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/computes',
  component: ComputesPage,
});

const templatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/templates',
  component: TemplatesRoutePage,
});

function imagesSearch(search: Record<string, unknown>): { tab?: 'appliances' } {
  return search.tab === 'appliances' ? { tab: 'appliances' } : {};
}

const imagesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/images',
  validateSearch: imagesSearch,
  component: ImagesRoutePage,
});

const toolsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tools',
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
  appRoute.addChildren([
    indexRoute,
    projectsRoute,
    computesRoute,
    templatesRoute,
    imagesRoute,
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

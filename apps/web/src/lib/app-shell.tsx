import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { CaretDownIcon as ChevronDown, CaretRightIcon as ChevronRight, CpuIcon as Cpu, GlobeIcon as Globe, KeyIcon as KeyRound, SquaresFourIcon as LayoutTemplate, SquaresFourIcon as LayoutDashboard, SignOutIcon as LogOut, type Icon, NetworkIcon as Network, SidebarSimpleIcon as PanelLeftClose, SidebarIcon as PanelLeftOpen, ScrollIcon as ScrollText, HardDrivesIcon as Server, ShieldCheckIcon as ShieldCheck, SlidersHorizontalIcon as SlidersHorizontal, UserIcon as UserRound, UsersIcon as Users, WrenchIcon as Wrench   } from '@phosphor-icons/react';
import {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@netlabor/ui/components/dropdown-menu';
import { type ReactNode, useEffect, useState } from 'react';
import { Badge } from '../components/badge.tsx';
import { ToastViewport } from '../components/toast.tsx';
import { useMe } from '../features/auth/use-me.ts';
import { useWorkspaceStore } from '../features/workspace/store.ts';
import { orpc } from './api.ts';
import { startDownloadTracking } from './download-toasts.ts';
import { messageOf } from './errors.ts';
import { queryClient } from './query-client.ts';
import { versionLabel } from './version.ts';
import { Button } from '@netlabor/ui/components/button';

type AppPath =
  | '/'
  | '/projects'
  | '/computes'
  | '/library'
  | '/tools'
  | '/profile'
  | '/admin/users'
  | '/admin/roles'
  | '/admin/audit'
  | '/admin/oidc'
  | '/admin/api-keys'
  | '/admin/settings';

interface NavItem {
  to: AppPath;
  label: string;
  icon: Icon;
  /** Any one of these privileges reveals the entry; absent means signed-in. */
  requires?: string[];
}

const PRIMARY: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/projects', label: 'Projects', icon: Network, requires: ['project.read'] },
  { to: '/computes', label: 'Computes', icon: Server, requires: ['compute.read'] },
  {
    to: '/library',
    label: 'Library',
    icon: LayoutTemplate,
    requires: ['template.read', 'image.read'],
  },
  { to: '/tools', label: 'Tools', icon: Wrench },
];

/**
 * Settings-shaped destinations share one rail group and one taxonomy:
 * You (profile, keys) · Access (users, roles, SSO) · Controller (audit,
 * controller settings). Routes and privileges match the pages exactly.
 */
const SETTINGS_ITEMS: NavItem[] = [
  { to: '/profile', label: 'Profile & preferences', icon: UserRound },
  { to: '/admin/api-keys', label: 'API keys', icon: KeyRound },
  { to: '/admin/users', label: 'Users', icon: Users, requires: ['user.read', 'user.write'] },
  { to: '/admin/roles', label: 'Roles', icon: ShieldCheck, requires: ['user.read', 'user.write'] },
  { to: '/admin/oidc', label: 'Single sign-on', icon: Globe, requires: ['settings.write'] },
  { to: '/admin/audit', label: 'Audit', icon: ScrollText, requires: ['audit.read'] },
  {
    to: '/admin/settings',
    label: 'Controller',
    icon: SlidersHorizontal,
    requires: ['settings.read', 'settings.write'],
  },
];

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
  return (
    <Link
      to={item.to}
      className={`nb-rail-link ${collapsed ? 'justify-center px-0' : ''}`}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      title={collapsed ? item.label : undefined}
    >
      <item.icon size={collapsed ? 16 : 14} strokeWidth={1.75} aria-hidden />
      {collapsed ? null : item.label}
    </Link>
  );
}

/**
 * Collapsible rail section. The disclosure state lives in localStorage so the
 * sidebar stays as quiet as the user left it.
 */
function NavSection({
  label,
  items,
  storageKey,
  defaultOpen = true,
  collapsed,
}: {
  label: string;
  items: NavItem[];
  storageKey?: string;
  defaultOpen?: boolean;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(() => {
    if (!storageKey) return defaultOpen;
    return localStorage.getItem(storageKey) !== '0';
  });
  if (items.length === 0) return null;
  const toggle = () => {
    setOpen((value) => {
      const next = !value;
      if (storageKey) localStorage.setItem(storageKey, next ? '1' : '0');
      return next;
    });
  };
  if (collapsed) {
    return (
      <>
        <div
          aria-hidden
          className="mx-2 my-1"
          style={{ borderTop: '1px solid var(--color-rule)' }}
        />
        {items.map((item) => (
          <NavLink key={item.to} item={item} collapsed />
        ))}
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        className="nb-rule-label flex items-center gap-1 px-3 pt-3 pb-1 text-left hover:text-[var(--color-ink-dim)]"
        aria-expanded={open}
        onClick={toggle}
      >
        {open ? <ChevronDown size={10} aria-hidden /> : <ChevronRight size={10} aria-hidden />}
        {label}
      </button>
      {open ? items.map((item) => <NavLink key={item.to} item={item} collapsed={false} />) : null}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, can } = useMe();
  const navigate = useNavigate();
  // Progress toasts for OS-image downloads live app-wide, independent of pages.
  useEffect(() => startDownloadTracking(), []);
  const [railCollapsed, setRailCollapsed] = useState(() => {
    const stored = localStorage.getItem('nb.rail.collapsed');
    if (stored !== null) return stored === '1';
    return window.matchMedia('(max-width: 900px)').matches;
  });
  const toggleRail = () => {
    setRailCollapsed((value) => {
      localStorage.setItem('nb.rail.collapsed', value ? '0' : '1');
      return !value;
    });
  };
  const logout = useMutation({
    ...orpc.auth.logout.mutationOptions(),
    onSettled: () => {
      queryClient.clear();
      void navigate({ to: '/login', replace: true });
    },
  });

  const primaryItems = me ? PRIMARY.filter((item) => item.requires?.some(can) ?? true) : PRIMARY;
  const settingsItems = me ? SETTINGS_ITEMS.filter((item) => item.requires?.some(can) ?? true) : [];

  return (
    <div
      className="grid h-full grid-rows-[1fr_26px]"
      style={{ background: 'var(--color-panel-sunken)' }}
    >
      <a href="#nb-main" className="nb-skip-link">
        Skip to content
      </a>
      <div
        className="grid overflow-hidden"
        style={{ gridTemplateColumns: railCollapsed ? '44px 1fr' : '172px 1fr' }}
      >
        <aside
          className={`flex min-w-0 flex-col border-r ${railCollapsed ? 'nb-rail-collapsed' : ''}`}
          style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
        >
          <div
            className={`flex items-center gap-1 px-2 py-2 ${railCollapsed ? 'justify-center' : ''}`}
          >
            {railCollapsed ? null : (
              <Link to="/" className="min-w-0 flex-1 px-1" style={{ color: 'inherit' }}>
                <span className="block truncate text-[14px] font-semibold tracking-tight">
                  Netlabor
                </span>
                <div className="nb-rule-label mt-0.5">control plane</div>
              </Link>
            )}
            <Button type="button" aria-label={railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleRail} className="shrink-0" variant="ghost" size="xs">
              {railCollapsed ? (
                <PanelLeftOpen size={14} aria-hidden />
              ) : (
                <PanelLeftClose size={14} aria-hidden />
              )}
            </Button>
          </div>
          <nav className="flex flex-col py-1" aria-label="Main">
            {primaryItems.map((item) => (
              <NavLink key={item.to} item={item} collapsed={railCollapsed} />
            ))}
            <NavSection
              label="Settings"
              items={settingsItems}
              storageKey="nb.rail.settings"
              collapsed={railCollapsed}
            />
          </nav>
          <div className="mt-auto border-t px-2 py-2" style={{ borderColor: 'var(--color-rule)' }}>
            {me ? (
              <DropdownMenu>
                <DropdownMenuTrigger render={
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left hover:bg-[var(--color-panel-raised)] ${railCollapsed ? 'justify-center px-0' : ''}`}
                    style={{ color: 'var(--color-ink-dim)' }}
                    aria-label={`Account menu for ${me.username}`}
                    title={railCollapsed ? (me.displayName ?? me.username) : undefined}
                  >
                    <UserRound size={15} strokeWidth={1.75} aria-hidden />
                    {railCollapsed ? null : (
                      <>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px]">
                            {me.displayName ?? me.username}
                          </span>
                          <span
                            className="tabular block truncate text-[10px]"
                            style={{ color: 'var(--color-ink-faint)' }}
                          >
                            @{me.username}
                          </span>
                        </span>
                        <ChevronDown size={12} aria-hidden />
                      </>
                    )}
                  </button>
                }>
                </DropdownMenuTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuContent
                    align="start"
                    side="top"
                    sideOffset={6}
                    className="z-50 min-w-44 rounded-[3px] border p-1"
                    style={{
                      background: 'var(--color-panel)',
                      borderColor: 'var(--color-rule-strong)',
                      boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
                    }}
                  >
                    {me ? (
                      <DropdownMenuItem render={
                        <Link
                          to="/profile"
                          className="flex cursor-pointer items-center gap-2 rounded-[2px] px-2 py-1.5 text-[12.5px] outline-none data-[highlighted]:bg-[var(--color-panel-raised)]"
                          style={{ color: 'var(--color-ink-dim)' }}
                        >
                          <UserRound size={13} aria-hidden />
                          Profile & preferences
                        </Link>
                      }
                      />
                    ) : null}
                    <DropdownMenuSeparator
                      className="my-1 h-px"
                      style={{ background: 'var(--color-rule)' }}
                    />
                    <DropdownMenuItem
                      className="flex cursor-pointer items-center gap-2 rounded-[2px] px-2 py-1.5 text-[12.5px] outline-none data-[highlighted]:bg-[var(--color-panel-raised)]"
                      style={{ color: 'var(--color-signal-down)' }}
                      onClick={() => logout.mutate({})}
                    >
                      <LogOut size={13} aria-hidden /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenuPortal>
              </DropdownMenu>
            ) : (
              <span
                className="flex items-center gap-2.5 px-2 py-1.5 text-[12.5px]"
                style={{ color: 'var(--color-ink-faint)' }}
              >
                <UserRound size={15} strokeWidth={1.75} aria-hidden />
                not signed in
              </span>
            )}
            {logout.isError ? (
              <p className="px-2 pb-1 text-[10px]" style={{ color: 'var(--color-signal-down)' }}>
                {messageOf(logout.error)}
              </p>
            ) : null}
          </div>
        </aside>
        <main id="nb-main" className="min-w-0 overflow-auto">
          {children ?? <Outlet />}
        </main>
      </div>
      <StatusBar />
      <ToastViewport />
    </div>
  );
}

function StatusBar() {
  const { me, can } = useMe();
  const projectStatus = useWorkspaceStore((state) => state.projectStatus);
  const computes = useQuery({
    ...orpc.computes.list.queryOptions({ input: {} }),
    enabled: me !== null && can('compute.read'),
    refetchInterval: 30_000,
    retry: false,
  });
  const health = useQuery({
    ...orpc.health.ping.queryOptions({ input: {} }),
    refetchInterval: 15_000,
    retry: false,
  });
  const color = health.isPending
    ? 'var(--color-signal-warn)'
    : health.isError
      ? 'var(--color-signal-down)'
      : 'var(--color-signal-up)';
  const label = health.isPending
    ? 'contacting controller…'
    : health.isError
      ? 'degraded · controller unreachable'
      : 'controller reachable';
  const eventsColor =
    projectStatus?.events === 'live'
      ? 'var(--color-signal-up)'
      : projectStatus?.events === 'connecting'
        ? 'var(--color-signal-warn)'
        : 'var(--color-signal-down)';

  return (
    <footer
      className="flex items-center gap-4 overflow-hidden border-t px-3 text-[11px] whitespace-nowrap"
      style={{
        borderColor: 'var(--color-rule)',
        background: 'var(--color-panel)',
        color: 'var(--color-ink-faint)',
      }}
    >
      <span
        className="flex shrink-0 items-center gap-1.5"
        title={health.isError ? messageOf(health.error) : undefined}
      >
        <span
          aria-hidden
          className="inline-block size-[6px] rounded-full"
          style={{ background: color }}
        />
        {label}
      </span>
      {projectStatus ? (
        <>
          <span className="nb-stat shrink-0">
            <span className="nb-stat-label">events</span>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block size-[6px] rounded-full"
                style={{ background: eventsColor }}
              />
              <span className="nb-stat-value">
                {projectStatus.events === 'live' ? 'live' : projectStatus.events}
              </span>
            </span>
          </span>
          <span className="nb-stat min-w-0">
            <span className="nb-stat-label">selected</span>
            <span className="min-w-0 truncate" style={{ color: 'var(--color-ink-dim)' }}>
              {projectStatus.selectionLabel}
            </span>
          </span>
          <span className="nb-stat shrink-0">
            <span className="nb-stat-label">nodes</span>
            <span className="nb-stat-value">{projectStatus.nodeCount}</span>
          </span>
          <span className="nb-stat shrink-0">
            <span className="nb-stat-label">links</span>
            <span className="nb-stat-value">{projectStatus.linkCount}</span>
          </span>
          <span className="nb-stat shrink-0">
            <span className="nb-stat-label">drawings</span>
            <span className="nb-stat-value">{projectStatus.drawingCount}</span>
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            <span className="nb-stat">
              <span className="nb-stat-label">zoom</span>
              <span className="nb-stat-value">{Math.round(projectStatus.zoom * 100)}%</span>
            </span>
            <span className="flex items-center gap-1">
              <Badge tone={projectStatus.status === 'opened' ? 'up' : 'neutral'}>
                {projectStatus.status}
              </Badge>
              {projectStatus.locked ? <Badge tone="warn">locked</Badge> : null}
            </span>
          </span>
        </>
      ) : (
        <span className="ml-auto" />
      )}
      <span className={`nb-stat shrink-0 ${projectStatus ? '' : 'ml-auto'}`}>
        <Cpu size={12} aria-hidden />
        <span className="nb-stat-label">computes</span>
        <span className="nb-stat-value">
          {computes.isPending
            ? 'reading…'
            : computes.isError
              ? 'unavailable'
              : computes.data.length === 0
                ? 'none registered'
                : `${computes.data.filter((compute) => compute.status === 'online').length}/${computes.data.length} online`}
        </span>
      </span>
      <span className="nb-stat shrink-0">
        <span className="nb-stat-label">version</span>
        <span className="nb-stat-value tabular">{versionLabel(health.data?.version)}</span>
      </span>
    </footer>
  );
}

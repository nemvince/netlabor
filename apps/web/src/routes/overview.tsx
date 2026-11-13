import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  LayoutTemplate,
  type LucideIcon,
  Network,
  Server,
  Wrench,
} from 'lucide-react';
import { Badge } from '../components/Badge.tsx';
import { Page, PageHeader, RuleRow } from '../components/Page.tsx';
import { useMe } from '../features/auth/use-me.ts';
import { orpc } from '../lib/api.ts';
import { messageOf } from '../lib/errors.ts';
import { formatStamp } from '../lib/format.ts';

function QuickLink({
  to,
  icon: Icon,
  label,
  description,
}: {
  to: '/projects' | '/computes' | '/library' | '/tools';
  icon: LucideIcon;
  label: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-[var(--color-panel-raised)]"
      style={{ borderColor: 'var(--color-rule)', color: 'inherit' }}
    >
      <Icon size={15} strokeWidth={1.75} aria-hidden style={{ color: 'var(--color-ink-faint)' }} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
          {description}
        </span>
      </span>
      <ArrowRight size={13} aria-hidden style={{ color: 'var(--color-ink-faint)' }} />
    </Link>
  );
}

export function OverviewPage() {
  const { can } = useMe();
  const health = useQuery(orpc.health.ping.queryOptions({ input: {} }));
  const canReadProjects = can('project.read');
  const projects = useQuery({
    ...orpc.projects.list.queryOptions({
      input: { limit: 6, offset: 0, includeClosed: true },
    }),
    enabled: canReadProjects,
  });

  return (
    <Page>
      <PageHeader
        title="Control plane"
        description="One controller owns the database, the API, and every compute agent."
      />

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section
          className="nb-panel h-fit overflow-hidden"
          aria-label="Controller status"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          <header
            className="flex items-center justify-between gap-2 border-b px-4 py-2.5"
            style={{ borderColor: 'var(--color-rule)' }}
          >
            <h2 className="text-[13px] font-semibold">Controller</h2>
            {health.isPending ? (
              <span className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                checking…
              </span>
            ) : health.isError ? (
              <span className="text-[11px]" style={{ color: 'var(--color-signal-down)' }}>
                unreachable
              </span>
            ) : (
              <span className="text-[11px]" style={{ color: 'var(--color-signal-up)' }}>
                reachable
              </span>
            )}
          </header>
          <RuleRow label="Version">
            <span className="tabular">{health.data?.version ?? '—'}</span>
          </RuleRow>
          <RuleRow label="Checked">
            <span className="tabular">
              {health.data ? new Date(health.data.time).toLocaleTimeString() : '—'}
            </span>
          </RuleRow>
          {health.isError ? (
            <RuleRow label="Error">
              <span style={{ color: 'var(--color-signal-down)' }}>{health.error.message}</span>
            </RuleRow>
          ) : null}
        </section>

        <section className="nb-panel overflow-hidden" aria-label="Jump back in">
          <header
            className="border-b px-4 py-2.5"
            style={{ borderColor: 'var(--color-rule)' }}
          >
            <h2 className="text-[13px] font-semibold">Jump back in</h2>
          </header>
          {can('project.read') ? (
            <QuickLink
              to="/projects"
              icon={Network}
              label="Projects"
              description="Topologies, devices, and links"
            />
          ) : null}
          {can('compute.read') ? (
            <QuickLink
              to="/computes"
              icon={Server}
              label="Computes"
              description="Agents, pools, and live capacity"
            />
          ) : null}
          {can('template.read') || can('image.read') ? (
            <QuickLink
              to="/library"
              icon={LayoutTemplate}
              label="Library"
              description="Templates, appliance builds, images, and symbols"
            />
          ) : null}
          <QuickLink
            to="/tools"
            icon={Wrench}
            label="Network tools"
            description="Subnet splitter, VLSM planner, and IP calculator"
          />
        </section>
      </div>

      {canReadProjects ? (
        <section className="nb-panel mt-3 overflow-hidden" aria-label="Recent projects">
          <header
            className="flex items-center justify-between gap-2 border-b px-4 py-2.5"
            style={{ borderColor: 'var(--color-rule)' }}
          >
            <h2 className="text-[13px] font-semibold">Recent projects</h2>
            <Link
              to="/projects"
              className="text-[11px] underline-offset-2 hover:underline"
              style={{ color: 'var(--color-ink-faint)' }}
            >
              All projects
            </Link>
          </header>
          {projects.isPending ? (
            <p className="px-4 py-3 text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
              Reading projects…
            </p>
          ) : projects.isError ? (
            <p className="px-4 py-3 text-[12px]" style={{ color: 'var(--color-signal-down)' }}>
              {messageOf(projects.error)}
            </p>
          ) : (projects.data ?? []).length === 0 ? (
            <p className="px-4 py-3 text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
              No projects yet. Create one from the Projects page.
            </p>
          ) : (
            <ul>
              {(projects.data ?? []).map((project) => (
                <li key={project.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--color-rule)' }}>
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 hover:bg-[var(--color-panel-raised)]"
                    style={{ color: 'inherit' }}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {project.name}
                    </span>
                    <Badge tone={project.status === 'opened' ? 'up' : 'neutral'}>
                      {project.status}
                    </Badge>
                    <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                      {project.nodeCount} node{project.nodeCount === 1 ? '' : 's'} ·{' '}
                      {project.linkCount} link{project.linkCount === 1 ? '' : 's'} · updated{' '}
                      {formatStamp(project.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </Page>
  );
}

/** Minimal Prometheus registry: request counters plus database/WS/SSE gauges. */

import type { SQL } from 'bun';

const requests = new Map<string, number>();
let wsSessions = 0;
let sseClients = 0;

function routeClass(pathname: string): string {
  if (pathname.startsWith('/rpc')) return 'rpc';
  if (pathname.startsWith('/ws/')) return 'ws';
  if (pathname.startsWith('/api/uploads')) return 'uploads';
  if (pathname === '/mcp') return 'mcp';
  if (pathname === '/healthz' || pathname === '/version' || pathname === '/metrics') return 'ops';
  if (pathname.startsWith('/api/')) return 'api';
  return 'static';
}

export function recordHttpRequest(method: string, pathname: string): void {
  const key = `${method.toLowerCase()}|${routeClass(pathname)}`;
  requests.set(key, (requests.get(key) ?? 0) + 1);
}

export function wsSessionOpened(): void {
  wsSessions++;
}

export function wsSessionClosed(): void {
  wsSessions = Math.max(0, wsSessions - 1);
}

export function sseClientOpened(): void {
  sseClients++;
}

export function sseClientClosed(): void {
  sseClients = Math.max(0, sseClients - 1);
}

function metric(name: string, help: string, type: string, samples: string[]): string {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...samples].join('\n');
}

export async function renderMetrics(db: SQL): Promise<string> {
  const [projects, nodes, computes, jobs] = await Promise.all([
    db.unsafe<{ status: string; n: string }[]>(
      'SELECT status, count(*)::text AS n FROM projects GROUP BY status',
    ),
    db.unsafe<{ status: string; n: string }[]>(
      'SELECT status, count(*)::text AS n FROM nodes GROUP BY status',
    ),
    db.unsafe<{ status: string; n: string }[]>(
      'SELECT status, count(*)::text AS n FROM computes GROUP BY status',
    ),
    db.unsafe<{ state: string; n: string }[]>(
      'SELECT state, count(*)::text AS n FROM jobs GROUP BY state',
    ),
  ]);
  const sections = [
    metric(
      'nb_http_requests_total',
      'Controller HTTP requests by method and route class.',
      'counter',
      [...requests.entries()].map(([key, value]) => {
        const [method, route] = key.split('|');
        return `nb_http_requests_total{method="${method}",route="${route}"} ${value}`;
      }),
    ),
    metric('nb_websocket_sessions', 'Active console/VNC/Wireshark WebSocket sessions.', 'gauge', [
      `nb_websocket_sessions ${wsSessions}`,
    ]),
    metric('nb_sse_clients', 'Active event stream subscribers.', 'gauge', [
      `nb_sse_clients ${sseClients}`,
    ]),
    metric(
      'nb_projects',
      'Projects by lifecycle status.',
      'gauge',
      projects.map((row) => `nb_projects{status="${row.status}"} ${row.n}`),
    ),
    metric(
      'nb_nodes',
      'Nodes by status.',
      'gauge',
      nodes.map((row) => `nb_nodes{status="${row.status}"} ${row.n}`),
    ),
    metric(
      'nb_computes',
      'Computes by status.',
      'gauge',
      computes.map((row) => `nb_computes{status="${row.status}"} ${row.n}`),
    ),
    metric(
      'nb_jobs',
      'Jobs by state.',
      'gauge',
      jobs.map((row) => `nb_jobs{state="${row.state}"} ${row.n}`),
    ),
  ];
  return `${sections.join('\n')}\n`;
}

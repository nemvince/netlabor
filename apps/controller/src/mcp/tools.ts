/**
 * MCP tool catalog: a curated subset of the oRPC contract exposed to AI
 * clients. Names follow the plan; metadata (authz, summary) comes from the
 * contract so tools never drift from the API.
 */

import { router as contract } from '@netlabor/contract';

export interface McpTool {
  name: string;
  title: string;
  description: string;
  procedurePath: string;
  readOnly: boolean;
  destructive: boolean;
  inputSchema: unknown;
  outputSchema: unknown;
}

/** Tool name → controller procedure path (from the MCP section of the plan). */
export const MCP_TOOL_PROCEDURES: Record<string, string> = {
  project_list: 'projects.list',
  project_get: 'projects.get',
  project_create: 'projects.create',
  project_update: 'projects.update',
  project_open: 'projects.open',
  project_close: 'projects.close',
  project_export: 'projects.export',
  project_apply: 'projects.apply',
  node_list: 'nodes.list',
  node_get: 'nodes.get',
  node_create: 'nodes.create',
  node_update: 'nodes.update',
  node_delete: 'nodes.delete',
  node_start: 'nodes.start',
  node_stop: 'nodes.stop',
  node_suspend: 'nodes.suspend',
  node_reload: 'nodes.reload',
  link_list: 'links.list',
  link_create: 'links.create',
  link_update: 'links.update',
  link_delete: 'links.delete',
  link_filters_set: 'links.filters.set',
  link_filters_clear: 'links.filters.clear',
  capture_start: 'links.capture.start',
  capture_stop: 'links.capture.stop',
  capture_status: 'links.capture.status',
  packet_analyze: 'packet.analyze',
  packet_fields: 'packet.fields',
  template_list: 'templates.list',
  image_list: 'images.list',
  os_image_list: 'appliances.os.list',
  appliance_build_list: 'appliances.builds.list',
  appliance_build_get: 'appliances.builds.get',
  appliance_build_create: 'appliances.builds.create',
  appliance_build_cancel: 'appliances.builds.cancel',
  compute_list: 'computes.list',
  compute_stats: 'computes.stats',
  fault_inject: 'faults.inject',
  fault_clear: 'faults.clear',
  fault_list: 'faults.list',
  console_exec: 'nodes.console.exec',
  console_reset: 'nodes.resetConsole',
};

const DESTRUCTIVE = /\.(delete|clear|apply)$/;
const READ_ONLY =
  /\.(list|get|status|analyze|fields|stats|export|ping)$|^compute_stats$|^project_export$/;

interface ProcedureNode {
  inputSchema?: unknown;
  outputSchema?: unknown;
  meta?: unknown;
}

function procedureAt(path: string): ProcedureNode | null {
  const segments = path.split('.');
  let current: unknown = contract;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[segment];
  }
  if (!current || typeof current !== 'object' || !('~orpc' in current)) return null;
  const def = current['~orpc'];
  return typeof def === 'object' && def !== null ? (def as ProcedureNode) : null;
}

/** Title/description from the contract's openapi summary. */
function summaryOf(def: ProcedureNode): { title: string; description: string } {
  const meta = def.meta;
  if (meta && typeof meta === 'object' && 'openapi' in meta) {
    const openapi = meta.openapi;
    if (openapi && typeof openapi === 'object' && 'summarize' in openapi) {
      const summarize = openapi.summarize;
      if (typeof summarize === 'string') return { title: summarize, description: summarize };
    }
  }
  return { title: 'Unnamed tool', description: '' };
}

export function mcpTools(): McpTool[] {
  return Object.entries(MCP_TOOL_PROCEDURES).map(([name, procedurePath]) => {
    const def = procedureAt(procedurePath);
    const summary = def ? summaryOf(def) : { title: name, description: '' };
    return {
      name,
      title: summary.title,
      description: summary.description,
      procedurePath,
      readOnly: READ_ONLY.test(procedurePath) && !DESTRUCTIVE.test(procedurePath),
      destructive: DESTRUCTIVE.test(procedurePath),
      inputSchema: def?.inputSchema ?? null,
      outputSchema: def?.outputSchema ?? null,
    };
  });
}

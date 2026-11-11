/** tshark-driven packet analysis and field registry lookups. */

import { AppError, type PacketAnalyzeOutput, type PacketFieldRow } from '@netlabor/contract';
import type { AgentConfig } from '../config.ts';
import { capturePathFor } from '../dataplane/capture.ts';

const DEFAULT_FIELDS = [
  'frame.number',
  'frame.time_relative',
  'ip.src',
  'ip.dst',
  '_ws.col.Protocol',
  '_ws.col.Info',
];

let fieldCache: PacketFieldRow[] | null = null;

async function tsharkBinary(): Promise<string> {
  const binary = Bun.which('tshark');
  if (!binary)
    throw new AppError('CAPABILITY_UNSUPPORTED', 'tshark is not installed on this compute');
  return binary;
}

async function runTshark(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const binary = await tsharkBinary();
  const proc = Bun.spawn([binary, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}

export async function checkDisplayFilter(filter: string): Promise<void> {
  if (filter.trim().length === 0) return;
  const result = await runTshark(['-Y', filter, '-r', '/dev/null', '-c', '0']);
  if (result.code !== 0 && /isn't a valid|Invalid/i.test(result.stderr)) {
    throw new AppError('BAD_REQUEST', 'invalid display filter', { details: result.stderr.trim() });
  }
}

export async function fieldRegistry(): Promise<PacketFieldRow[]> {
  if (fieldCache) return fieldCache;
  const result = await runTshark(['-G', 'fields']);
  if (result.code !== 0) {
    throw new AppError('CAPABILITY_UNSUPPORTED', 'could not read the tshark field registry', {
      details: result.stderr.trim(),
    });
  }
  const fields: PacketFieldRow[] = [];
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('F\t')) {
      const parts = line.split('\t');
      const name = parts[2];
      const label = parts[3]?.replace(/\.$/, '') ?? name ?? '';
      if (!name?.includes('.')) continue;
      fields.push({
        name,
        label,
        type: parts[1] ?? 'FT_NONE',
        protocol: name.split('.')[0] ?? '',
      });
    }
  }
  fieldCache = fields;
  return fields;
}

export async function searchFields(query: string, limit = 50): Promise<PacketFieldRow[]> {
  const fields = await fieldRegistry();
  const needle = query.toLowerCase();
  return fields
    .filter(
      (field) =>
        needle.length === 0 ||
        field.name.toLowerCase().includes(needle) ||
        field.label.toLowerCase().includes(needle),
    )
    .slice(0, limit);
}

export interface AnalyzeOptions {
  config: AgentConfig;
  projectId: string;
  linkId: string;
  displayFilter?: string;
  fields?: string[];
  limit?: number;
}

export async function analyzeCapture(options: AnalyzeOptions): Promise<PacketAnalyzeOutput> {
  const pcap = capturePathFor(options.config, options.projectId, options.linkId);
  if (!(await Bun.file(pcap).exists())) {
    throw new AppError('NOT_FOUND', 'no capture file for this link');
  }
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 2000);
  const registry = await fieldRegistry();
  const known = new Set(registry.map((field) => field.name));
  const requested = (options.fields ?? []).filter((field) => {
    if (!known.has(field)) throw new AppError('BAD_REQUEST', `unknown field ${field}`);
    return !DEFAULT_FIELDS.includes(field);
  });
  if (options.displayFilter) await checkDisplayFilter(options.displayFilter);

  const columns = [...DEFAULT_FIELDS, ...requested];
  const args = ['-r', pcap, '-T', 'fields', '-E', 'separator=/t', '-E', 'occurrence=f'];
  if (options.displayFilter) args.push('-Y', options.displayFilter);
  args.push('-c', String(limit));
  for (const field of columns) args.push('-e', field);
  args.push('-n');

  const result = await runTshark(args);
  if (result.code !== 0) {
    throw new AppError('AGENT_ERROR', 'tshark failed', { details: result.stderr.trim() });
  }
  const rows = result.stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0);
  const frames = rows.map((line) => {
    const values = line.split('\t');
    const value = (index: number): string | null => {
      const raw = values[index];
      return raw === undefined || raw === '' ? null : raw;
    };
    const extra: Record<string, unknown> = {};
    requested.forEach((field, index) => {
      extra[field] = value(DEFAULT_FIELDS.length + index);
    });
    const relative = value(1);
    return {
      number: Number(value(0) ?? 0),
      timeRelative: relative === null ? null : Number(relative),
      source: value(2),
      destination: value(3),
      protocol: value(4),
      info: value(5),
      fields: extra,
    };
  });

  const protocols: Record<string, number> = {};
  for (const frame of frames) {
    if (!frame.protocol) continue;
    protocols[frame.protocol] = (protocols[frame.protocol] ?? 0) + 1;
  }

  return {
    frames,
    total: frames.length,
    truncated: frames.length >= limit,
    protocols,
    dlt: null,
  };
}


export async function analyzePcapFile(
  config: AgentConfig,
  pcapPath: string,
  displayFilter: string | undefined,
  fields: string[],
  limit: number,
): Promise<PacketAnalyzeOutput> {
  const projectId = pcapPath.split('/projects/')[1]?.split('/')[0];
  const linkId = pcapPath.split('/captures/')[1]?.replace(/\.pcap$/, '');
  if (!projectId || !linkId || pcapPath !== capturePathFor(config, projectId, linkId)) {
    throw new AppError('BAD_REQUEST', 'path is not a link capture');
  }
  return analyzeCapture({ config, projectId, linkId, displayFilter, fields, limit });
}

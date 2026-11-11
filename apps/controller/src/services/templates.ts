/** Device templates, base configurations, and the seeded catalog. */

import {
  AppError,
  AtmSwitchProperties,
  CloudProperties,
  DockerProperties,
  DynamipsProperties,
  HubProperties,
  IouProperties,
  NatProperties,
  type NodeType,
  QemuProperties,
  SwitchProperties,
  type TemplateListInput,
  type TemplateRow,
  VpcsProperties,
} from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import { newId } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { z } from 'zod';

interface TemplateRecord {
  id: string;
  name: string;
  node_type: NodeType;
  category: string;
  symbol: string;
  default_name_format: string;
  compute_id: string | null;
  pool_id: string | null;
  properties: Record<string, unknown>;
  required_images: unknown;
  faults: unknown;
  project_id: string | null;
  builtin: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const TEMPLATE_COLUMNS = `
  id, name, node_type, category, symbol, default_name_format, compute_id, pool_id,
  properties, required_images, faults, project_id, builtin, created_by, created_at, updated_at`;

function toTemplateRow(record: TemplateRecord): TemplateRow {
  return {
    id: record.id,
    name: record.name,
    nodeType: record.node_type,
    category: record.category,
    symbol: record.symbol,
    defaultNameFormat: record.default_name_format,
    computeId: record.compute_id,
    poolId: record.pool_id,
    properties: parseJsonColumn(record.properties, {}),
    builtin: record.builtin,
    createdBy: record.created_by,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
    requiredImages: parseJsonColumn(record.required_images, []),
    faults: parseJsonColumn(record.faults, []),
    projectId: record.project_id,
  };
}

/**
 * Property schemas keyed by node type. Templates are validated against these
 * so a broken seeded or user template cannot reach node creation.
 */
const PROPERTY_SCHEMAS: Record<NodeType, z.ZodType> = {
  qemu: QemuProperties,
  iou: IouProperties,
  dynamips: DynamipsProperties,
  vpcs: VpcsProperties,
  docker: DockerProperties,
  cloud: CloudProperties,
  nat: NatProperties,
  ethernet_switch: SwitchProperties,
  ethernet_hub: HubProperties,
  atm_switch: AtmSwitchProperties,
  frame_relay_switch: AtmSwitchProperties,
};

export function validateTemplateProperties(
  nodeType: NodeType,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = PROPERTY_SCHEMAS[nodeType].safeParse(properties);
  if (!parsed.success) {
    throw new AppError('BAD_REQUEST', `invalid properties for a ${nodeType} template`, {
      details: parsed.error.issues,
    });
  }
  return parsed.data as Record<string, unknown>;
}

export interface TemplateWriteInput {
  id?: string;
  name: string;
  nodeType: NodeType;
  category: string;
  symbol: string;
  defaultNameFormat: string;
  computeId?: string | null;
  poolId?: string | null;
  properties: Record<string, unknown>;
  requiredImages: Array<{ name: string; kind: string; filenamePattern: string; sha256?: string }>;
  faults: Array<{
    id: string;
    label: string;
    params: string[];
    commands: string[];
    recovery: string[];
    prompt?: string;
    requires: string[];
  }>;
  /** Project scope; null keeps the template in the global library. */
  projectId?: string | null;
}

/**
 * Template names must stay unambiguous inside one scope: a project sees the
 * global library next to its own templates, so a project template collides
 * with a global template of the same name as well.
 */
async function assertTemplateNameFree(
  db: SQL,
  name: string,
  projectId: string | null,
  exceptId?: string,
): Promise<void> {
  const rows = await db.unsafe<{ id: string }[]>(
    `SELECT id FROM templates
      WHERE deleted_at IS NULL
        AND name = $1
        AND (project_id IS NULL OR project_id = $2::uuid)
        AND ($3::uuid IS NULL OR id <> $3)`,
    [name, projectId, exceptId ?? null],
  );
  if (rows[0]) throw new AppError('CONFLICT', 'a template with this name already exists');
}

/**
 * List templates visible from one scope: the global library always, plus the
 * requesting project's own templates when `projectId` is supplied.
 */
export async function listTemplates(db: SQL, input: TemplateListInput): Promise<TemplateRow[]> {
  const rows = await db.unsafe<TemplateRecord[]>(
    `SELECT ${TEMPLATE_COLUMNS}
       FROM templates
      WHERE deleted_at IS NULL
        AND (project_id IS NULL OR project_id = $1::uuid)
        AND ($2::text IS NULL OR node_type = $2)
        AND ($3::text IS NULL OR category = $3)
        AND ($4::text IS NULL OR name ILIKE '%' || $4 || '%')
      ORDER BY category ASC, name ASC
      LIMIT $5 OFFSET $6`,
    [
      input.projectId ?? null,
      input.nodeType ?? null,
      input.category ?? null,
      input.search ?? null,
      input.limit,
      input.offset,
    ],
  );
  return rows.map(toTemplateRow);
}

export async function getTemplate(db: SQL, id: string): Promise<TemplateRow> {
  const rows = await db.unsafe<TemplateRecord[]>(
    `SELECT ${TEMPLATE_COLUMNS} FROM templates WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  const record = rows[0];
  if (!record) throw new AppError('NOT_FOUND', 'template not found');
  return toTemplateRow(record);
}

export async function createTemplate(
  db: SQL,
  userId: string | null,
  input: TemplateWriteInput,
): Promise<TemplateRow> {
  const id = input.id ?? newId();
  const projectId = input.projectId ?? null;
  const existing = await db.unsafe<{ id: string }[]>('SELECT id FROM templates WHERE id = $1', [
    id,
  ]);
  if (existing[0]) throw new AppError('CONFLICT', 'a template with this id already exists');
  await assertTemplateNameFree(db, input.name, projectId);
  const properties = validateTemplateProperties(input.nodeType, input.properties);
  await db.unsafe(
    `INSERT INTO templates (id, name, node_type, category, symbol, default_name_format, compute_id,
                            pool_id, properties, required_images, faults, project_id, builtin,
                            created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::uuid,
             false, $13)`,
    [
      id,
      input.name,
      input.nodeType,
      input.category,
      input.symbol,
      input.defaultNameFormat,
      input.computeId ?? null,
      input.poolId ?? null,
      properties,
      input.requiredImages,
      input.faults,
      projectId,
      userId,
    ],
  );
  return getTemplate(db, id);
}

export async function updateTemplate(
  db: SQL,
  input: TemplateWriteInput & { id: string },
): Promise<TemplateRow> {
  const existing = await getTemplate(db, input.id);
  // An omitted projectId keeps the current scope; an explicit null promotes the
  // template to the global library.
  const projectId = input.projectId === undefined ? existing.projectId : input.projectId;
  await assertTemplateNameFree(db, input.name, projectId, input.id);
  const properties = validateTemplateProperties(input.nodeType, input.properties);
  await db.unsafe(
    `UPDATE templates SET
       name = $2, node_type = $3, category = $4, symbol = $5, default_name_format = $6,
       compute_id = $7, pool_id = $8, properties = $9::jsonb,
       required_images = $10::jsonb, faults = $11::jsonb, project_id = $12::uuid, updated_at = now()
     WHERE id = $1`,
    [
      input.id,
      input.name,
      input.nodeType,
      input.category,
      input.symbol,
      input.defaultNameFormat,
      input.computeId ?? null,
      input.poolId ?? null,
      properties,
      input.requiredImages,
      input.faults,
      projectId,
    ],
  );
  return getTemplate(db, input.id);
}

export async function deleteTemplate(db: SQL, id: string): Promise<void> {
  const existing = await getTemplate(db, id);
  if (existing.builtin) {
    // Tombstone so the catalog seed does not recreate it on the next start.
    await db.unsafe('UPDATE templates SET deleted_at = now() WHERE id = $1', [id]);
    return;
  }
  await db.unsafe('DELETE FROM templates WHERE id = $1', [id]);
}

export async function duplicateTemplate(
  db: SQL,
  userId: string | null,
  id: string,
  name: string,
): Promise<TemplateRow> {
  const source = await getTemplate(db, id);
  const duplicateId = newId();
  await assertTemplateNameFree(db, name, source.projectId);
  await db.begin(async (tx) => {
    await (tx as SQL).unsafe(
      `INSERT INTO templates (id, name, node_type, category, symbol, default_name_format, compute_id,
                              pool_id, properties, required_images, faults, project_id, builtin,
                              created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::uuid,
               false, $13)`,
      [
        duplicateId,
        name,
        source.nodeType,
        source.category,
        source.symbol,
        source.defaultNameFormat,
        source.computeId,
        source.poolId,
        source.properties,
        source.requiredImages,
        source.faults,
        source.projectId,
        userId,
      ],
    );
    await (tx as SQL).unsafe(
      `INSERT INTO template_base_configs (template_id, filename, content)
       SELECT $1, filename, content FROM template_base_configs WHERE template_id = $2`,
      [duplicateId, id],
    );
  });
  return getTemplate(db, duplicateId);
}

export async function catalogTemplates(db: SQL): Promise<TemplateRow[]> {
  const rows = await db.unsafe<TemplateRecord[]>(
    `SELECT ${TEMPLATE_COLUMNS} FROM templates WHERE builtin = true AND deleted_at IS NULL
      ORDER BY category ASC, name ASC`,
  );
  return rows.map(toTemplateRow);
}

/* --------------------------------------------------------- base configs --- */

async function requireTemplate(db: SQL, templateId: string): Promise<void> {
  const rows = await db.unsafe<{ id: string }[]>('SELECT id FROM templates WHERE id = $1', [
    templateId,
  ]);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'template not found');
}

function assertConfigFilename(filename: string): void {
  if (filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') {
    throw new AppError(
      'BAD_REQUEST',
      'base configuration filenames cannot contain path separators',
    );
  }
}

export async function listBaseConfigs(
  db: SQL,
  templateId: string,
): Promise<Array<{ filename: string; content: string }>> {
  await requireTemplate(db, templateId);
  const rows = await db.unsafe<{ filename: string; content: string }[]>(
    'SELECT filename, content FROM template_base_configs WHERE template_id = $1 ORDER BY filename ASC',
    [templateId],
  );
  return rows.map((row) => ({ filename: row.filename, content: row.content }));
}

export async function readBaseConfig(
  db: SQL,
  templateId: string,
  filename: string,
): Promise<{ filename: string; content: string }> {
  await requireTemplate(db, templateId);
  const rows = await db.unsafe<{ filename: string; content: string }[]>(
    'SELECT filename, content FROM template_base_configs WHERE template_id = $1 AND filename = $2',
    [templateId, filename],
  );
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'base configuration not found');
  return { filename: row.filename, content: row.content };
}

export async function writeBaseConfig(
  db: SQL,
  templateId: string,
  filename: string,
  content: string,
): Promise<{ filename: string; content: string }> {
  await requireTemplate(db, templateId);
  assertConfigFilename(filename);
  await db.unsafe(
    `INSERT INTO template_base_configs (template_id, filename, content, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (template_id, filename) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [templateId, filename, content],
  );
  return { filename, content };
}

export async function deleteBaseConfig(
  db: SQL,
  templateId: string,
  filename: string,
): Promise<void> {
  await requireTemplate(db, templateId);
  const rows = await db.unsafe<{ filename: string }[]>(
    'DELETE FROM template_base_configs WHERE template_id = $1 AND filename = $2 RETURNING filename',
    [templateId, filename],
  );
  if (!rows[0]) throw new AppError('NOT_FOUND', 'base configuration not found');
}

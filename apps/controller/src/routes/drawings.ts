/** Drawings: shapes, text, notes, and picture drawings on the canvas. */

import { AppError } from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import { newId } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { AppDeps, Implementer } from '../implementer.ts';
import { sanitizeSvg } from '../services/symbols.ts';

interface DrawingRecord {
  id: string;
  project_id: string;
  type: string;
  svg: string | null;
  text: string | null;
  file_path: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number;
  layer: string;
  locked: boolean;
  style: Record<string, unknown> | string;
  created_at: Date;
  updated_at: Date;
}

function toRow(record: DrawingRecord) {
  return {
    id: record.id,
    projectId: record.project_id,
    type: record.type as 'rect',
    svg: record.svg,
    text: record.text,
    filePath: record.file_path,
    x: Number(record.x),
    y: Number(record.y),
    width: Number(record.width),
    height: Number(record.height),
    rotation: Number(record.rotation),
    z: record.z,
    layer: record.layer,
    locked: record.locked,
    style: parseJsonColumn(record.style, {}),
  };
}

const COLUMNS = `id, project_id, type, svg, text, file_path, x, y, width, height, rotation, z, layer, locked, style`;

export function drawingRoutes(os: Implementer, _deps: AppDeps) {
  return {
    drawings: {
      list: os.drawings.list.handler(async ({ input, context }) => {
        const rows = await context.db.unsafe<DrawingRecord[]>(
          `SELECT ${COLUMNS} FROM drawings WHERE project_id = $1 ORDER BY z ASC`,
          [input.projectId],
        );
        return rows.map(toRow);
      }),
      create: os.drawings.create.handler(async ({ input, context }) => {
        await assertUnlocked(context, input.projectId);
        const id = newId();
        const rows = await context.db.unsafe<DrawingRecord[]>(
          `INSERT INTO drawings (id, project_id, type, svg, text, file_path, x, y, width, height, rotation, z, layer, style)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) RETURNING ${COLUMNS}`,
          [
            id,
            input.projectId,
            input.type,
            input.svg ? sanitizeSvg(input.svg) : null,
            input.text ?? null,
            input.filePath ?? null,
            input.x,
            input.y,
            input.width,
            input.height,
            input.rotation,
            input.z,
            input.layer,
            input.style ?? {},
          ],
        );
        const row = rows[0];
        if (!row) throw new AppError('INTERNAL', 'drawing insert failed');
        await context.events.publish({
          type: 'drawing.created',
          projectId: input.projectId,
          payload: { drawingId: id, type: input.type },
        });
        return toRow(row);
      }),
      update: os.drawings.update.handler(async ({ input, context }) => {
        const existing = await context.db.unsafe<DrawingRecord[]>(
          `SELECT ${COLUMNS} FROM drawings WHERE id = $1`,
          [input.id],
        );
        const current = existing[0];
        if (!current) throw new AppError('NOT_FOUND', 'drawing not found');
        await assertUnlocked(context, current.project_id);
        const style = input.style
          ? { ...parseJsonColumn<Record<string, unknown>>(current.style, {}), ...input.style }
          : null;
        const rows = await context.db.unsafe<DrawingRecord[]>(
          `UPDATE drawings SET
             type = COALESCE($2, type),
             text = CASE WHEN $3::boolean THEN $4 ELSE text END,
             svg = CASE WHEN $5::boolean THEN $6 ELSE svg END,
             file_path = CASE WHEN $7::boolean THEN $8 ELSE file_path END,
             x = COALESCE($9, x), y = COALESCE($10, y),
             width = COALESCE($11, width), height = COALESCE($12, height),
             rotation = COALESCE($13, rotation), z = COALESCE($14, z),
             layer = COALESCE($15, layer),
             style = COALESCE($16::jsonb, style)
           WHERE id = $1 RETURNING ${COLUMNS}`,
          [
            input.id,
            input.type ?? null,
            input.text !== undefined,
            input.text ?? null,
            input.svg !== undefined,
            input.svg ? sanitizeSvg(input.svg) : null,
            input.filePath !== undefined,
            input.filePath ?? null,
            input.x ?? null,
            input.y ?? null,
            input.width ?? null,
            input.height ?? null,
            input.rotation ?? null,
            input.z ?? null,
            input.layer ?? null,
            style ?? null,
          ],
        );
        const row = rows[0];
        if (!row) throw new AppError('NOT_FOUND', 'drawing not found');
        await context.events.publish({
          type: 'drawing.updated',
          projectId: current.project_id,
          payload: { drawingId: input.id },
        });
        return toRow(row);
      }),
      delete: os.drawings.delete.handler(async ({ input, context }) => {
        const rows = await context.db.unsafe<{ project_id: string }[]>(
          'DELETE FROM drawings WHERE id = $1 RETURNING project_id',
          [input.id],
        );
        const row = rows[0];
        if (!row) throw new AppError('NOT_FOUND', 'drawing not found');
        await context.events.publish({
          type: 'drawing.deleted',
          projectId: row.project_id,
          payload: { drawingId: input.id },
        });
        return { ok: true as const };
      }),
    },
  };
}

async function assertUnlocked(context: { db: SQL }, projectId: string): Promise<void> {
  const rows = await context.db.unsafe<{ locked: boolean }[]>(
    'SELECT locked FROM projects WHERE id = $1',
    [projectId],
  );
  if (!rows[0]) throw new AppError('NOT_FOUND', 'project not found');
  if (rows[0].locked) throw new AppError('CONFLICT', 'project is locked');
}

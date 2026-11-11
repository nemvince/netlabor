/** Background jobs: progress tracking with event notifications. */

import { AppError, type JobRow, type JobsListInput } from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import type { Logger } from '@netlabor/shared';
import { newId } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { EventBus } from '../realtime/events.ts';

interface JobRecord {
  id: string;
  kind: string;
  state: 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

function toRow(record: JobRecord): JobRow {
  return {
    id: record.id,
    kind: record.kind,
    state: record.state,
    progress: Number(record.progress),
    payload: parseJsonColumn(record.payload, {}),
    result: record.result === null ? null : parseJsonColumn(record.result, {}),
    error: record.error,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

export class JobService {
  constructor(
    private readonly db: SQL,
    private readonly events: EventBus,
    private readonly logger: Logger,
  ) {}

  async create(kind: string, payload: Record<string, unknown> = {}): Promise<JobRow> {
    const id = newId();
    const rows = await this.db.unsafe<JobRecord[]>(
      `INSERT INTO jobs (id, kind, state, progress, payload) VALUES ($1, $2, 'running', 0, $3::jsonb)
       RETURNING id, kind, state, progress, payload, result, error, created_at, updated_at`,
      [id, kind, payload],
    );
    const job = toRow(rows[0] as JobRecord);
    await this.publish(job);
    return job;
  }

  async progress(id: string, progress: number, message?: string): Promise<void> {
    await this.db.unsafe('UPDATE jobs SET progress = $2, updated_at = now() WHERE id = $1', [
      id,
      Math.max(0, Math.min(100, progress)),
    ]);
    await this.publish(await this.get(id));
    if (message) this.logger.debug('job progress', { jobId: id, progress, message });
  }

  async complete(id: string, result: Record<string, unknown> = {}): Promise<JobRow> {
    await this.db.unsafe(
      `UPDATE jobs SET state = 'completed', progress = 100, result = $2::jsonb, updated_at = now() WHERE id = $1`,
      [id, result],
    );
    const job = await this.get(id);
    await this.publish(job);
    return job;
  }

  async fail(id: string, error: string): Promise<JobRow> {
    await this.db.unsafe(
      `UPDATE jobs SET state = 'failed', error = $2, updated_at = now() WHERE id = $1`,
      [id, error],
    );
    const job = await this.get(id);
    await this.publish(job);
    return job;
  }

  async cancel(id: string): Promise<JobRow> {
    const job = await this.get(id);
    if (job.state !== 'running') throw new AppError('CONFLICT', 'job is not running');
    await this.db.unsafe(`UPDATE jobs SET state = 'cancelled', updated_at = now() WHERE id = $1`, [
      id,
    ]);
    const cancelled = await this.get(id);
    await this.publish(cancelled);
    return cancelled;
  }

  async get(id: string): Promise<JobRow> {
    const rows = await this.db.unsafe<JobRecord[]>(
      'SELECT id, kind, state, progress, payload, result, error, created_at, updated_at FROM jobs WHERE id = $1',
      [id],
    );
    const record = rows[0];
    if (!record) throw new AppError('NOT_FOUND', 'job not found');
    return toRow(record);
  }

  async list(input: JobsListInput): Promise<JobRow[]> {
    const rows = await this.db.unsafe<JobRecord[]>(
      `SELECT id, kind, state, progress, payload, result, error, created_at, updated_at
         FROM jobs
        WHERE ($1::text IS NULL OR kind = $1)
          AND ($2::text IS NULL OR state = $2)
          AND ($3::uuid IS NULL OR payload->>'projectId' = $3::text)
        ORDER BY created_at DESC LIMIT $4 OFFSET $5`,
      [input.kind ?? null, input.state ?? null, input.projectId ?? null, input.limit, input.offset],
    );
    return rows.map(toRow);
  }

  private async publish(job: JobRow): Promise<void> {
    const projectId = typeof job.payload.projectId === 'string' ? job.payload.projectId : null;
    await this.events.publish({
      type: 'job.updated',
      projectId,
      payload: {
        jobId: job.id,
        kind: job.kind,
        state: job.state,
        progress: job.progress,
        error: job.error,
      },
    });
  }
}

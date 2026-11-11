import type { JobRow } from '@netlabor/contract';
import { Badge, type BadgeTone } from '@web/components/Badge.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '@web/components/Table.tsx';
import { formatStamp } from '@web/lib/format.ts';
import { jobs, snapshots } from '../fixtures/workspace.ts';

const JOB_TONE: Record<JobRow['state'], BadgeTone> = {
  running: 'info',
  completed: 'up',
  failed: 'down',
  cancelled: 'warn',
};

function gigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export interface SnapshotTableProps {
  /** Snapshot rows to show; defaults to the fixture list. */
  limit?: number;
}

/**
 * Restore points and their jobs in the product's dense tables. Sizes, states,
 * and error lines are the same values the snapshot dialog renders.
 */
export default function SnapshotTable({ limit = snapshots.length }: SnapshotTableProps) {
  return (
    <div className="flex flex-col gap-3">
      <Table label="Project snapshots">
        <THead>
          <Th>Snapshot</Th>
          <Th>Created</Th>
          <Th align="right">Size</Th>
          <Th>sha256</Th>
        </THead>
        <TBody>
          {snapshots.slice(0, limit).map((snapshot) => (
            <Tr key={snapshot.id}>
              <Td>
                <span className="flex flex-col gap-0.5">
                  <span>{snapshot.name}</span>
                  {snapshot.description ? (
                    <span className="text-[11px] text-[var(--color-ink-faint)]">
                      {snapshot.description}
                    </span>
                  ) : null}
                </span>
              </Td>
              <Td mono>{formatStamp(snapshot.createdAt)}</Td>
              <Td mono align="right">
                {gigabytes(snapshot.sizeBytes)}
              </Td>
              <Td mono title={snapshot.sha256}>
                {snapshot.sha256.slice(0, 12)}…
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      <Table label="Snapshot and archive jobs">
        <THead>
          <Th>Job</Th>
          <Th>State</Th>
          <Th align="right">Progress</Th>
          <Th>Detail</Th>
        </THead>
        <TBody>
          {jobs.map((job) => (
            <Tr key={job.id}>
              <Td mono>{job.kind}</Td>
              <Td>
                <Badge tone={JOB_TONE[job.state]}>{job.state}</Badge>
              </Td>
              <Td mono align="right">
                {job.progress}%
              </Td>
              <Td>
                {job.error ? (
                  <span className="text-[12px] text-[var(--color-signal-down)]">{job.error}</span>
                ) : (
                  <span className="text-[12px] text-[var(--color-ink-faint)]">
                    {job.state === 'running' ? 'streaming progress' : 'no error'}
                  </span>
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

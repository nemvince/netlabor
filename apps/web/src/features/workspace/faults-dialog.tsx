import type { FaultRow, LinkRow, NodeRow, TemplateRow } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { WarningIcon as AlertTriangle, CaretDownIcon as ChevronDown, CaretRightIcon as ChevronRight, PlayIcon as Play, TrashIcon as Trash2, LightningIcon as Zap   } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../../components/badge.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { Field, Select } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading } from '../../components/page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/table.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp } from '../../lib/format.ts';
import { queryClient } from '../../lib/query-client.ts';

interface LinkFaultDefinition {
  id: string;
  label: string;
  detail: string;
}

const LINK_FAULTS: LinkFaultDefinition[] = [
  { id: 'link_delay_100ms', label: 'Add 100 ms latency', detail: 'delay 100 ms, jitter 10 ms' },
  { id: 'link_delay_500ms', label: 'Add 500 ms latency', detail: 'delay 500 ms, jitter 20 ms' },
  { id: 'link_loss_10', label: 'Drop 10% of packets', detail: 'loss 10%' },
  { id: 'link_loss_50', label: 'Drop 50% of packets', detail: 'loss 50%' },
  { id: 'link_corrupt_5', label: 'Corrupt 5% of packets', detail: 'corrupt 5%' },
];

interface Candidate {
  key: string;
  faultId: string;
  label: string;
  detail: string;
  kind: 'link' | 'device';
  targetLabel: string;
  linkId?: string;
  nodeId?: string;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function faultLabel(fault: FaultRow): string {
  return stringField(fault.params, 'label') ?? fault.kind;
}

function faultTarget(fault: FaultRow): string {
  return (
    stringField(fault.target, 'linkName') ??
    stringField(fault.target, 'nodeName') ??
    stringField(fault.target, 'linkId') ??
    stringField(fault.target, 'nodeId') ??
    'unknown target'
  );
}

function transcriptOf(fault: FaultRow): string | null {
  if (!fault.recovery) return null;
  const transcript = fault.recovery.transcript;
  return typeof transcript === 'string' && transcript.trim() !== '' ? transcript : null;
}

function stateTone(fault: FaultRow): 'up' | 'warn' | 'down' | 'neutral' {
  if (fault.state === 'active') return 'down';
  if (fault.state === 'error') return 'warn';
  return 'neutral';
}

/**
 * Fault injection console: applicable link and device faults, target preview,
 * per-fault results, recovery transcripts, and clearing.
 */
export function FaultsDialog({
  projectId,
  onOpenChange,
}: {
  projectId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [count, setCount] = useState<'1' | '2' | '3' | 'random'>('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [results, setResults] = useState<FaultRow[]>([]);
  const [expandedTranscript, setExpandedTranscript] = useState<string | null>(null);

  const faults = useQuery({
    ...orpc.faults.list.queryOptions({ input: { projectId } }),
    refetchInterval: 4000,
  });
  const nodes = useQuery({ ...orpc.nodes.list.queryOptions({ input: { projectId } }) });
  const links = useQuery({ ...orpc.links.list.queryOptions({ input: { projectId } }) });
  const templates = useQuery(
    orpc.templates.list.queryOptions({ input: { limit: 500, offset: 0 } }),
  );

  const candidates = useMemo<Candidate[]>(() => {
    const activeLinks: LinkRow[] = (links.data ?? []).filter((link) => link.status === 'active');
    const templateById = new Map((templates.data ?? []).map((row) => [row.id, row]));
    const startedNodes: NodeRow[] = (nodes.data ?? []).filter((node) => node.status === 'started');

    const linkCandidates = activeLinks.flatMap((link) =>
      LINK_FAULTS.map((fault) => ({
        key: `link:${link.id}:${fault.id}`,
        faultId: fault.id,
        label: fault.label,
        detail: fault.detail,
        kind: 'link' as const,
        targetLabel: `${link.nodeAName} ↔ ${link.nodeBName}`,
        linkId: link.id,
      })),
    );

    const deviceCandidates = startedNodes.flatMap((node) => {
      const template: TemplateRow | undefined = node.templateId
        ? templateById.get(node.templateId)
        : undefined;
      return (template?.faults ?? []).map((fault) => ({
        key: `device:${node.id}:${fault.id}`,
        faultId: fault.id,
        label: fault.label,
        detail: `params ${fault.params.join(', ') || 'none'}${fault.requires.length > 0 ? ` · requires ${fault.requires.join(', ')}` : ''}`,
        kind: 'device' as const,
        targetLabel: node.name,
        nodeId: node.id,
      }));
    });

    return [...linkCandidates, ...deviceCandidates];
  }, [links.data, nodes.data, templates.data]);

  const effectiveSelected = useMemo(
    () => selected ?? new Set(candidates.map((candidate) => candidate.key)),
    [candidates, selected],
  );
  const selectedCandidates = candidates.filter((candidate) => effectiveSelected.has(candidate.key));
  const activeFaults = (faults.data ?? []).filter((fault) => fault.state !== 'cleared');

  useEffect(() => {
    setSelected(null);
    setResults([]);
    setError(null);
    setNotice(null);
    setExpandedTranscript(null);
  }, []);

  function toggleCandidate(key: string) {
    setSelected((current) => {
      const next = new Set(current ?? candidates.map((candidate) => candidate.key));
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function inject() {
    if (selectedCandidates.length === 0) {
      setError('Select at least one applicable fault.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    setResults([]);
    const faultIds = [...new Set(selectedCandidates.map((candidate) => candidate.faultId))];
    const linkIds = [
      ...new Set(
        selectedCandidates.flatMap((candidate) => (candidate.linkId ? [candidate.linkId] : [])),
      ),
    ];
    const nodeIds = [
      ...new Set(
        selectedCandidates.flatMap((candidate) => (candidate.nodeId ? [candidate.nodeId] : [])),
      ),
    ];
    try {
      const injected = await client.faults.inject({
        projectId,
        count: count === 'random' ? 'random' : Number(count),
        faultIds,
        target: {
          kind: nodeIds.length > 0 && linkIds.length === 0 ? 'device' : 'link',
          ...(linkIds.length > 0 ? { linkIds } : {}),
          ...(nodeIds.length > 0 ? { nodeIds } : {}),
        },
      });
      setResults(injected);
      setNotice(
        `Injected ${injected.length} fault${injected.length === 1 ? '' : 's'}. Recovery is available per row.`,
      );
      void queryClient.invalidateQueries({ queryKey: orpc.faults.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.links.list.key() });
    } catch (injectError) {
      setError(messageOf(injectError));
    } finally {
      setBusy(false);
    }
  }

  async function clearFaults(ids?: string[]) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const cleared = await client.faults.clear({
        projectId,
        ...(ids ? { faultIds: ids } : {}),
      });
      setNotice(
        cleared.length === 0
          ? 'No faults were cleared; recovery may have failed.'
          : `Cleared ${cleared.length} fault${cleared.length === 1 ? '' : 's'}.`,
      );
      void queryClient.invalidateQueries({ queryKey: orpc.faults.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.links.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.nodes.list.key() });
    } catch (clearError) {
      setError(messageOf(clearError));
    } finally {
      setBusy(false);
    }
  }

  const reading = nodes.isPending || links.isPending || templates.isPending || faults.isPending;
  const deviceCandidateCount = candidates.filter((candidate) => candidate.kind === 'device').length;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      title="Fault injection"
      description="Apply link impairment or device console faults, then clear them to run recovery."
      width={860}
    >
      {reading ? (
        <Loading label="Reading fault targets…" />
      ) : (
        <div className="flex flex-col gap-3">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {notice ? <Notice tone="success">{notice}</Notice> : null}

          <div className="grid grid-cols-[1fr_210px] gap-3">
            <div
              className="max-h-64 overflow-y-auto rounded-[3px] border"
              style={{ borderColor: 'var(--color-rule)' }}
            >
              <div
                className="sticky top-0 z-10 flex items-center justify-between border-b px-2 py-1"
                style={{
                  borderColor: 'var(--color-rule)',
                  background: 'var(--color-panel-raised)',
                }}
              >
                <span className="nb-rule-label">Applicable faults</span>
                <button
                  type="button"
                  className="text-[10px] underline"
                  style={{ color: 'var(--color-ink-faint)' }}
                  onClick={() =>
                    setSelected(
                      selectedCandidates.length === candidates.length
                        ? new Set()
                        : new Set(candidates.map((candidate) => candidate.key)),
                    )
                  }
                >
                  {selectedCandidates.length === candidates.length
                    ? 'clear selection'
                    : 'select all'}
                </button>
              </div>
              {candidates.length === 0 ? (
                <div className="p-3 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                  No active link or started device offers a fault. Open the project, start nodes,
                  and wait for links to become active.
                </div>
              ) : (
                <ul className="divide-y" style={{ borderColor: 'var(--color-rule)' }}>
                  {candidates.map((candidate) => {
                    const checked = effectiveSelected.has(candidate.key);
                    return (
                      <li key={candidate.key}>
                        <label
                          className="flex cursor-pointer items-start gap-2 px-2 py-1.5 hover:bg-white/[0.02]"
                          style={{ opacity: checked ? 1 : 0.62 }}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 size-3.5 shrink-0"
                            style={{ accentColor: 'var(--color-copper)' }}
                            checked={checked}
                            onChange={() => toggleCandidate(candidate.key)}
                          />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[12px]">{candidate.label}</span>
                              <Badge tone={candidate.kind === 'link' ? 'info' : 'copper'}>
                                {candidate.kind}
                              </Badge>
                              <span
                                className="tabular text-[10px]"
                                style={{ color: 'var(--color-ink-faint)' }}
                              >
                                {candidate.targetLabel}
                              </span>
                            </span>
                            <span
                              className="tabular block text-[10px]"
                              style={{ color: 'var(--color-ink-faint)' }}
                            >
                              {candidate.detail}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Field label="Count" htmlFor="fault-count" hint="random picks one to three.">
                <Select
                  id="fault-count"
                  value={count}
                  onChange={(event) => setCount(event.target.value as typeof count)}
                >
                  <option value="1">1 fault</option>
                  <option value="2">2 faults</option>
                  <option value="3">3 faults</option>
                  <option value="random">Random</option>
                </Select>
              </Field>
              <div
                className="rounded-[3px] border px-2 py-1.5 text-[11px]"
                style={{
                  borderColor: 'var(--color-rule)',
                  background: 'var(--color-panel-sunken)',
                }}
              >
                <div className="nb-rule-label">Target preview</div>
                <div
                  className="mt-1 flex flex-col gap-0.5"
                  style={{ color: 'var(--color-ink-dim)' }}
                >
                  <span>
                    {selectedCandidates.length} applicable fault
                    {selectedCandidates.length === 1 ? '' : 's'} selected
                  </span>
                  <span>
                    {new Set(selectedCandidates.map((candidate) => candidate.targetLabel)).size}{' '}
                    target(s)
                  </span>
                  <span>
                    device faults {deviceCandidateCount === 0 ? 'unavailable' : 'available'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="nb-button"
                data-variant="primary"
                disabled={busy || selectedCandidates.length === 0}
                onClick={() => void inject()}
              >
                <Zap size={13} aria-hidden /> {busy ? 'Applying…' : 'Inject faults'}
              </button>
              <button
                type="button"
                className="nb-button"
                data-variant="danger"
                disabled={busy || activeFaults.length === 0}
                onClick={() => void clearFaults()}
              >
                <Trash2 size={13} aria-hidden /> Clear active faults
              </button>
            </div>
          </div>

          {deviceCandidateCount === 0 ? (
            <Notice tone="warn">
              Device faults are disabled: no started node uses a template with a fault catalog. Link
              faults stay available on active links.
            </Notice>
          ) : null}

          {results.length > 0 ? (
            <section>
              <div className="mb-1 flex items-center gap-2">
                <span className="nb-rule-label">Injection results</span>
                <Badge tone="up">{results.length} applied</Badge>
              </div>
              <FaultTable
                faults={results}
                busy={busy}
                expanded={expandedTranscript}
                onExpand={setExpandedTranscript}
                onClear={(id) => void clearFaults([id])}
              />
            </section>
          ) : null}

          <section>
            <div className="mb-1 flex items-center justify-between">
              <span className="nb-rule-label">Faults in this project</span>
              {activeFaults.length > 0 ? (
                <span
                  className="flex items-center gap-1 text-[10px]"
                  style={{ color: 'var(--color-signal-warn)' }}
                >
                  <AlertTriangle size={11} aria-hidden /> {activeFaults.length} active or errored
                </span>
              ) : null}
            </div>
            {faults.isError ? (
              <Notice tone="error">{messageOf(faults.error)}</Notice>
            ) : (faults.data ?? []).length === 0 ? (
              <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                No faults have been injected in this project.
              </p>
            ) : (
              <FaultTable
                faults={faults.data ?? []}
                busy={busy}
                expanded={expandedTranscript}
                onExpand={setExpandedTranscript}
                onClear={(id) => void clearFaults([id])}
              />
            )}
          </section>

          <div
            className="flex items-center justify-between border-t pt-2"
            style={{ borderColor: 'var(--color-rule)' }}
          >
            <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
              Link faults are reversible filters. Device faults run console commands and expose the
              recovery transcript.
            </span>
            <button type="button" className="nb-button" onClick={() => onOpenChange(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function FaultTable({
  faults,
  busy,
  expanded,
  onExpand,
  onClear,
}: {
  faults: FaultRow[];
  busy: boolean;
  expanded: string | null;
  onExpand: (id: string | null) => void;
  onClear: (id: string) => void;
}) {
  return (
    <Table label="Project faults">
      <THead>
        <Th>Kind</Th>
        <Th>Fault</Th>
        <Th>Target</Th>
        <Th>State</Th>
        <Th>Created</Th>
        <Th align="right">Actions</Th>
      </THead>
      <TBody>
        {faults.map((fault) => {
          const transcript = transcriptOf(fault);
          const open = expanded === fault.id;
          return (
            <Tr key={fault.id}>
              <Td>
                <Badge tone={fault.kind === 'link' ? 'info' : 'copper'}>{fault.kind}</Badge>
              </Td>
              <Td>
                <span className="text-[12px]">{faultLabel(fault)}</span>
                {transcript ? (
                  <button
                    type="button"
                    className="ml-1 inline-flex items-center gap-0.5 text-[10px] underline"
                    style={{ color: 'var(--color-copper)' }}
                    onClick={() => onExpand(open ? null : fault.id)}
                  >
                    {open ? (
                      <ChevronDown size={10} aria-hidden />
                    ) : (
                      <ChevronRight size={10} aria-hidden />
                    )}
                    transcript
                  </button>
                ) : null}
                {open && transcript ? (
                  <pre
                    className="tabular mt-1 max-h-40 overflow-auto rounded-[2px] border p-1.5 text-[10px] leading-[1.45] whitespace-pre-wrap"
                    style={{
                      borderColor: 'var(--color-rule)',
                      background: 'var(--color-panel-sunken)',
                      color: 'var(--color-ink-dim)',
                    }}
                  >
                    {transcript}
                  </pre>
                ) : null}
              </Td>
              <Td mono>{faultTarget(fault)}</Td>
              <Td>
                <Badge tone={stateTone(fault)}>{fault.state}</Badge>
              </Td>
              <Td mono>{formatStamp(fault.createdAt)}</Td>
              <Td align="right">
                {fault.state === 'cleared' ? (
                  <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                    cleared {formatStamp(fault.clearedAt)}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="nb-button"
                    data-size="sm"
                    disabled={busy}
                    onClick={() => onClear(fault.id)}
                  >
                    <Play size={11} aria-hidden /> Recover
                  </button>
                )}
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}

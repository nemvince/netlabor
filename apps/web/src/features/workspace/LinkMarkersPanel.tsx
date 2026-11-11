import type { EventEnvelope, MarkerRow } from '@netlabor/contract';
import { MarkerHit } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Badge } from '../../components/Badge.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { Field, Input, Select } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { Loading } from '../../components/Page.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { queryClient } from '../../lib/queryClient.ts';
import { useMe } from '../auth/use-me.ts';

const markerSchema = z.object({
  name: z
    .string()
    .min(1, 'enter a marker name')
    .max(64, 'use at most 64 characters')
    .regex(/^[A-Za-z0-9_.-]+$/, 'letters, digits, dot, dash, underscore only'),
  bpf: z.string().min(1, 'enter a BPF expression').max(4096),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'use a #rrggbb colour'),
  highlightDuration: z.number().int().min(100).max(60_000),
  direction: z.enum(['tx', 'rx']).nullable(),
});

interface MarkerDraft {
  name: string;
  bpf: string;
  color: string;
  highlightDuration: string;
  direction: 'both' | 'tx' | 'rx';
}

const EMPTY_DRAFT: MarkerDraft = {
  name: '',
  bpf: 'icmp',
  color: '#c98a52',
  highlightDuration: '1000',
  direction: 'both',
};

function countHits(rows: Record<string, unknown>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const parsed = MarkerHit.safeParse(row);
    if (!parsed.success) continue;
    counts.set(parsed.data.markerId, (counts.get(parsed.data.markerId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Per-link packet markers: BPF definitions, live hit counters, pause/resume,
 * and deletion. Hit counts combine short polling with live SSE events.
 */
export function LinkMarkersPanel({
  linkId,
  events,
  onMarkersChanged,
}: {
  linkId: string;
  events: EventEnvelope[];
  onMarkersChanged: () => void;
}) {
  const { can } = useMe();
  const canWrite = can('link.write');
  const [draft, setDraft] = useState<MarkerDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MarkerRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [liveHits, setLiveHits] = useState<Map<string, number>>(new Map());
  const lastPollAt = useRef(0);
  const polledAt = useRef(0);

  const markers = useQuery({
    ...orpc.links.markers.list.queryOptions({ input: { linkId } }),
    refetchInterval: 15_000,
  });
  const hits = useQuery({
    ...orpc.links.markers.hits.queryOptions({ input: { linkId } }),
    refetchInterval: 2500,
  });

  useEffect(() => {
    if (hits.dataUpdatedAt === polledAt.current) return;
    polledAt.current = hits.dataUpdatedAt;
    lastPollAt.current = Date.now();
    setLiveHits(new Map());
  }, [hits.dataUpdatedAt]);

  useEffect(() => {
    const additions = new Map<string, number>();
    for (const event of events) {
      if (event.type !== 'marker.hit') continue;
      if (event.payload.linkId !== linkId) continue;
      const hit = MarkerHit.safeParse(event.payload);
      if (!hit.success) continue;
      const at = Date.parse(hit.data.ts);
      if (Number.isFinite(at) && at <= lastPollAt.current) continue;
      additions.set(hit.data.markerId, (additions.get(hit.data.markerId) ?? 0) + 1);
    }
    if (additions.size === 0) return;
    setLiveHits((current) => {
      const next = new Map(current);
      for (const [id, count] of additions) next.set(id, (next.get(id) ?? 0) + count);
      return next;
    });
  }, [events, linkId]);

  const counts = countHits(hits.data ?? []);

  function invalidateMarkers() {
    void queryClient.invalidateQueries({ queryKey: orpc.links.markers.list.key() });
    onMarkersChanged();
  }

  async function createMarker() {
    const parsed = markerSchema.safeParse({
      name: draft.name.trim(),
      bpf: draft.bpf.trim(),
      color: draft.color,
      highlightDuration: Number(draft.highlightDuration),
      direction: draft.direction === 'both' ? null : draft.direction,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'The marker fields are invalid.');
      return;
    }
    setBusy('create');
    setError(null);
    setNotice(null);
    try {
      await client.links.markers.create({ linkId, ...parsed.data });
      setDraft(EMPTY_DRAFT);
      setNotice('Marker created.');
      invalidateMarkers();
      void queryClient.invalidateQueries({ queryKey: orpc.links.markers.hits.key() });
    } catch (createError) {
      setError(messageOf(createError));
    } finally {
      setBusy(null);
    }
  }

  async function togglePaused(marker: MarkerRow) {
    setBusy(`pause:${marker.id}`);
    setError(null);
    setNotice(null);
    try {
      await client.links.markers.update({ id: marker.id, paused: !marker.paused });
      setNotice(marker.paused ? `${marker.name} resumed.` : `${marker.name} paused.`);
      invalidateMarkers();
    } catch (pauseError) {
      setError(messageOf(pauseError));
    } finally {
      setBusy(null);
    }
  }

  async function performDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await client.links.markers.delete({ id: deleteTarget.id });
      setDeleteTarget(null);
      setNotice('Marker deleted.');
      invalidateMarkers();
    } catch (deleteFailure) {
      setDeleteError(deleteFailure);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="rounded-[3px] border p-2"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="nb-rule-label">Packet markers</span>
        <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
          hits from the last 200 · live SSE
        </span>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {markers.isPending ? (
        <Loading label="Reading markers…" />
      ) : markers.isError ? (
        <Notice tone="error">{messageOf(markers.error)}</Notice>
      ) : markers.data.length === 0 ? (
        <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
          No markers on this link. A marker counts frames matching a BPF expression.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {markers.data.map((marker) => {
            const hitCount = (counts.get(marker.id) ?? 0) + (liveHits.get(marker.id) ?? 0);
            return (
              <li
                key={marker.id}
                className="flex flex-wrap items-center gap-1.5 rounded-[2px] border px-1.5 py-1"
                style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
              >
                <span
                  aria-hidden
                  className="inline-block size-[9px] shrink-0 rounded-full"
                  style={{ background: marker.color, boxShadow: `0 0 4px ${marker.color}` }}
                />
                <span className="text-[12px] font-medium">{marker.name}</span>
                <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                  tag {marker.tag} · {marker.bpf} · {marker.direction ?? 'both'} ·{' '}
                  {marker.highlightDuration} ms
                </span>
                {marker.paused ? <Badge tone="warn">paused</Badge> : null}
                {!marker.enabled ? <Badge tone="neutral">disabled</Badge> : null}
                <span
                  className="tabular ml-auto text-[12px]"
                  style={{ color: hitCount > 0 ? marker.color : 'var(--color-ink-faint)' }}
                  title="Recent hits"
                >
                  {hitCount}
                </span>
                {canWrite ? (
                  <span className="flex items-center gap-0.5">
                    <button
                      type="button"
                      className="nb-button"
                      data-size="sm"
                      data-variant="ghost"
                      disabled={busy !== null}
                      title={marker.paused ? 'Resume marker' : 'Pause marker'}
                      aria-label={marker.paused ? `Resume ${marker.name}` : `Pause ${marker.name}`}
                      onClick={() => void togglePaused(marker)}
                    >
                      {marker.paused ? (
                        <Play size={11} aria-hidden />
                      ) : (
                        <Pause size={11} aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      className="nb-button"
                      data-size="sm"
                      data-variant="ghost"
                      title="Delete marker"
                      aria-label={`Delete ${marker.name}`}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(marker);
                      }}
                    >
                      <Trash2 size={11} aria-hidden />
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canWrite ? (
        <div
          className="mt-2 grid grid-cols-2 gap-2 border-t pt-2"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          <Field label="Name" htmlFor="marker-name">
            <Input
              id="marker-name"
              className="py-1 text-[11px]"
              placeholder="icmp"
              value={draft.name}
              onChange={(event) => {
                setDraft((current) => ({ ...current, name: event.target.value }));
                setError(null);
              }}
            />
          </Field>
          <Field label="BPF" htmlFor="marker-bpf" hint="e.g. icmp or tcp port 80">
            <Input
              id="marker-bpf"
              className="tabular py-1 text-[11px]"
              value={draft.bpf}
              onChange={(event) => {
                setDraft((current) => ({ ...current, bpf: event.target.value }));
                setError(null);
              }}
            />
          </Field>
          <Field label="Colour" htmlFor="marker-color">
            <input
              id="marker-color"
              type="color"
              className="nb-field h-8 w-16 p-0.5"
              value={draft.color}
              onChange={(event) =>
                setDraft((current) => ({ ...current, color: event.target.value }))
              }
            />
          </Field>
          <Field label="Highlight (ms)" htmlFor="marker-duration">
            <Input
              id="marker-duration"
              inputMode="numeric"
              className="py-1 text-[11px]"
              value={draft.highlightDuration}
              onChange={(event) =>
                setDraft((current) => ({ ...current, highlightDuration: event.target.value }))
              }
            />
          </Field>
          <Field label="Direction" htmlFor="marker-direction">
            <Select
              id="marker-direction"
              className="py-1 text-[11px]"
              value={draft.direction}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  direction: event.target.value as MarkerDraft['direction'],
                }))
              }
            >
              <option value="both">Both</option>
              <option value="tx">Tx</option>
              <option value="rx">Rx</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <button
              type="button"
              className="nb-button"
              data-size="sm"
              data-variant="primary"
              disabled={busy !== null}
              onClick={() => void createMarker()}
            >
              <Plus size={12} aria-hidden /> {busy === 'create' ? 'Creating…' : 'Add marker'}
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title={`Delete ${deleteTarget?.name ?? 'marker'}?`}
        description="The marker program and its pcap file are removed from the link."
        confirmLabel="Delete marker"
        pending={deleting}
        error={deleteError}
        onConfirm={() => void performDelete()}
      />
    </div>
  );
}

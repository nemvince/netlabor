import type { EventEnvelope, LinkFilters } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { DownloadSimpleIcon as Download, MapPinIcon as MapPin, PaletteIcon as Palette, PauseIcon as Pause, PlayIcon as Play, BroadcastIcon as Radio, ArrowCounterClockwiseIcon as RotateCcw, SlidersHorizontalIcon as SlidersHorizontal, SquareIcon as Square, WavesIcon as Waves   } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Badge } from '../../components/badge.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { Field, Input, Textarea } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading } from '../../components/page.tsx';
import { TabBar, type TabItem } from '../../components/tab-bar.tsx';
import { client, orpc } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { messageOf } from '../../lib/errors.ts';
import { queryClient } from '../../lib/query-client.ts';
import { LinkMarkersPanel } from './link-markers-panel.tsx';
import { Button } from '@netlabor/ui/components/button';

interface FilterDraft {
  delayMs: string;
  jitterMs: string;
  lossPct: string;
  corruptPct: string;
  frequencyDrop: string;
  rateKbps: string;
  bpf: string;
}

const LINK_COLORS = [
  { name: 'Copper', value: '#ef9a45' },
  { name: 'Blue', value: '#5fb0f2' },
  { name: 'Green', value: '#5fd98a' },
  { name: 'Amber', value: '#f2c94c' },
  { name: 'Red', value: '#f2705f' },
  { name: 'Violet', value: '#c98ade' },
  { name: 'Teal', value: '#4ec9c4' },
  { name: 'Neutral', value: '#ccd3d8' },
];

type LinkTab = 'filters' | 'capture' | 'markers' | 'appearance';

const LINK_TABS: TabItem<LinkTab>[] = [
  { id: 'filters', label: 'Filters', icon: SlidersHorizontal },
  { id: 'capture', label: 'Capture', icon: Radio },
  { id: 'markers', label: 'Markers', icon: MapPin },
  { id: 'appearance', label: 'Appearance', icon: Palette },
];

const EMPTY_DRAFT: FilterDraft = {
  delayMs: '',
  jitterMs: '',
  lossPct: '',
  corruptPct: '',
  frequencyDrop: '',
  rateKbps: '',
  bpf: '',
};

const shortcutNote =
  'shortcut: this relay link forwards through ubridge, so the bandwidth cap is ignored — delay, loss, corrupt, and BPF still apply. Upgrade when ubridge grows a rate filter.';

function draftFrom(filters: LinkFilters): FilterDraft {
  return {
    delayMs: filters.delayMs === undefined ? '' : String(filters.delayMs),
    jitterMs: filters.jitterMs === undefined ? '' : String(filters.jitterMs),
    lossPct: filters.lossPct === undefined ? '' : String(filters.lossPct),
    corruptPct: filters.corruptPct === undefined ? '' : String(filters.corruptPct),
    frequencyDrop: filters.frequencyDrop === undefined ? '' : String(filters.frequencyDrop),
    rateKbps: filters.rateKbps === undefined ? '' : String(filters.rateKbps),
    bpf: filters.bpf ?? '',
  };
}

function optionalInt(value: string, label: string, min: number, max: number): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function parseDraft(draft: FilterDraft): { filters: LinkFilters } | { error: string } {
  try {
    const filters: LinkFilters = {};
    const delay = optionalInt(draft.delayMs, 'Delay', 0, 32767);
    if (delay !== undefined) filters.delayMs = delay;
    const jitter = optionalInt(draft.jitterMs, 'Jitter', 0, 32767);
    if (jitter !== undefined) filters.jitterMs = jitter;
    const loss = optionalInt(draft.lossPct, 'Loss', 0, 100);
    if (loss !== undefined) filters.lossPct = loss;
    const corrupt = optionalInt(draft.corruptPct, 'Corrupt', 0, 100);
    if (corrupt !== undefined) filters.corruptPct = corrupt;
    const frequency = optionalInt(draft.frequencyDrop, 'Frequency drop', -1, 32767);
    if (frequency !== undefined) filters.frequencyDrop = frequency;
    const rate = optionalInt(draft.rateKbps, 'Bandwidth', 1, 10_000_000);
    if (rate !== undefined) filters.rateKbps = rate;
    if (draft.bpf.trim() !== '') filters.bpf = draft.bpf.trim();
    return { filters };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/** Link impairment filters, pcap capture, markers, and Wireshark entry. */
export function LinkDialog({
  linkId,
  events = [],
  onClose,
  onOpenWireshark,
  onMarkersChanged,
}: {
  linkId: string;
  events?: EventEnvelope[];
  onClose: () => void;
  onOpenWireshark: (linkId: string, title: string) => void;
  onMarkersChanged?: () => void;
}) {
  const link = useQuery(orpc.links.get.queryOptions({ input: { id: linkId } }));
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_DRAFT);
  const [styleColor, setStyleColor] = useState('');
  const [styleLabel, setStyleLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<LinkTab>('filters');

  useEffect(() => {
    if (!link.data) return;
    setDraft(draftFrom(link.data.filters));
    setStyleColor(link.data.style.color ?? '');
    setStyleLabel(link.data.style.label ?? '');
  }, [link.data]);

  const linkData = link.data;

  function update<K extends keyof FilterDraft>(key: K, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setNotice(null);
  }

  function invalidateLink() {
    void queryClient.invalidateQueries({ queryKey: orpc.links.list.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.links.get.key() });
    void link.refetch();
  }

  async function saveAppearance() {
    if (!linkData) return;
    setBusy('style');
    setError(null);
    setNotice(null);
    try {
      await client.links.update({
        id: linkData.id,
        style: {
          ...linkData.style,
          color: styleColor === '' ? undefined : styleColor,
          label: styleLabel.trim() === '' ? undefined : styleLabel.trim(),
        },
      });
      setNotice('Link appearance saved.');
      invalidateLink();
    } catch (styleError) {
      setError(messageOf(styleError));
    } finally {
      setBusy(null);
    }
  }

  async function saveFilters() {
    if (!linkData) return;
    const parsed = parseDraft(draft);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setBusy('filters');
    setError(null);
    setNotice(null);
    try {
      await client.links.filters.set({ linkId: linkData.id, filters: parsed.filters });
      setNotice('Filters applied.');
      invalidateLink();
    } catch (saveError) {
      setError(messageOf(saveError));
    } finally {
      setBusy(null);
    }
  }

  async function clearFilters() {
    if (!linkData) return;
    setBusy('filters');
    setError(null);
    setNotice(null);
    try {
      await client.links.filters.clear({ linkId: linkData.id });
      setDraft(EMPTY_DRAFT);
      setNotice('Filters cleared.');
      invalidateLink();
    } catch (clearError) {
      setError(messageOf(clearError));
    } finally {
      setBusy(null);
    }
  }

  async function capture(action: 'start' | 'stop') {
    if (!linkData) return;
    setBusy('capture');
    setError(null);
    setNotice(null);
    try {
      if (action === 'start') await client.links.capture.start({ linkId: linkData.id });
      else await client.links.capture.stop({ linkId: linkData.id });
      invalidateLink();
      if (action === 'start') {
        onOpenWireshark(linkData.id, `Wireshark ${linkData.nodeAName} ↔ ${linkData.nodeBName}`);
        onClose();
        return;
      }
      setNotice('Capture stopped.');
    } catch (captureError) {
      setError(messageOf(captureError));
    } finally {
      setBusy(null);
    }
  }

  async function resetDataplane() {
    if (!linkData) return;
    setBusy('reset');
    setError(null);
    setNotice(null);
    try {
      await client.links.reset({ id: linkData.id });
      setNotice('Link dataplane recreated.');
      invalidateLink();
    } catch (resetError) {
      setError(messageOf(resetError));
    } finally {
      setBusy(null);
    }
  }

  async function toggleSuspend() {
    if (!linkData) return;
    setBusy('suspend');
    setError(null);
    setNotice(null);
    try {
      await client.links.update({ id: linkData.id, suspend: !linkData.suspend });
      setNotice(linkData.suspend ? 'Link resumed.' : 'Link suspended.');
      invalidateLink();
    } catch (suspendError) {
      setError(messageOf(suspendError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={linkData ? `Link ${linkData.nodeAName} ↔ ${linkData.nodeBName}` : 'Link'}
      description="Impairment applies to the link dataplane. Capture writes a pcap on the capture side."
      width={640}
    >
      {link.isPending ? (
        <Loading label="Reading link…" />
      ) : link.isError ? (
        <Notice tone="error">{messageOf(link.error)}</Notice>
      ) : linkData ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1">
            <Badge
              tone={
                linkData.status === 'active'
                  ? 'up'
                  : linkData.status === 'error'
                    ? 'down'
                    : linkData.status === 'suspended'
                      ? 'warn'
                      : 'neutral'
              }
            >
              {linkData.status}
            </Badge>
            <Badge tone="copper">{linkData.linkType}</Badge>
            <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
              {linkData.nodeAName}:{linkData.adapterA}/{linkData.portA} ↔ {linkData.nodeBName}:
              {linkData.adapterB}/{linkData.portB} · {linkData.dataplane?.mode ?? 'inactive'}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Button type="button" disabled={busy !== null || linkData.status === 'pending'} onClick={() => void resetDataplane()} variant="outline" size="xs">
                <RotateCcw size={12} aria-hidden /> {busy === 'reset' ? 'Resetting…' : 'Reset'}
              </Button>
              <Button type="button" disabled={busy !== null || linkData.status === 'pending'} onClick={() => void toggleSuspend()} variant="outline" size="xs">
                {linkData.suspend ? (
                  <>
                    <Play size={12} aria-hidden /> Resume link
                  </>
                ) : (
                  <>
                    <Pause size={12} aria-hidden /> Suspend link
                  </>
                )}
              </Button>
            </div>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {notice ? <Notice tone="success">{notice}</Notice> : null}

          <TabBar label="Link settings" value={tab} items={LINK_TABS} onChange={setTab} />

          {tab === 'appearance' ? (
            <div
              className="rounded-[3px] border p-2"
              style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="nb-rule-label">Appearance</span>
                <Button type="button" disabled={busy !== null} onClick={() => void saveAppearance()} variant="outline" size="xs">
                  {busy === 'style' ? 'Saving…' : 'Save appearance'}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" title="Default status colour" aria-label="Use default link colour" onClick={() => setStyleColor('')} variant="outline" size="xs">
                  Auto
                </Button>
                {LINK_COLORS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    aria-label={`Use ${preset.name} for this link`}
                    title={preset.name}
                    onClick={() => setStyleColor(preset.value)}
                    style={{
                      width: 22,
                      height: 22,
                      padding: 0,
                      borderRadius: 2,
                      border:
                        styleColor === preset.value
                          ? '2px solid var(--color-ink)'
                          : '1px solid var(--color-rule-strong)',
                      background: preset.value,
                    }}
                  />
                ))}
                <input
                  type="color"
                  aria-label="Custom link colour"
                  value={styleColor === '' ? '#ef9a45' : styleColor}
                  onChange={(event) => setStyleColor(event.target.value)}
                  style={{ width: 26, height: 22, padding: 0, background: 'transparent' }}
                />
                <div className="min-w-40 flex-1">
                  <Input
                    aria-label="Link label"
                    className="py-1 text-[11px]"
                    placeholder="Label on the canvas"
                    maxLength={64}
                    value={styleLabel}
                    onChange={(event) => setStyleLabel(event.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'filters' ? (
            <div
              className="rounded-[3px] border p-2"
              style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span
                  className="nb-rule-label"
                  title="Empty fields clear that impairment on apply."
                >
                  Traffic filters
                </span>
                <div className="flex gap-1">
                  <Button type="button" disabled={busy !== null} onClick={() => void clearFilters()} variant="outline" size="xs">
                    Clear
                  </Button>
                  <Button type="button" disabled={busy !== null} onClick={() => void saveFilters()} variant="default" size="xs">
                    {busy === 'filters' ? 'Applying…' : 'Apply'}
                  </Button>
                </div>
              </div>
              {linkData.dataplane?.mode === 'relay' ? (
                <p className="mb-1.5 text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                  {shortcutNote}
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Field label="Delay (ms)" htmlFor="link-delay">
                  <Input
                    id="link-delay"
                    inputMode="numeric"
                    placeholder="0"
                    value={draft.delayMs}
                    onChange={(event) => update('delayMs', event.target.value)}
                  />
                </Field>
                <Field label="Jitter (ms)" htmlFor="link-jitter">
                  <Input
                    id="link-jitter"
                    inputMode="numeric"
                    placeholder="0"
                    value={draft.jitterMs}
                    onChange={(event) => update('jitterMs', event.target.value)}
                  />
                </Field>
                <Field label="Loss (%)" htmlFor="link-loss">
                  <Input
                    id="link-loss"
                    inputMode="decimal"
                    placeholder="0"
                    value={draft.lossPct}
                    onChange={(event) => update('lossPct', event.target.value)}
                  />
                </Field>
                <Field label="Corrupt (%)" htmlFor="link-corrupt">
                  <Input
                    id="link-corrupt"
                    inputMode="decimal"
                    placeholder="0"
                    value={draft.corruptPct}
                    onChange={(event) => update('corruptPct', event.target.value)}
                  />
                </Field>
                <Field label="Frequency drop" htmlFor="link-frequency" hint="-1 drops every packet">
                  <Input
                    id="link-frequency"
                    inputMode="numeric"
                    placeholder="0"
                    value={draft.frequencyDrop}
                    onChange={(event) => update('frequencyDrop', event.target.value)}
                  />
                </Field>
                <Field label="Bandwidth (kbit/s)" htmlFor="link-rate" hint="Kernel dataplane only">
                  <Input
                    id="link-rate"
                    inputMode="numeric"
                    placeholder="unlimited"
                    value={draft.rateKbps}
                    onChange={(event) => update('rateKbps', event.target.value)}
                  />
                </Field>
              </div>
              <div className="mt-2">
                <Field
                  label="BPF filter"
                  htmlFor="link-bpf"
                  hint="Validated by tcpdump on the compute."
                >
                  <Textarea
                    id="link-bpf"
                    rows={2}
                    className="tabular text-[11px]"
                    placeholder="icmp or tcp port 80"
                    value={draft.bpf}
                    onChange={(event) => update('bpf', event.target.value)}
                  />
                </Field>
              </div>
            </div>
          ) : null}

          {tab === 'capture' ? (
            <div
              className="rounded-[3px] border p-2"
              style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
            >
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="nb-rule-label">Capture</span>
                {linkData.capture ? (
                  <Badge tone={linkData.capture.active ? 'down' : 'neutral'}>
                    {linkData.capture.active ? 'active' : 'stopped'} ·{' '}
                    {formatBytes(linkData.capture.sizeBytes)} · {linkData.capture.dlt}
                  </Badge>
                ) : (
                  <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                    no capture
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                <Button type="button" disabled={busy !== null} onClick={() => void capture('start')} variant="default" size="xs">
                  <Radio size={12} aria-hidden /> Start capture
                </Button>
                <Button type="button" disabled={busy !== null || !linkData.capture} onClick={() => void capture('stop')} variant="outline" size="xs">
                  <Square size={12} aria-hidden /> Stop capture
                </Button>
                {linkData.capture ? (
                  <>
                    <Button
                      variant="outline"
                      size="xs"
                      render={<a href={`/api/links/${linkData.id}/capture.pcap`} download />}
                      aria-disabled={linkData.capture.sizeBytes === 0}
                      style={{
                        opacity: linkData.capture.sizeBytes === 0 ? 0.5 : 1,
                      }}
                    >
                      <Download size={12} aria-hidden /> Download pcap
                    </Button>
                    <Button type="button" onClick={() => { onOpenWireshark( linkData.id, `Wireshark ${linkData.nodeAName} ↔ ${linkData.nodeBName}`, ); onClose(); }} variant="outline" size="xs">
                      <Waves size={12} aria-hidden /> Open Wireshark
                    </Button>
                  </>
                ) : null}
              </div>
              {linkData.capture ? (
                <p
                  className="tabular mt-1 text-[10px] break-all"
                  style={{ color: 'var(--color-ink-faint)' }}
                >
                  {linkData.capture.path}
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === 'markers' ? (
            <LinkMarkersPanel
              linkId={linkData.id}
              events={events}
              onMarkersChanged={() => onMarkersChanged?.()}
            />
          ) : null}

          <DialogFooter>
            <Button type="button" onClick={onClose} variant="outline" size="sm">
              Close
            </Button>
          </DialogFooter>
        </div>
      ) : null}
    </Dialog>
  );
}

import type { PacketAnalyzeOutput, PacketFieldRow, PacketFrame } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { LoaderCircle, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '../../components/Badge.tsx';
import { Field, Input } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { client, orpc } from '../../lib/api.ts';
import { appCodeOf, messageOf } from '../../lib/errors.ts';

const MAX_FIELDS = 31;
const DEFAULT_LIMIT = 200;

interface AnalysisError {
  code: string | undefined;
  message: string;
}

const SUMMARY_PROTOCOLS = 8;

function lengthOf(frame: PacketFrame): string {
  const raw = frame.fields['frame.len'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}

function extraFieldRows(
  frames: PacketFrame[],
  fields: string[],
): { key: string; values: string[] }[] {
  return fields.map((key) => ({
    key,
    values: frames.map((frame) => {
      const raw = frame.fields[key];
      const value = Array.isArray(raw) ? raw.join(', ') : raw;
      return value === undefined || value === null ? '' : String(value);
    }),
  }));
}

function parseLimit(text: string): number | null {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > 2000) return null;
  return value;
}

function analysisNotice(error: AnalysisError): { tone: 'warn' | 'error'; body: string } {
  if (error.code === 'CAPABILITY_UNSUPPORTED') {
    return {
      tone: 'warn',
      body: `Packet analysis is unavailable on this compute: ${error.message}. Install tshark on the compute that owns the capture.`,
    };
  }
  if (error.code === 'BAD_REQUEST') {
    return {
      tone: 'error',
      body: `${error.message}. Check the display filter and the selected extra fields.`,
    };
  }
  if (error.code === 'NOT_FOUND') {
    return {
      tone: 'warn',
      body: `${error.message}. Start a capture and generate traffic, then apply again.`,
    };
  }
  return { tone: 'error', body: error.message };
}

/**
 * tshark-backed view of the same capture: structured frame rows, protocol
 * counts, and an extra-field picker backed by the tshark field registry.
 */
export function PacketAnalysisPanel({ linkId, filter }: { linkId: string; filter: string }) {
  const [result, setResult] = useState<PacketAnalyzeOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AnalysisError | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [limitText, setLimitText] = useState(String(DEFAULT_LIMIT));
  const [fieldQuery, setFieldQuery] = useState('');
  const [fieldOpen, setFieldOpen] = useState(false);

  const [appliedFilter, setAppliedFilter] = useState(filter.trim());
  const [runNonce, setRunNonce] = useState(0);
  const requestRef = useRef(0);
  const fieldsRef = useRef<string[]>(fields);
  const limitRef = useRef(DEFAULT_LIMIT);

  fieldsRef.current = fields;
  limitRef.current = parseLimit(limitText) ?? limitRef.current;

  // Debounce the shared display filter so typing does not spawn a tshark run per key.
  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedFilter(filter.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [filter]);

  const analyze = useCallback(async () => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    setLoading(true);
    setError(null);
    const requestedFields = [...new Set([...fieldsRef.current, 'frame.len'])];
    try {
      const data = await client.packet.analyze({
        linkId,
        limit: limitRef.current,
        ...(appliedFilter === '' ? {} : { displayFilter: appliedFilter }),
        ...(requestedFields.length === 0 ? {} : { fields: requestedFields }),
      });
      if (request !== requestRef.current) return;
      setResult(data);
    } catch (cause) {
      if (request !== requestRef.current) return;
      setResult(null);
      setError({ code: appCodeOf(cause), message: messageOf(cause) });
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [appliedFilter, linkId]);

  useEffect(() => {
    void runNonce;
    void analyze();
  }, [analyze, runNonce]);

  const fieldSuggestions = useQuery({
    ...orpc.packet.fields.queryOptions({ input: { query: fieldQuery.trim() } }),
    enabled: fieldOpen,
    staleTime: 300_000,
    retry: false,
  });

  const limitValue = parseLimit(limitText);
  const extraFields = fields.filter((name) => name !== 'frame.len');

  function addField(name: string) {
    if (fields.includes(name) || name === 'frame.len') {
      setFieldQuery('');
      setFieldOpen(false);
      return;
    }
    if (fields.length >= MAX_FIELDS) return;
    setFields((current) => [...current, name]);
    setFieldQuery('');
    setFieldOpen(false);
  }

  function removeField(name: string) {
    setFields((current) => current.filter((entry) => entry !== name));
  }

  const notice = error ? analysisNotice(error) : null;
  const protocols = result
    ? Object.entries(result.protocols).sort((left, right) => right[1] - left[1])
    : [];
  const columnTemplate = [
    '56px',
    '104px',
    'minmax(120px, 0.9fr)',
    'minmax(120px, 0.9fr)',
    '84px',
    '62px',
    'minmax(240px, 2.2fr)',
    ...extraFields.map(() => 'minmax(110px, 1fr)'),
  ].join(' ');
  const extras = result ? extraFieldRows(result.frames, extraFields) : [];

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      style={{ background: 'var(--color-panel)' }}
      aria-label="Packet analysis"
    >
      <div
        className="flex shrink-0 flex-wrap items-end gap-2 border-b px-2 py-1.5"
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <div className="flex w-[260px] flex-col gap-1">
          <label
            className="nb-rule-label"
            htmlFor={`analyze-field-${linkId}`}
            style={{ fontSize: 10 }}
          >
            Extra fields
          </label>
          <div className="relative">
            {fields.length > 0 ? (
              <div className="mb-1 flex flex-wrap gap-1">
                {fields.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-px text-[10px]"
                    style={{ borderColor: 'var(--color-rule)', color: 'var(--color-ink-dim)' }}
                  >
                    <span className="tabular">{name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${name}`}
                      title={`Remove ${name}`}
                      onClick={() => removeField(name)}
                    >
                      <X size={10} aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <Input
              id={`analyze-field-${linkId}`}
              className="h-6 py-0 text-[11px]"
              placeholder={
                fields.length >= MAX_FIELDS ? 'field limit reached' : 'Add field, e.g. tcp.flags'
              }
              spellCheck={false}
              autoComplete="off"
              disabled={fields.length >= MAX_FIELDS}
              value={fieldQuery}
              onFocus={() => setFieldOpen(true)}
              onChange={(event) => {
                setFieldQuery(event.target.value);
                setFieldOpen(true);
              }}
              onBlur={() => {
                window.setTimeout(() => setFieldOpen(false), 150);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const first = fieldSuggestions.data?.[0];
                  if (first) addField(first.name);
                }
                if (event.key === 'Escape') setFieldOpen(false);
              }}
            />
            {fieldOpen ? (
              <ul
                className="absolute top-full left-0 z-20 mt-1 max-h-[240px] w-[320px] overflow-auto rounded-[3px] border py-1 shadow-lg"
                style={{
                  borderColor: 'var(--color-rule-strong)',
                  background: 'var(--color-panel-raised)',
                }}
                aria-label="Matching tshark fields"
              >
                {fieldSuggestions.isPending ? (
                  <li className="px-2 py-1 text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                    searching fields…
                  </li>
                ) : fieldSuggestions.isError ? (
                  <li
                    className="px-2 py-1 text-[10px]"
                    style={{ color: 'var(--color-signal-down)' }}
                  >
                    {messageOf(fieldSuggestions.error)}
                  </li>
                ) : (fieldSuggestions.data ?? []).length === 0 ? (
                  <li className="px-2 py-1 text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                    No fields match {fieldQuery.trim() || 'the query'}.
                  </li>
                ) : (
                  (fieldSuggestions.data ?? []).map((field: PacketFieldRow) => (
                    <li key={field.name}>
                      <button
                        type="button"
                        className="flex w-full flex-col items-start px-2 py-1 text-left hover:bg-white/[0.04]"
                        onClick={() => addField(field.name)}
                      >
                        <span className="tabular text-[11px]">{field.name}</span>
                        <span
                          className="truncate text-[10px]"
                          style={{ color: 'var(--color-ink-faint)' }}
                        >
                          {field.label} · {field.type}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        </div>

        <Field label="Limit" htmlFor={`analyze-limit-${linkId}`}>
          <Input
            id={`analyze-limit-${linkId}`}
            className="tabular h-6 w-[84px] py-0 text-[11px]"
            type="number"
            min={1}
            max={2000}
            step={1}
            value={limitText}
            onChange={(event) => setLimitText(event.target.value)}
          />
        </Field>

        <div className="flex items-center gap-2 pb-1">
          <button
            type="button"
            className="nb-button"
            data-size="sm"
            data-variant="primary"
            disabled={loading || limitValue === null}
            onClick={() => {
              setAppliedFilter(filter.trim());
              setRunNonce((value) => value + 1);
            }}
          >
            {loading ? (
              <LoaderCircle size={12} className="animate-spin" aria-hidden />
            ) : (
              <RotateCw size={12} aria-hidden />
            )}
            Apply
          </button>
          {limitValue === null ? (
            <span className="text-[10px]" style={{ color: 'var(--color-signal-down)' }}>
              use 1–2000
            </span>
          ) : null}
        </div>

        <div
          className="ml-auto flex flex-wrap items-center gap-2 pb-1 text-[10px]"
          style={{ color: 'var(--color-ink-faint)' }}
          role="status"
        >
          <span className="tabular">filter: {appliedFilter === '' ? 'none' : appliedFilter}</span>
          {result ? (
            <>
              <span className="tabular">{result.total} frames</span>
              {result.truncated ? <Badge tone="warn">limit reached</Badge> : null}
            </>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className="shrink-0 px-2 pt-1">
          <Notice tone={notice.tone}>{notice.body}</Notice>
        </div>
      ) : null}

      {protocols.length > 0 ? (
        <div
          className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          <span className="nb-rule-label">Protocols</span>
          {protocols.slice(0, SUMMARY_PROTOCOLS).map(([protocol, count]) => (
            <Badge key={protocol} tone="neutral">
              {protocol}: {count}
            </Badge>
          ))}
          {protocols.length > SUMMARY_PROTOCOLS ? (
            <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
              +{protocols.length - SUMMARY_PROTOCOLS} more
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <div
          className="sticky top-0 z-10 grid min-w-[760px] border-b"
          style={{
            gridTemplateColumns: columnTemplate,
            borderColor: 'var(--color-rule)',
            background: 'var(--color-panel)',
          }}
        >
          {[
            'Frame',
            'Time (s)',
            'Source',
            'Destination',
            'Protocol',
            'Length',
            'Info',
            ...extraFields,
          ].map((column) => (
            <span key={column} className="nb-rule-label truncate px-2 py-1">
              {column}
            </span>
          ))}
        </div>
        {loading && !result ? (
          <div
            className="flex items-center gap-2 px-2 py-4 text-[11px]"
            style={{ color: 'var(--color-ink-faint)' }}
            role="status"
          >
            <LoaderCircle size={12} className="animate-spin" aria-hidden />
            Running tshark on the capture…
          </div>
        ) : result && result.frames.length === 0 ? (
          <div
            className="flex min-h-24 items-center justify-center px-4 py-6 text-center text-[11px]"
            style={{ color: 'var(--color-ink-faint)' }}
          >
            {appliedFilter === ''
              ? 'No frames were analyzed in this capture. Start a capture and generate traffic, then apply again.'
              : `No packets match ${appliedFilter}. Clear the display filter or adjust it.`}
          </div>
        ) : result ? (
          <div className="min-w-[760px]">
            {result.frames.map((frame, index) => (
              <div
                key={frame.number}
                className="grid border-b text-[11px]"
                style={{
                  gridTemplateColumns: columnTemplate,
                  borderColor: 'color-mix(in oklab, var(--color-rule) 55%, transparent)',
                }}
              >
                <span className="tabular truncate px-2 leading-[21px]">{frame.number}</span>
                <span className="tabular truncate px-2 leading-[21px]">
                  {frame.timeRelative === null ? '' : frame.timeRelative.toFixed(6)}
                </span>
                <span className="tabular truncate px-2 leading-[21px]">{frame.source ?? ''}</span>
                <span className="tabular truncate px-2 leading-[21px]">
                  {frame.destination ?? ''}
                </span>
                <span className="truncate px-2 leading-[21px]">{frame.protocol ?? ''}</span>
                <span className="tabular truncate px-2 text-right leading-[21px]">
                  {lengthOf(frame)}
                </span>
                <span
                  className="truncate px-2 leading-[21px]"
                  style={{ color: 'var(--color-ink-dim)' }}
                >
                  {frame.info ?? ''}
                </span>
                {extras.map((extra) => (
                  <span key={extra.key} className="truncate px-2 leading-[21px]">
                    {extra.values[index] ?? ''}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

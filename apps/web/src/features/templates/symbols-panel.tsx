import type { SymbolRow } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { FileUp, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Badge } from '../../components/badge.tsx';
import { ConfirmDialog } from '../../components/confirm-dialog.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { Field, Input, Textarea } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading } from '../../components/page.tsx';
import { SearchInput } from '../../components/search-input.tsx';
import { SymbolGlyph } from '../../components/symbol-glyph.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { queryClient } from '../../lib/query-client.ts';

function UploadSymbolDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState('');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setSvg(await file.text());
      if (name.trim() === '') setName(file.name.replace(/\.svg$/i, ''));
    } catch (readError) {
      setError(messageOf(readError));
    }
  }

  async function upload() {
    if (name.trim() === '' || svg.trim() === '') {
      setError('Enter a name and SVG markup.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.symbols.upload({ name: name.trim(), svg });
      void queryClient.invalidateQueries({ queryKey: orpc.symbols.list.key() });
      onOpenChange(false);
    } catch (uploadError) {
      setError(messageOf(uploadError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      title="Upload symbol"
      description="SVG is sanitized server-side; scripts, external URLs, and event attributes are rejected."
      width={640}
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label="Name" htmlFor="symbol-name">
            <Input
              id="symbol-name"
              value={name}
              placeholder="core-router"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="flex items-end gap-1">
            <input
              ref={fileRef}
              type="file"
              accept=".svg,image/svg+xml"
              className="sr-only"
              onChange={(event) => void chooseFile(event.target.files?.[0])}
            />
            <button
              type="button"
              className="nb-button"
              data-size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <FileUp size={12} aria-hidden /> Choose SVG
            </button>
          </div>
        </div>
        <Field label="SVG markup" htmlFor="symbol-svg" hint="Maximum 512 KiB.">
          <Textarea
            id="symbol-svg"
            rows={12}
            className="tabular text-[11px]"
            spellCheck={false}
            value={svg}
            placeholder={'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">…</svg>'}
            onChange={(event) => setSvg(event.target.value)}
          />
        </Field>
        {svg.trim() !== '' ? (
          <div
            className="flex items-center gap-3 rounded-[3px] border px-2 py-1.5"
            style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
          >
            <span className="nb-rule-label">Preview</span>
            <SymbolGlyph svg={svg} className="size-8" />
          </div>
        ) : null}
        <DialogFooter>
          <button type="button" className="nb-button" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="nb-button"
            data-variant="primary"
            disabled={busy}
            onClick={() => void upload()}
          >
            {busy ? 'Uploading…' : 'Upload symbol'}
          </button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

/** Builtin and uploaded node symbols with sanitized previews. */
export function SymbolsPanel({ canWrite }: { canWrite: boolean }) {
  const [search, setSearch] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SymbolRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);

  const symbols = useQuery(orpc.symbols.list.queryOptions({ input: {} }));
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (symbols.data ?? []).filter(
      (symbol) =>
        needle === '' ||
        symbol.name.toLowerCase().includes(needle) ||
        symbol.id.toLowerCase().includes(needle),
    );
  }, [symbols.data, search]);

  async function performDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await client.symbols.delete({ id: deleteTarget.id });
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: orpc.symbols.list.key() });
    } catch (error) {
      setDeleteError(error);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="mt-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SearchInput
          id="symbol-search"
          label="Search symbols"
          placeholder="Search symbols"
          wrapperStyle={{ width: 224 }}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
          {filtered.length} of {symbols.data?.length ?? 0}
        </span>
        {canWrite ? (
          <button
            type="button"
            className="nb-button ml-auto"
            data-size="sm"
            data-variant="primary"
            onClick={() => setUploadOpen(true)}
          >
            <FileUp size={12} aria-hidden /> Upload symbol
          </button>
        ) : null}
      </div>

      {symbols.isPending ? (
        <Loading label="Reading symbols…" />
      ) : symbols.isError ? (
        <Notice tone="error">{messageOf(symbols.error)}</Notice>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {filtered.map((symbol) => (
            <li
              key={symbol.id}
              className="flex flex-col gap-2 rounded-[3px] border p-2"
              style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
            >
              <div className="flex items-start justify-between gap-1">
                <SymbolGlyph svg={symbol.svg} className="size-8" />
                <Badge tone={symbol.builtin ? 'neutral' : 'copper'}>
                  {symbol.builtin ? 'builtin' : 'uploaded'}
                </Badge>
              </div>
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium" title={symbol.name}>
                  {symbol.name}
                </div>
                {symbol.id !== symbol.name ? (
                  <div
                    className="tabular truncate text-[10px]"
                    style={{ color: 'var(--color-ink-faint)' }}
                    title={symbol.id}
                  >
                    {symbol.id}
                  </div>
                ) : null}
              </div>
              <div className="mt-auto flex items-center justify-between">
                <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                  {symbol.theme ?? 'any theme'}
                </span>
                {canWrite && !symbol.builtin ? (
                  <button
                    type="button"
                    className="nb-button"
                    data-size="sm"
                    data-variant="ghost"
                    title={`Delete ${symbol.name}`}
                    aria-label={`Delete ${symbol.name}`}
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteTarget(symbol);
                    }}
                  >
                    <Trash2 size={12} aria-hidden />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {uploadOpen ? <UploadSymbolDialog onOpenChange={setUploadOpen} /> : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title={`Delete ${deleteTarget?.name ?? 'symbol'}?`}
        description="Uploaded symbols are removed permanently. Builtin symbols cannot be deleted."
        confirmLabel="Delete symbol"
        pending={deleting}
        error={deleteError}
        onConfirm={() => void performDelete()}
      />
    </section>
  );
}

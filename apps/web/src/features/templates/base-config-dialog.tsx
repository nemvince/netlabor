import type { TemplateRow } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import {
  FilePlusIcon as FilePlus2,
  FloppyDiskIcon as Save,
  TrashIcon as Trash2,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../../components/confirm-dialog.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { Field, Input, Textarea } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading } from '../../components/page.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { queryClient } from '../../lib/query-client.ts';
import { Button } from '@netlabor/ui/components/button';

/** Base configuration editor: file list, plain text editor, and save feedback. */
export function BaseConfigDialog({
  template,
  onOpenChange,
}: {
  template: TemplateRow;
  onOpenChange: (open: boolean) => void;
}) {
  const [filename, setFilename] = useState('');
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const files = useQuery({
    ...orpc.templates.baseConfigs.list.queryOptions({
      input: { templateId: template.id },
    }),
  });

  const existing = (files.data ?? []).some((file) => file.filename === filename);
  const read = useQuery({
    ...orpc.templates.baseConfigs.read.queryOptions({
      input: { templateId: template.id, filename },
    }),
    enabled: existing,
  });

  useEffect(() => {
    if (files.data?.length && filename === '') setFilename(files.data[0]?.filename ?? '');
  }, [files.data, filename]);

  useEffect(() => {
    if (!read.data) return;
    setContent(read.data.content);
    setDirty(false);
  }, [read.data]);

  const jsonError =
    filename.endsWith('.json') && content.trim() !== '' && !isJson(content)
      ? 'This file has a .json name but the content is not valid JSON.'
      : null;

  function isJson(value: string): boolean {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }

  async function save() {
    if (filename.trim() === '') {
      setError('Enter a file name before saving.');
      return;
    }
    if (jsonError) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await client.templates.baseConfigs.write({
        templateId: template.id,
        filename: filename.trim(),
        content,
      });
      setContent(saved.content);
      setDirty(false);
      setNotice(`${saved.filename} saved.`);
      void queryClient.invalidateQueries({ queryKey: orpc.templates.baseConfigs.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.templates.baseConfigs.read.key() });
      void files.refetch();
      void read.refetch();
    } catch (saveError) {
      setError(messageOf(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await client.templates.baseConfigs.delete({
        templateId: template.id,
        filename,
      });
      setDeleteOpen(false);
      setNotice(`${filename} deleted.`);
      const remaining = (files.data ?? []).filter((file) => file.filename !== filename);
      setFilename(remaining[0]?.filename ?? '');
      setContent('');
      setDirty(false);
      void files.refetch();
    } catch (deleteError) {
      setError(messageOf(deleteError));
    } finally {
      setBusy(false);
    }
  }

  function startNew() {
    setFilename('');
    setContent('');
    setDirty(false);
    setError(null);
    setNotice(null);
  }

  const lineCount = content.split('\n').length;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      title={`Base configurations · ${template.name}`}
      description="Files written into new nodes created from this template."
      width={900}
    >
      <div className="grid min-h-[420px] grid-cols-[210px_1fr] gap-3">
        <div className="flex min-h-0 flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="nb-rule-label">Files</span>
            <Button
              type="button"
              onClick={startNew}
              title="New base configuration"
              variant="ghost"
              size="xs"
            >
              <FilePlus2 size={12} aria-hidden /> New
            </Button>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto rounded-[3px] border"
            style={{ borderColor: 'var(--color-rule)' }}
          >
            {files.isPending ? (
              <Loading label="Reading files…" />
            ) : files.isError ? (
              <div className="p-2">
                <Notice tone="error">{messageOf(files.error)}</Notice>
              </div>
            ) : (files.data ?? []).length === 0 ? (
              <p className="p-2 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                No base configurations yet.
              </p>
            ) : (
              <ul>
                {files.data?.map((file) => {
                  const active = file.filename === filename;
                  return (
                    <li key={file.filename}>
                      <button
                        type="button"
                        className="tabular block w-full truncate px-2 py-1.5 text-left text-[11px]"
                        style={{
                          background: active ? 'var(--color-panel-raised)' : 'transparent',
                          color: active ? 'var(--color-copper)' : 'var(--color-ink-dim)',
                          borderLeft: active
                            ? '2px solid var(--color-copper)'
                            : '2px solid transparent',
                        }}
                        onClick={() => {
                          setFilename(file.filename);
                          setError(null);
                          setNotice(null);
                        }}
                      >
                        {file.filename}
                        <span
                          className="block text-[10px]"
                          style={{ color: 'var(--color-ink-faint)' }}
                        >
                          {file.content.length} bytes
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {notice ? <Notice tone="success">{notice}</Notice> : null}
          <Field
            label="File name"
            htmlFor="base-config-filename"
            hint="Existing files load their content."
          >
            <Input
              id="base-config-filename"
              className="tabular text-[12px]"
              value={filename}
              placeholder="startup-config.cfg"
              onChange={(event) => {
                setFilename(event.target.value);
                setError(null);
                setNotice(null);
              }}
            />
          </Field>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between pb-1">
              <span className="nb-rule-label">
                {dirty ? 'unsaved changes' : existing ? 'loaded from controller' : 'new file'}
              </span>
              <span
                className="tabular text-[10px]"
                style={{ color: jsonError ? 'var(--color-signal-down)' : 'var(--color-ink-faint)' }}
              >
                {lineCount} lines · {content.length} bytes{jsonError ? ' · invalid JSON' : ''}
              </span>
            </div>
            <Textarea
              aria-label="Base configuration content"
              className="tabular min-h-0 flex-1 resize-none text-[11px] leading-[1.55]"
              spellCheck={false}
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                setDirty(true);
                setNotice(null);
              }}
            />
          </div>
          {jsonError ? <Notice tone="warn">{jsonError}</Notice> : null}
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
              Close
            </Button>
            <Button
              type="button"
              disabled={!existing || busy}
              onClick={() => setDeleteOpen(true)}
              variant="destructive"
              size="sm"
            >
              <Trash2 size={12} aria-hidden /> Delete
            </Button>
            <Button
              type="button"
              disabled={busy || jsonError !== null}
              onClick={() => void save()}
              variant="default"
              size="sm"
            >
              <Save size={12} aria-hidden /> {busy ? 'Saving…' : 'Save file'}
            </Button>
          </DialogFooter>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${filename}?`}
        description="New nodes from this template will no longer receive this file."
        confirmLabel="Delete file"
        pending={busy}
        onConfirm={() => void remove()}
      />
    </Dialog>
  );
}

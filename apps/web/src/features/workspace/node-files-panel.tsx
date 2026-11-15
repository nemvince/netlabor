import type { NodeRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DownloadSimpleIcon as Download, FileIcon as File, FolderIcon as Folder, ArrowsClockwiseIcon as RefreshCw, FloppyDiskIcon as Save, TrashIcon as Trash2   } from '@phosphor-icons/react';
import { useDeferredValue, useEffect, useState } from 'react';
import { ConfirmDialog } from '../../components/confirm-dialog.tsx';
import { Input } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading } from '../../components/page.tsx';
import { client, orpc } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp } from '../../lib/format.ts';
import { triggerDownload } from '../../lib/jobs.ts';
import { queryClient } from '../../lib/query-client.ts';

/** Node working-directory browser with an in-place text editor. */
export function NodeFilesPanel({ node }: { node: NodeRow }) {
  const [directory, setDirectory] = useState('');
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const deferredDirectory = useDeferredValue(directory);

  useEffect(() => {
    setDirectory('');
    setSelected('');
    setDraft('');
    setNotice(null);
  }, []);

  const files = useQuery({
    ...orpc.nodes.files.list.queryOptions({
      input: { nodeId: node.id, path: deferredDirectory },
    }),
    retry: false,
  });

  const content = useQuery({
    ...orpc.nodes.files.read.queryOptions({
      input: { nodeId: node.id, path: selected },
    }),
    enabled: selected !== '',
    retry: false,
  });

  useEffect(() => {
    if (content.data) setDraft(content.data.content);
  }, [content.data]);

  const writeFile = useMutation({
    ...orpc.nodes.files.write.mutationOptions(),
    onSuccess: (result) => {
      setNotice({
        text: `Saved ${result.path} · ${formatBytes(result.sizeBytes)}`,
        tone: 'success',
      });
      void queryClient.invalidateQueries({ queryKey: orpc.nodes.files.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.nodes.files.read.key() });
    },
    onError: (error) => setNotice({ text: messageOf(error), tone: 'error' }),
  });

  const deleteFile = useMutation({
    ...orpc.nodes.files.delete.mutationOptions(),
    onSuccess: () => {
      setNotice({ text: `Deleted ${selected}`, tone: 'success' });
      setDeleteOpen(false);
      setSelected('');
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: orpc.nodes.files.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.nodes.files.read.key() });
    },
    onError: (error) => setNotice({ text: messageOf(error), tone: 'error' }),
  });

  async function downloadFile() {
    setDownloading(true);
    setNotice(null);
    try {
      const file = await client.nodes.files.download({ nodeId: node.id, path: selected });
      const url = URL.createObjectURL(file);
      triggerDownload(url);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setNotice({ text: `Downloaded ${selected}`, tone: 'success' });
    } catch (error) {
      setNotice({ text: messageOf(error), tone: 'error' });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      <div className="flex items-center gap-1.5">
        <Input
          aria-label="Directory path"
          placeholder="."
          value={directory}
          onChange={(event) => setDirectory(event.target.value)}
          className="py-1 text-[11px]"
        />
        <button
          type="button"
          className="nb-button"
          data-size="sm"
          aria-label="Reload files"
          title="Reload files"
          onClick={() => void files.refetch()}
        >
          <RefreshCw size={12} aria-hidden />
        </button>
      </div>
      {files.isPending ? (
        <Loading label="Reading files…" />
      ) : files.isError ? (
        <Notice tone="error">{messageOf(files.error)}</Notice>
      ) : files.data.length === 0 ? (
        <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
          This directory is empty.
        </p>
      ) : (
        <ul
          className="max-h-40 overflow-y-auto rounded-[2px] border"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          {files.data.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                className="flex w-full items-center gap-1.5 px-1.5 py-1 text-left text-[11px] hover:bg-white/[0.03]"
                style={{
                  color: selected === entry.path ? 'var(--color-copper)' : 'var(--color-ink)',
                  background: selected === entry.path ? 'var(--color-panel-sunken)' : 'transparent',
                }}
                title={`${entry.path} · ${formatStamp(entry.mtime)}`}
                onClick={() => {
                  if (entry.directory) {
                    setDirectory(entry.path);
                    setSelected('');
                    return;
                  }
                  setSelected(entry.path);
                }}
              >
                {entry.directory ? (
                  <Folder size={12} aria-hidden style={{ color: 'var(--color-signal-info)' }} />
                ) : (
                  <File size={12} aria-hidden style={{ color: 'var(--color-ink-faint)' }} />
                )}
                <span className="tabular min-w-0 flex-1 truncate">{entry.path}</span>
                <span className="tabular shrink-0" style={{ color: 'var(--color-ink-faint)' }}>
                  {entry.directory ? '' : formatBytes(entry.sizeBytes)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected !== '' ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span
              className="tabular min-w-0 truncate text-[11px]"
              style={{ color: 'var(--color-ink-dim)' }}
            >
              {selected}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="nb-button"
                data-size="sm"
                disabled={downloading}
                onClick={() => void downloadFile()}
              >
                <Download size={12} aria-hidden /> {downloading ? 'Downloading…' : 'Download'}
              </button>
              <button
                type="button"
                className="nb-button"
                data-size="sm"
                data-variant="danger"
                disabled={deleteFile.isPending}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={12} aria-hidden /> Delete
              </button>
              <button
                type="button"
                className="nb-button"
                data-size="sm"
                data-variant="primary"
                disabled={writeFile.isPending || content.isPending}
                onClick={() => {
                  setNotice(null);
                  writeFile.mutate({ nodeId: node.id, path: selected, content: draft });
                }}
              >
                <Save size={12} aria-hidden /> {writeFile.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
          {content.isPending ? (
            <Loading label="Reading file…" />
          ) : content.isError ? (
            <Notice tone="error">{messageOf(content.error)}</Notice>
          ) : (
            <textarea
              aria-label={`Contents of ${selected}`}
              className="nb-field tabular min-h-40 resize-y font-mono text-[11px] leading-[1.55]"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
            />
          )}
        </div>
      ) : null}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${selected}?`}
        description="The file is removed from the node's working directory. Stop a started node first."
        confirmLabel="Delete file"
        pending={deleteFile.isPending}
        onConfirm={() => deleteFile.mutate({ nodeId: node.id, path: selected })}
      />
    </div>
  );
}

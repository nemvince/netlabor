import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ChevronRight,
  File,
  FilePlus2,
  Folder,
  FolderUp,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { Input, Textarea } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { Loading } from '../../components/Page.tsx';
import { orpc } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp } from '../../lib/format.ts';
import { queryClient } from '../../lib/queryClient.ts';
import { useMe } from '../auth/use-me.ts';

function joinPath(directory: string, name: string): string {
  const clean = name.trim().replace(/^\/+/, '');
  if (clean === '') return '';
  return directory === '' ? clean : `${directory}/${clean}`;
}

function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function breadcrumbSegments(directory: string): { label: string; path: string }[] {
  const segments = directory === '' ? [] : directory.split('/');
  const out = [{ label: 'Project root', path: '' }];
  let prefix = '';
  for (const segment of segments) {
    prefix = prefix === '' ? segment : `${prefix}/${segment}`;
    out.push({ label: segment, path: prefix });
  }
  return out;
}

function invalidateFiles() {
  void queryClient.invalidateQueries({ queryKey: orpc.projects.files.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.files.read.key() });
}

/** Project directory browser with a text editor, file creation, and deletion. */
export function ProjectFilesDialog({
  projectId,
  onOpenChange,
}: {
  projectId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = useMe();
  const canRead = can('node.files');
  const canDelete = can('project.write');
  const [directory, setDirectory] = useState('');
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState('');
  const [savedDraft, setSavedDraft] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const files = useQuery({
    ...orpc.projects.files.list.queryOptions({
      input: { projectId, path: directory },
    }),
    retry: false,
  });

  const content = useQuery({
    ...orpc.projects.files.read.queryOptions({
      input: { projectId, path: selected },
    }),
    enabled: selected !== '' && canRead,
    retry: false,
  });

  useEffect(() => {
    if (!content.data) return;
    setDraft(content.data.content);
    setSavedDraft(content.data.content);
  }, [content.data]);

  const writeFile = useMutation({
    ...orpc.projects.files.write.mutationOptions(),
    onSuccess: (result) => {
      setError(null);
      setNotice(`Saved ${result.path} · ${formatBytes(result.sizeBytes)}`);
      setDraft(result.content);
      setSavedDraft(result.content);
      invalidateFiles();
    },
    onError: (writeError) => setError(messageOf(writeError)),
  });

  const deleteFile = useMutation({
    ...orpc.projects.files.delete.mutationOptions(),
    onSuccess: () => {
      setDeleteTarget(null);
      setError(null);
      setNotice('File removed.');
      setSelected('');
      setDraft('');
      setSavedDraft('');
      invalidateFiles();
      void files.refetch();
    },
    onError: (deleteError) => setError(messageOf(deleteError)),
  });

  const dirty = selected !== '' && draft !== savedDraft;

  function openDirectory(path: string) {
    setDirectory(path);
    setSelected('');
    setDraft('');
    setSavedDraft('');
    setError(null);
    setNotice(null);
  }

  function selectFile(path: string) {
    setSelected(path);
    setDraft('');
    setSavedDraft('');
    setError(null);
    setNotice(null);
  }

  function createFile() {
    if (!canRead) {
      setError('Creating files requires the node.files privilege.');
      return;
    }
    const path = joinPath(directory, newName);
    if (path === '') {
      setError('Enter a file name, for example startup.cfg.');
      return;
    }
    setError(null);
    writeFile.mutate(
      { projectId, path, content: '' },
      {
        onSuccess: () => {
          setNewName('');
          setSelected(path);
          setDraft('');
          setSavedDraft('');
          setNotice(`Created ${path}.`);
          invalidateFiles();
          void files.refetch();
        },
      },
    );
  }

  const segments = breadcrumbSegments(directory);
  const entries = files.data ?? [];

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Project files"
      description="Files in the project directory on the compute that hosts it. The editor loads and saves UTF-8 text."
      width={880}
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice tone="success">{notice}</Notice> : null}

        <nav aria-label="Directory breadcrumb" className="flex flex-wrap items-center gap-1">
          {segments.map((segment, index) => (
            <span key={segment.path} className="flex items-center gap-1">
              {index > 0 ? (
                <ChevronRight size={11} aria-hidden style={{ color: 'var(--color-ink-faint)' }} />
              ) : null}
              <button
                type="button"
                className="nb-button"
                data-size="sm"
                data-variant={segment.path === directory ? 'primary' : 'ghost'}
                onClick={() => openDirectory(segment.path)}
                disabled={segment.path === directory}
              >
                {segment.label}
              </button>
            </span>
          ))}
          {directory !== '' ? (
            <button
              type="button"
              className="nb-button"
              data-size="sm"
              data-variant="ghost"
              title="Go to the parent directory"
              onClick={() => openDirectory(parentPath(directory))}
            >
              <FolderUp size={12} aria-hidden /> Up
            </button>
          ) : null}
          <button
            type="button"
            className="nb-button ml-auto"
            data-size="sm"
            aria-label="Reload files"
            title="Reload files"
            onClick={() => void files.refetch()}
          >
            <RefreshCw size={12} aria-hidden />
          </button>
        </nav>

        <div className="grid min-h-0 grid-cols-[260px_1fr] gap-3">
          <div
            className="flex min-h-0 flex-col overflow-hidden rounded-[3px] border"
            style={{ borderColor: 'var(--color-rule)' }}
          >
            <div className="flex-1 overflow-y-auto" style={{ maxHeight: 420 }}>
              {files.isPending ? (
                <div className="p-3">
                  <Loading label="Reading files…" />
                </div>
              ) : files.isError ? (
                <div className="p-3">
                  <Notice tone="error">{messageOf(files.error)}</Notice>
                </div>
              ) : entries.length === 0 ? (
                <p className="px-3 py-2 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                  This directory is empty.
                </p>
              ) : (
                <ul>
                  {entries.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[12px] hover:bg-white/[0.03]"
                        style={{
                          color:
                            selected === entry.path ? 'var(--color-copper)' : 'var(--color-ink)',
                          background:
                            selected === entry.path ? 'var(--color-panel-sunken)' : 'transparent',
                        }}
                        title={`${entry.path} · ${formatStamp(entry.mtime)}`}
                        onClick={() =>
                          entry.directory ? openDirectory(entry.path) : selectFile(entry.path)
                        }
                        disabled={entry.directory ? false : !canRead}
                      >
                        {entry.directory ? (
                          <Folder
                            size={12}
                            aria-hidden
                            style={{ color: 'var(--color-signal-info)' }}
                          />
                        ) : (
                          <File size={12} aria-hidden style={{ color: 'var(--color-ink-faint)' }} />
                        )}
                        <span className="tabular min-w-0 flex-1 truncate">
                          {entry.path.slice(directory === '' ? 0 : directory.length + 1)}
                        </span>
                        <span
                          className="tabular shrink-0 text-[10px]"
                          style={{ color: 'var(--color-ink-faint)' }}
                        >
                          {entry.directory ? '' : formatBytes(entry.sizeBytes)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div
              className="flex items-center gap-1.5 border-t px-2 py-1.5"
              style={{ borderColor: 'var(--color-rule)' }}
            >
              <Input
                aria-label="New file name"
                placeholder="New file name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    createFile();
                  }
                }}
                className="py-1 text-[11px]"
              />
              <button
                type="button"
                className="nb-button"
                data-size="sm"
                disabled={!canRead || newName.trim() === '' || writeFile.isPending}
                title="Create an empty file in this directory"
                onClick={createFile}
              >
                <FilePlus2 size={12} aria-hidden />
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <span
                className="tabular min-w-0 flex-1 truncate text-[12px]"
                style={{ color: 'var(--color-ink-dim)' }}
                title={selected || undefined}
              >
                {selected === '' ? 'Choose a file to edit.' : selected}
              </span>
              {selected !== '' && canDelete ? (
                <button
                  type="button"
                  className="nb-button"
                  data-size="sm"
                  data-variant="ghost"
                  disabled={deleteFile.isPending}
                  aria-label={`Delete ${selected}`}
                  title={`Delete ${selected}`}
                  onClick={() => setDeleteTarget(selected)}
                >
                  <Trash2 size={12} aria-hidden /> Delete
                </button>
              ) : null}
              <button
                type="button"
                className="nb-button"
                data-size="sm"
                data-variant="primary"
                disabled={!canRead || selected === '' || !dirty || writeFile.isPending}
                title={dirty ? 'Write the editor contents to this file' : 'No unsaved changes'}
                onClick={() => writeFile.mutate({ projectId, path: selected, content: draft })}
              >
                <Save size={12} aria-hidden /> {writeFile.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
            {!canRead ? (
              <Notice tone="info">
                Reading and saving file contents requires the node.files privilege.
              </Notice>
            ) : content.isPending && selected !== '' ? (
              <Loading label="Reading file…" />
            ) : content.isError && selected !== '' ? (
              <Notice tone="error">{messageOf(content.error)}</Notice>
            ) : selected === '' ? (
              <div
                className="flex flex-1 items-center justify-center rounded-[3px] border text-[12px]"
                style={{
                  minHeight: 320,
                  borderColor: 'var(--color-rule)',
                  color: 'var(--color-ink-faint)',
                }}
              >
                Select a file, or create one in the directory above.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {draft.includes('\u0000') ? (
                  <Notice tone="warn">
                    This file contains binary data. Saving the text editor would rewrite it.
                  </Notice>
                ) : null}
                <Textarea
                  aria-label={`Contents of ${selected}`}
                  value={draft}
                  spellCheck={false}
                  onChange={(event) => setDraft(event.target.value)}
                  className="min-h-[320px] resize-none py-2 font-mono text-[12px] leading-[1.5]"
                  style={{ tabSize: 2 }}
                />
                <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                  Project files reach the compute through the agent; text is stored as UTF-8.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete file?"
        description={`${deleteTarget ?? ''} is removed from the project directory on the compute. Directories are deleted with their contents.`}
        confirmLabel="Delete"
        pending={deleteFile.isPending}
        error={deleteFile.error}
        onConfirm={() => {
          if (deleteTarget !== null) deleteFile.mutate({ projectId, path: deleteTarget });
        }}
      />
    </Dialog>
  );
}

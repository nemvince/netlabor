import type { ImageKind, ImageRow } from '@netlabor/contract';
import { IMAGE_KINDS } from '@netlabor/contract';
import { FileUp, UploadCloud } from 'lucide-react';
import { type DragEvent, useRef, useState } from 'react';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { Field, Input, Select } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { client } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { messageOf } from '../../lib/errors.ts';
import { uploadFile } from '../../lib/uploads.ts';

function kindForFilename(filename: string): ImageKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.qcow2') || lower.endsWith('.qcow') || lower.endsWith('.img')) return 'qemu';
  if (lower.endsWith('.iso')) return 'qemu';
  if (lower.endsWith('.bin')) return 'iou';
  return 'qemu';
}

/** Chunked image upload with server-acknowledged progress. */
export function ImageUploadDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: (image: ImageRow) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ImageKind>('qemu');
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'creating'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  function chooseFile(next: File | null) {
    if (!next) return;
    setFile(next);
    setKind(kindForFilename(next.name));
    if (name.trim() === '') setName(next.name.replace(/\.[^.]+$/, ''));
    setError(null);
    setProgress(0);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0] ?? null);
  }

  async function upload() {
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    if (name.trim() === '') {
      setError('Enter an image name.');
      return;
    }
    setStage('uploading');
    setError(null);
    setNotice(null);
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const uploadId = await uploadFile(file, (fraction) => setProgress(fraction), {
        signal: controller.signal,
      });
      setStage('creating');
      const image = await client.images.createFromUpload({
        uploadId,
        name: name.trim(),
        kind,
      });
      onCreated(image);
    } catch (uploadError) {
      if (uploadError instanceof DOMException && uploadError.name === 'AbortError') {
        setNotice('Upload cancelled.');
      } else {
        setError(messageOf(uploadError));
      }
      setStage('idle');
    } finally {
      abortRef.current = null;
    }
  }

  const busy = stage !== 'idle';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onOpenChange(false);
      }}
      title="Upload image"
      description="Files are hashed into the image store chunk by chunk."
      width={620}
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice tone="info">{notice}</Notice> : null}
        <button
          type="button"
          aria-label="Drop an image file or choose one"
          className="flex flex-col items-center justify-center rounded-[3px] border border-dashed px-4 py-6 text-center"
          style={{
            borderColor: dragging ? 'var(--color-copper)' : 'var(--color-rule-strong)',
            background: dragging
              ? 'color-mix(in oklab, var(--color-copper) 8%, transparent)'
              : 'var(--color-panel-sunken)',
          }}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <UploadCloud
            size={24}
            strokeWidth={1.5}
            aria-hidden
            style={{ color: 'var(--color-copper)' }}
          />
          <span className="mt-2 text-[12px]">
            {file ? file.name : 'Drop a qcow2, image, ISO, or IOU binary'}
          </span>
          <span className="tabular mt-0.5 text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
            {file ? formatBytes(file.size) : 'or click to choose a file'}
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
        />

        <div className="grid grid-cols-2 gap-2">
          <Field label="Name" htmlFor="image-upload-name">
            <Input
              id="image-upload-name"
              value={name}
              placeholder="alpine-3.21"
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Kind" htmlFor="image-upload-kind">
            <Select
              id="image-upload-kind"
              value={kind}
              disabled={busy}
              onChange={(event) => setKind(event.target.value as ImageKind)}
            >
              {IMAGE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {busy ? (
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span style={{ color: 'var(--color-ink-dim)' }}>
                {stage === 'uploading'
                  ? `uploading · ${Math.round(progress * 100)}%`
                  : 'verifying sha256 and creating image…'}
              </span>
              <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                {file ? `${formatBytes(file.size * progress)} / ${formatBytes(file.size)}` : ''}
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full"
              style={{ background: 'var(--color-panel-sunken)' }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <div
                className="h-full transition-[width]"
                style={{
                  width: `${Math.max(2, progress * 100)}%`,
                  background: 'var(--color-copper)',
                }}
              />
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <button
            type="button"
            className="nb-button"
            disabled={stage === 'creating'}
            onClick={() => {
              if (stage === 'uploading') abortRef.current?.abort();
              else onOpenChange(false);
            }}
          >
            {stage === 'uploading' ? 'Stop upload' : 'Cancel'}
          </button>
          <button
            type="button"
            className="nb-button"
            data-variant="primary"
            disabled={busy || file === null}
            onClick={() => void upload()}
          >
            <FileUp size={13} aria-hidden />
            {stage === 'uploading' ? 'Uploading…' : stage === 'creating' ? 'Creating…' : 'Upload'}
          </button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

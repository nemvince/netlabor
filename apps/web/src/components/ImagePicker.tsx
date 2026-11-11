import type { ImageKind, ImageRow } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { orpc } from '../lib/api.ts';
import { Field, Select } from './Field.tsx';

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/**
 * Image selector backed by the image library. Shows name, kind and sha prefix
 * so operators never have to paste a UUID.
 */
export function ImagePicker({
  id,
  label = 'Image',
  kind,
  value,
  onChange,
  disabled,
  hint,
  allowEmpty = true,
}: {
  id?: string;
  label?: string;
  kind?: ImageKind;
  value: string | null | undefined;
  onChange: (imageId: string | null, image?: ImageRow) => void;
  disabled?: boolean;
  hint?: string;
  allowEmpty?: boolean;
}) {
  const images = useQuery({
    ...orpc.images.list.queryOptions({ input: { limit: 200, offset: 0 } }),
  });
  const rows = (images.data ?? []).filter((image) => (kind ? image.kind === kind : true));
  const known = rows.some((image) => image.id === value);
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex items-center gap-1.5">
        <Select
          id={id}
          value={value ?? ''}
          disabled={disabled || images.isPending}
          onChange={(event) => {
            const next = event.target.value;
            onChange(
              next === '' ? null : next,
              rows.find((image) => image.id === next),
            );
          }}
        >
          {allowEmpty ? <option value="">— none —</option> : null}
          {!known && value ? (
            <option value={value}>unknown image · {value.slice(0, 8)}</option>
          ) : null}
          {rows.map((image) => (
            <option key={image.id} value={image.id}>
              {image.name} · {image.kind} · {image.sha256.slice(0, 8)} ·{' '}
              {sizeLabel(image.sizeBytes)}
            </option>
          ))}
        </Select>
        <Link
          to="/images"
          className="nb-button shrink-0"
          data-size="sm"
          data-variant="ghost"
          title="Open the image library"
        >
          manage
        </Link>
      </div>
      {rows.length === 0 && !images.isPending ? (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--color-signal-warn)' }}>
          No {kind ?? ''} images yet — upload one on the Images page first.
        </p>
      ) : null}
    </Field>
  );
}

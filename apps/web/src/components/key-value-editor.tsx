import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@netlabor/ui/components/button';
import { Input } from './field.tsx';

interface Row {
  id: string;
  key: string;
  value: string;
}

/** Display a stored value without forcing the operator to write JSON. */
export function displaySettingValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? '';
}

/** Parse a plain value field: numbers and booleans keep their types. */
export function parseSettingValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  const numeric = Number(trimmed);
  if (String(numeric) === trimmed) return numeric;
  return text;
}

function toRows(value: Record<string, unknown>): Row[] {
  return Object.entries(value).map(([key, entry]) => ({
    id: crypto.randomUUID(),
    key,
    value: displaySettingValue(entry),
  }));
}

function toRecord(rows: Row[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key === '') continue;
    record[key] = parseSettingValue(row.value);
  }
  return record;
}

/**
 * Plain key/value editor for settings and preferences maps. Values are entered
 * as text; numbers, `true`/`false` and `null` are stored with their JSON type.
 */
export function KeyValueEditor({
  value,
  onChange,
  disabled,
  keyPlaceholder = 'key',
  valuePlaceholder = 'value',
  addLabel = 'Add entry',
  ariaLabel = 'Entries',
}: {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  ariaLabel?: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(value));
  const lastEmitted = useRef(JSON.stringify(value));

  // Adopt values changed outside the editor (initial load, reset, refetch).
  useEffect(() => {
    const incoming = JSON.stringify(value);
    if (incoming === lastEmitted.current) return;
    lastEmitted.current = incoming;
    setRows(toRows(value));
  }, [value]);

  function commit(next: Row[]) {
    setRows(next);
    const record = toRecord(next);
    lastEmitted.current = JSON.stringify(record);
    onChange(record);
  }

  return (
    <fieldset className="m-0 grid gap-1.5 border-0 p-0" aria-label={ariaLabel}>
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No entries yet.
        </p>
      ) : null}
      {rows.map((row, index) => (
        <div key={row.id} className="flex items-center gap-1.5">
          <Input
            className="tabular basis-2/5 text-[11px]"
            placeholder={keyPlaceholder}
            value={row.key}
            disabled={disabled}
            aria-label={`Key ${index + 1}`}
            onChange={(event) =>
              commit(
                rows.map((entry) =>
                  entry.id === row.id ? { ...entry, key: event.target.value } : entry,
                ),
              )
            }
          />
          <Input
            className="tabular min-w-0 flex-1 text-[11px]"
            placeholder={valuePlaceholder}
            value={row.value}
            disabled={disabled}
            aria-label={`Value ${index + 1}`}
            onChange={(event) =>
              commit(
                rows.map((entry) =>
                  entry.id === row.id ? { ...entry, value: event.target.value } : entry,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0"
            aria-label={`Remove ${row.key || 'entry'}`}
            disabled={disabled}
            onClick={() => commit(rows.filter((entry) => entry.id !== row.id))}
          >
            <Trash2 size={12} aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        disabled={disabled}
        onClick={() => commit([...rows, { id: crypto.randomUUID(), key: '', value: '' }])}
      >
        <Plus size={12} aria-hidden /> {addLabel}
      </Button>
    </fieldset>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type ComputeRow,
  NODE_TYPES,
  type NodeType,
  RequiredImage,
  type SymbolRow,
  TemplateFault,
  type TemplateInput as TemplateInputSchema,
  type TemplateRow,
} from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { PlusIcon as Plus, TrashIcon as Trash2   } from '@phosphor-icons/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { Field, Input, Select, Textarea } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { SymbolGlyph } from '../../components/symbol-glyph.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import {
  GroupedPropertyFields,
  PROPERTY_FIELDS,
  parseTemplateProperties,
  withProperty,
} from './template-property-fields.tsx';
import { Button } from '@netlabor/ui/components/button';

const baseSchema = z.object({
  name: z.string().min(1, 'enter a template name').max(128, 'use at most 128 characters'),
  nodeType: z.enum(NODE_TYPES),
  category: z.string().min(1, 'enter a category').max(64, 'use at most 64 characters'),
  symbol: z.string().min(1, 'choose a symbol'),
  defaultNameFormat: z
    .string()
    .min(1, 'enter a name format')
    .max(128, 'use at most 128 characters'),
  computeId: z.string(),
});

type BaseValues = z.infer<typeof baseSchema>;
type TemplateFormInput = z.infer<typeof TemplateInputSchema>;
type RequiredImageInput = z.infer<typeof RequiredImage> & { rowKey: string };

/** Create or edit a device template with schema-backed scalar fields. */
export function TemplateDialog({
  template,
  symbols,
  computes,
  onOpenChange,
  onSaved,
}: {
  template: TemplateRow | null;
  symbols: SymbolRow[];
  computes: ComputeRow[];
  onOpenChange: (open: boolean) => void;
  onSaved: (template: TemplateRow) => void;
}) {
  const [properties, setProperties] = useState<Record<string, unknown>>(template?.properties ?? {});
  const [advanced, setAdvanced] = useState(JSON.stringify(template?.properties ?? {}, null, 2));
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [requiredImages, setRequiredImages] = useState<RequiredImageInput[]>(() =>
    (template?.requiredImages ?? []).map((required) => ({
      ...required,
      rowKey: crypto.randomUUID(),
    })),
  );
  const libraryImages = useQuery({
    ...orpc.images.list.queryOptions({ input: { limit: 200, offset: 0 } }),
  });
  const [faultsText, setFaultsText] = useState(JSON.stringify(template?.faults ?? [], null, 2));
  const [propertiesError, setPropertiesError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<BaseValues>({
    resolver: zodResolver(baseSchema),
    defaultValues: {
      name: template?.name ?? '',
      nodeType: template?.nodeType ?? 'qemu',
      category: template?.category ?? 'General',
      symbol: template?.symbol ?? 'router',
      defaultNameFormat: template?.defaultNameFormat ?? '{name}-{index}',
      computeId: template?.computeId ?? '',
    },
  });

  const nodeType = form.watch('nodeType');
  const symbolId = form.watch('symbol');
  const symbol = symbols.find((candidate) => candidate.id === symbolId);

  function updateProperty(key: string, value: unknown) {
    setProperties((current) => {
      const next = withProperty(
        current,
        key,
        value === '' || value === undefined ? undefined : value,
      );
      setAdvanced(JSON.stringify(next, null, 2));
      return next;
    });
    setAdvancedError(null);
    setPropertiesError(null);
  }

  function onAdvancedChange(value: string) {
    setAdvanced(value);
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        setProperties(Object.fromEntries(Object.entries(parsed)));
        setAdvancedError(null);
      } else {
        setAdvancedError('Properties must be a JSON object.');
      }
    } catch {
      setAdvancedError('Properties are not valid JSON.');
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    setPropertiesError(null);
    let parsedProperties: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(advanced);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setAdvancedError('Properties must be a JSON object.');
        return;
      }
      parsedProperties = Object.fromEntries(Object.entries(parsed));
    } catch {
      setAdvancedError('Properties are not valid JSON.');
      return;
    }
    const validated = parseTemplateProperties(values.nodeType, parsedProperties);
    if (!validated.ok) {
      setPropertiesError(validated.message);
      return;
    }

    const parsedImages = z.array(RequiredImage).safeParse(requiredImages);
    if (!parsedImages.success) {
      setServerError(
        `Required images: ${parsedImages.error.issues[0]?.path.join('.') ?? ''} ${parsedImages.error.issues[0]?.message ?? 'invalid'}`.trim(),
      );
      return;
    }

    let faults: unknown;
    try {
      faults = JSON.parse(faultsText);
    } catch {
      setServerError('Fault catalog is not valid JSON.');
      return;
    }
    const parsedFaults = z.array(TemplateFault).safeParse(faults);
    if (!parsedFaults.success) {
      setServerError(
        `Fault catalog: ${parsedFaults.error.issues[0]?.path.join('.') ?? ''} ${parsedFaults.error.issues[0]?.message ?? 'invalid'}`.trim(),
      );
      return;
    }

    const input: TemplateFormInput = {
      name: values.name.trim(),
      nodeType: values.nodeType,
      category: values.category.trim(),
      symbol: values.symbol,
      defaultNameFormat: values.defaultNameFormat.trim(),
      computeId: values.computeId === '' ? null : values.computeId,
      properties: validated.value,
      requiredImages: parsedImages.data,
      faults: parsedFaults.data,
    };

    setSaving(true);
    try {
      const saved = template
        ? await client.templates.update({ ...input, id: template.id })
        : await client.templates.create(input);
      onSaved(saved);
    } catch (error) {
      setServerError(messageOf(error));
    } finally {
      setSaving(false);
    }
  });

  function changeNodeType(next: NodeType) {
    form.setValue('nodeType', next, { shouldDirty: true });
    setProperties({});
    setAdvanced('{}');
    setAdvancedError(null);
    setPropertiesError(null);
  }

  const fields = PROPERTY_FIELDS[nodeType] ?? [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      title={template ? `Edit ${template.name}` : 'New device template'}
      description="Templates seed the palette. Properties are validated by the node-type schema."
      width={860}
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        <div className="grid grid-cols-[1fr_1fr_92px] gap-2">
          <Field label="Name" htmlFor="template-name" error={form.formState.errors.name?.message}>
            <Input id="template-name" autoFocus {...form.register('name')} />
          </Field>
          <Field
            label="Category"
            htmlFor="template-category"
            error={form.formState.errors.category?.message}
          >
            <Input id="template-category" {...form.register('category')} />
          </Field>
          <div
            className="flex items-center justify-center rounded-[3px] border"
            style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
            role="img"
            aria-label="Symbol preview"
          >
            {symbol ? (
              <SymbolGlyph svg={symbol.svg} className="size-8" />
            ) : (
              <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                no symbol
              </span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Node type" htmlFor="template-node-type">
            <Select
              id="template-node-type"
              value={nodeType}
              onChange={(event) => changeNodeType(event.target.value as NodeType)}
            >
              {NODE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Symbol" htmlFor="template-symbol">
            <Select id="template-symbol" {...form.register('symbol')}>
              {symbols.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Default name format"
            htmlFor="template-name-format"
            hint="Use {name} and {index}."
          >
            <Input id="template-name-format" {...form.register('defaultNameFormat')} />
          </Field>
          <Field
            label="Compute"
            htmlFor="template-compute"
            hint="Empty lets the controller choose."
          >
            <Select id="template-compute" {...form.register('computeId')}>
              <option value="">auto</option>
              {computes.map((compute) => (
                <option key={compute.id} value={compute.id}>
                  {compute.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <section>
          <div className="nb-rule-label mb-1">{nodeType} properties</div>
          {propertiesError ? <Notice tone="error">{propertiesError}</Notice> : null}
          {fields.length === 0 ? (
            <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
              This node type has no scalar fields; use the advanced properties section below.
            </p>
          ) : (
            <GroupedPropertyFields
              fields={fields}
              values={properties}
              onChange={(key, value) => updateProperty(key, value)}
            />
          )}
        </section>

        <details
          className="rounded-[3px] border px-2 py-1.5"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          <summary className="cursor-pointer text-[12px]">Advanced properties (JSON)</summary>
          <div className="mt-2">
            <Field
              label="Properties JSON"
              htmlFor="template-properties"
              hint="For fields without a form control; validated when saved."
              error={advancedError ?? undefined}
            >
              <Textarea
                id="template-properties"
                rows={8}
                className="tabular text-[11px]"
                spellCheck={false}
                value={advanced}
                onChange={(event) => onAdvancedChange(event.target.value)}
              />
            </Field>
          </div>
        </details>

        <section>
          <div className="nb-rule-label mb-1">Required images</div>
          {requiredImages.length === 0 ? (
            <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
              No image requirements. Adding one lets the controller pick a matching library image
              automatically when a node is created.
            </p>
          ) : (
            <div className="grid gap-2">
              {requiredImages.map((required, index) => {
                const candidates = (libraryImages.data ?? []).filter(
                  (image) => image.kind === required.kind,
                );
                return (
                  <div
                    key={required.rowKey}
                    className="rounded-[3px] border p-2"
                    style={{ borderColor: 'var(--color-rule)' }}
                  >
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Kind">
                        <Select
                          value={required.kind}
                          onChange={(event) =>
                            setRequiredImages((current) =>
                              current.map((entry, i) =>
                                i === index
                                  ? {
                                      ...entry,
                                      kind: event.target.value as RequiredImageInput['kind'],
                                      sha256: undefined,
                                    }
                                  : entry,
                              ),
                            )
                          }
                        >
                          {(['qemu', 'iou', 'dynamips', 'docker'] as const).map((kind) => (
                            <option key={kind} value={kind}>
                              {kind}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Label">
                        <Input
                          value={required.name}
                          onChange={(event) =>
                            setRequiredImages((current) =>
                              current.map((entry, i) =>
                                i === index ? { ...entry, name: event.target.value } : entry,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field label="Filename pattern">
                        <Input
                          className="tabular text-[11px]"
                          value={required.filenamePattern}
                          onChange={(event) =>
                            setRequiredImages((current) =>
                              current.map((entry, i) =>
                                i === index
                                  ? { ...entry, filenamePattern: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                        />
                      </Field>
                    </div>
                    <div className="mt-1.5 flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <Field
                          label="Pick an uploaded image"
                          hint="Sets the name and sha256 match so this template resolves to that file."
                        >
                          <Select
                            value={required.sha256 ?? ''}
                            onChange={(event) => {
                              const image = candidates.find(
                                (entry) => entry.sha256 === event.target.value,
                              );
                              setRequiredImages((current) =>
                                current.map((entry, i) =>
                                  i === index
                                    ? image
                                      ? {
                                          ...entry,
                                          name: image.name,
                                          sha256: image.sha256,
                                          filenamePattern: entry.filenamePattern || image.filename,
                                        }
                                      : { ...entry, sha256: undefined }
                                    : entry,
                                ),
                              );
                            }}
                          >
                            <option value="">— match by name or pattern —</option>
                            {candidates.map((image) => (
                              <option key={image.id} value={image.sha256}>
                                {image.name} · {image.sha256.slice(0, 8)} ·{' '}
                                {image.sizeBytes > 0
                                  ? `${Math.round(image.sizeBytes / 1024 / 1024)} MB`
                                  : ''}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                      <Button type="button" aria-label={`Remove required image ${required.name}`} onClick={() => setRequiredImages((current) => current.filter((_, i) => i !== index)) } className="mb-1 shrink-0" variant="ghost" size="xs">
                        <Trash2 size={12} aria-hidden />
                      </Button>
                    </div>
                    {candidates.length === 0 ? (
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--color-signal-warn)' }}>
                        No {required.kind} images uploaded yet.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <Button type="button" onClick={() => setRequiredImages((current) => [ ...current, { name: `${nodeType} image`, kind: 'qemu', filenamePattern: '*', rowKey: crypto.randomUUID(), }, ]) } className="mt-2" variant="outline" size="xs">
            <Plus size={12} aria-hidden /> Add image requirement
          </Button>
        </section>

        <details
          className="rounded-[3px] border px-2 py-1.5"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          <summary className="cursor-pointer text-[12px]">Fault catalog (JSON)</summary>
          <div className="mt-2">
            <Field
              label="Faults"
              htmlFor="template-faults"
              hint="Device faults executed over the node console."
            >
              <Textarea
                id="template-faults"
                rows={4}
                className="tabular text-[11px]"
                spellCheck={false}
                value={faultsText}
                onChange={(event) => setFaultsText(event.target.value)}
              />
            </Field>
          </div>
        </details>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
            Cancel
          </Button>
          <Button type="submit" disabled={saving} variant="default" size="sm">
            {saving ? 'Saving…' : template ? 'Save template' : 'Create template'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

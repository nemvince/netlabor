import { zodResolver } from '@hookform/resolvers/zod';
import type { DrawingRow, LinkRow, NodeRow, ProjectRow, SymbolRow } from '@netlabor/contract';
import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '../../components/badge.tsx';
import { Field, Input, Select, Textarea } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/table.tsx';
import { useMe } from '../../features/auth/use-me.ts';
import { formatStamp } from '../../lib/format.ts';
import {
  GroupedPropertyFields,
  PROPERTY_FIELDS,
  type PropertyField,
  PropertyFieldInput,
  parseTemplateProperties,
  withProperty,
} from '../templates/template-property-fields.tsx';
import { DynamipsIdlepcPanel } from './dynamips-idlepc-panel.tsx';
import { ProjectStatsPanel } from './inspector-stats.tsx';

import { NodeConsolePanel } from './node-console-panel.tsx';
import { NodeFilesPanel } from './node-files-panel.tsx';
import { QemuDisksPanel } from './qemu-disks-panel.tsx';
import type { NodeUpdateInput } from './schema-types.ts';

type NodeTab = 'properties' | 'ports' | 'files' | 'console';
type NodeAction = 'start' | 'stop' | 'suspend' | 'reload';

const nodeSchema = z.object({
  name: z.string().min(1, 'enter a node name').max(128, 'use at most 128 characters'),
  symbol: z.string().min(1),
  locked: z.boolean(),
  consoleAutoStart: z.boolean(),
  x: z.number({ error: 'enter a number' }).finite('enter a number'),
  y: z.number({ error: 'enter a number' }).finite('enter a number'),
});

type NodeValues = z.infer<typeof nodeSchema>;

interface InspectorProps {
  project: ProjectRow;
  node: NodeRow | null;
  link: LinkRow | null;
  drawing: DrawingRow | null;
  symbols: SymbolRow[];
  onUpdateNode: (id: string, patch: NodeUpdateInput, label: string) => void;
  onNodeAction: (node: NodeRow, action: NodeAction) => void;
  onOpenConsole: (node: NodeRow) => void;
  onOpenLink: (linkId: string) => void;
  onDeleteLink: (link: LinkRow) => void;
  onDeleteDrawing: (drawing: DrawingRow) => void;
  onUpdateDrawing: (drawing: DrawingRow, text: string) => void;
}

/** Right-hand inspector: node properties, ports, files, console, link and drawing detail. */
export function Inspector({
  project,
  node,
  link,
  drawing,
  symbols,
  onUpdateNode,
  onNodeAction,
  onOpenConsole,
  onOpenLink,
  onDeleteLink,
  onDeleteDrawing,
  onUpdateDrawing,
}: InspectorProps) {
  const { can } = useMe();
  const [tab, setTab] = useState<NodeTab>('properties');
  const [advanced, setAdvanced] = useState('{}');
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [props, setProps] = useState<Record<string, unknown>>({});
  const [portFirst, setPortFirst] = useState('');
  const [portFormat, setPortFormat] = useState('');
  const [portMapping, setPortMapping] = useState<unknown>([]);
  const [portsError, setPortsError] = useState<string | null>(null);

  const form = useForm<NodeValues>({
    resolver: zodResolver(nodeSchema),
    defaultValues: {
      name: '',
      symbol: 'router',
      locked: false,
      consoleAutoStart: true,
      x: 0,
      y: 0,
    },
  });

  useEffect(() => {
    setTab('properties');
    setAdvancedError(null);
  }, []);

  useEffect(() => {
    if (!node) return;
    form.reset({
      name: node.name,
      symbol: node.symbol,
      locked: node.locked,
      consoleAutoStart: node.consoleAutoStart,
      x: Math.round(node.x),
      y: Math.round(node.y),
    });
  }, [
    node?.id,
    node?.name,
    node?.symbol,
    node?.locked,
    node?.consoleAutoStart,
    node?.x,
    node?.y,
    form,
    node,
  ]);

  useEffect(() => {
    if (!node) return;
    setAdvanced(JSON.stringify(node.properties, null, 2));
    setProps(node.properties);
    setPortFirst(
      typeof node.properties.firstPortName === 'string' ? node.properties.firstPortName : '',
    );
    setPortFormat(
      typeof node.properties.portNameFormat === 'string' ? node.properties.portNameFormat : '',
    );
    setPortMapping(node.properties.portsMapping ?? []);
    setPortsError(null);
  }, [node]);

  const projectLocked = project.locked;
  const canUpdate = can('node.update') && !projectLocked;
  const canControl = can('node.control') && !projectLocked;
  const canConsole = can('node.console');
  const canFiles = can('node.files');
  const canLinkWrite = can('link.write') && !projectLocked;
  const portsKind: PropertyField['portsKind'] =
    node?.nodeType === 'cloud'
      ? 'cloud'
      : node?.nodeType === 'ethernet_switch'
        ? 'switch'
        : node?.nodeType === 'ethernet_hub'
          ? 'hub'
          : undefined;
  const mappingField: PropertyField = {
    key: 'portsMapping',
    label: 'Port mapping',
    kind: 'ports',
    portsKind: portsKind ?? 'cloud',
    hint: 'Ports are positional: name, port number, and lane mapping.',
  };

  /** Save port labels and the structured port map without touching other fields. */
  function savePorts() {
    if (!node) return;
    const next: Record<string, unknown> = {
      ...props,
      firstPortName: portFirst.trim() === '' ? undefined : portFirst.trim(),
      portNameFormat: portFormat.trim() === '' ? undefined : portFormat.trim(),
    };
    if (portsKind) next.portsMapping = portMapping;
    const validated = parseTemplateProperties(node.nodeType, next);
    if (!validated.ok) {
      setPortsError(validated.message);
      return;
    }
    setPortsError(null);
    setProps(validated.value);
    onUpdateNode(node.id, { properties: validated.value }, 'ports');
  }

  /** One save for identity, placement, and validated runtime properties. */
  function saveAll(values: NodeValues) {
    if (!node) return;
    let nextProperties = props;
    if (node.nodeType === 'iou') {
      const validated = parseTemplateProperties('iou', props);
      if (!validated.ok) {
        setAdvancedError(validated.message);
        return;
      }
      nextProperties = validated.value;
    } else if (
      node.nodeType === 'cloud' ||
      node.nodeType === 'ethernet_switch' ||
      node.nodeType === 'ethernet_hub'
    ) {
      const validated = parseTemplateProperties(node.nodeType, {
        portsMapping: props.portsMapping ?? [],
      });
      if (!validated.ok) {
        setAdvancedError(`portsMapping: ${validated.message}`);
        return;
      }
      nextProperties = { ...props, portsMapping: validated.value.portsMapping };
    }
    setAdvancedError(null);
    onUpdateNode(
      node.id,
      {
        name: values.name.trim(),
        symbol: values.symbol,
        locked: values.locked,
        consoleAutoStart: values.consoleAutoStart,
        x: values.x,
        y: values.y,
        properties: nextProperties,
      },
      'properties',
    );
  }

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-l"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
      aria-label="Inspector"
    >
      <div className="border-b px-3 py-2" style={{ borderColor: 'var(--color-rule)' }}>
        <div className="nb-rule-label">Inspector</div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {node?.name ?? link?.nodeAName ?? drawing?.type ?? project.name}
          </span>
          {node ? (
            <Badge
              tone={
                node.status === 'started'
                  ? 'up'
                  : node.status === 'error'
                    ? 'down'
                    : node.status === 'suspended'
                      ? 'warn'
                      : 'neutral'
              }
            >
              {node.status}
            </Badge>
          ) : link ? (
            <Badge
              tone={
                link.status === 'active'
                  ? 'up'
                  : link.status === 'error'
                    ? 'down'
                    : link.status === 'suspended'
                      ? 'warn'
                      : 'neutral'
              }
            >
              {link.status}
            </Badge>
          ) : null}
        </div>
        {node ? (
          <div
            className="tabular mt-1 truncate text-[10px]"
            style={{ color: 'var(--color-ink-faint)' }}
            title={`Node ${node.id}`}
          >
            {node.nodeType} · {node.computeName} · updated {formatStamp(node.updatedAt)}
          </div>
        ) : null}
      </div>

      {projectLocked ? (
        <div className="px-3 pt-2">
          <Notice tone="warn">The project is locked. Topology editing is disabled.</Notice>
        </div>
      ) : null}

      {node ? (
        <>
          <div
            className="flex shrink-0 border-b px-1"
            style={{ borderColor: 'var(--color-rule)' }}
            role="tablist"
            aria-label="Node inspector tabs"
          >
            {(
              [
                ['properties', 'Properties'],
                ['ports', 'Ports'],
                ['files', 'Files'],
                ['console', 'Console'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className="px-2 py-1.5 text-[11px]"
                style={{
                  color: tab === value ? 'var(--color-ink)' : 'var(--color-ink-dim)',
                  borderBottom:
                    tab === value ? '2px solid var(--color-copper)' : '2px solid transparent',
                }}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {tab === 'properties' ? (
              <form
                className="flex flex-col gap-2.5"
                onSubmit={(event) => {
                  void form.handleSubmit((values) => saveAll(values))(event);
                }}
              >
                <Field label="Name" htmlFor="node-name" error={form.formState.errors.name?.message}>
                  <Input
                    id="node-name"
                    className="py-1 text-[12px]"
                    disabled={!canUpdate}
                    {...form.register('name')}
                  />
                </Field>
                <Field label="Symbol" htmlFor="node-symbol">
                  <Select
                    id="node-symbol"
                    className="py-1 text-[12px]"
                    disabled={!canUpdate}
                    {...form.register('symbol')}
                  >
                    {symbols.map((symbol) => (
                      <option key={symbol.id} value={symbol.id}>
                        {symbol.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <details className="border-t pt-2" style={{ borderColor: 'var(--color-rule)' }}>
                  <summary
                    className="cursor-pointer text-[11px]"
                    style={{ color: 'var(--color-ink-dim)' }}
                  >
                    Placement &amp; startup
                  </summary>
                  <div className="mt-1.5 flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="X" htmlFor="node-x" error={form.formState.errors.x?.message}>
                        <Input
                          id="node-x"
                          type="number"
                          className="py-1 text-[12px]"
                          disabled={!canUpdate}
                          {...form.register('x', { valueAsNumber: true })}
                        />
                      </Field>
                      <Field label="Y" htmlFor="node-y" error={form.formState.errors.y?.message}>
                        <Input
                          id="node-y"
                          type="number"
                          className="py-1 text-[12px]"
                          disabled={!canUpdate}
                          {...form.register('y', { valueAsNumber: true })}
                        />
                      </Field>
                    </div>
                    <label className="flex items-center gap-2 text-[12px]">
                      <input
                        type="checkbox"
                        className="size-3.5"
                        style={{ accentColor: 'var(--color-copper)' }}
                        disabled={!canUpdate}
                        {...form.register('locked')}
                      />
                      Lock node position
                    </label>
                    <label className="flex items-center gap-2 text-[12px]">
                      <input
                        type="checkbox"
                        className="size-3.5"
                        style={{ accentColor: 'var(--color-copper)' }}
                        disabled={!canUpdate}
                        {...form.register('consoleAutoStart')}
                      />
                      Auto-open console on start
                    </label>
                  </div>
                </details>
                {PROPERTY_FIELDS[node.nodeType]?.length ? (
                  <section className="border-t pt-2" style={{ borderColor: 'var(--color-rule)' }}>
                    <div className="mb-1.5">
                      <span className="nb-rule-label">
                        {node.nodeType === 'vpcs' ? 'PC specs' : 'Runtime'}
                      </span>
                    </div>
                    <GroupedPropertyFields
                      fields={PROPERTY_FIELDS[node.nodeType] ?? []}
                      values={props}
                      disabled={!canUpdate}
                      onChange={(key, value) => {
                        const next = withProperty(
                          props,
                          key,
                          value === '' || value === undefined ? undefined : value,
                        );
                        setProps(next);
                        setAdvanced(JSON.stringify(next, null, 2));
                        setAdvancedError(null);
                      }}
                    />
                  </section>
                ) : null}
                {node.nodeType === 'qemu' ? (
                  <details className="border-t pt-2" style={{ borderColor: 'var(--color-rule)' }}>
                    <summary
                      className="cursor-pointer text-[11px]"
                      style={{ color: 'var(--color-ink-dim)' }}
                    >
                      Storage
                    </summary>
                    <div className="mt-1.5">
                      <QemuDisksPanel
                        key={node.id}
                        node={node}
                        canUpdate={canUpdate}
                        canListFiles={canFiles}
                      />
                    </div>
                  </details>
                ) : null}
                {node.nodeType === 'dynamips' ? (
                  <details className="border-t pt-2" style={{ borderColor: 'var(--color-rule)' }}>
                    <summary
                      className="cursor-pointer text-[11px]"
                      style={{ color: 'var(--color-ink-dim)' }}
                    >
                      Idle-PC
                    </summary>
                    <div className="mt-1.5">
                      <DynamipsIdlepcPanel
                        key={node.id}
                        node={node}
                        canUpdate={canUpdate}
                        canProbe={can('compute.read')}
                      />
                    </div>
                  </details>
                ) : null}
                <details
                  className="mt-1 border-t pt-2"
                  style={{ borderColor: 'var(--color-rule)' }}
                >
                  <summary
                    className="cursor-pointer text-[11px]"
                    style={{ color: 'var(--color-ink-dim)' }}
                  >
                    Advanced properties (JSON)
                  </summary>
                  <textarea
                    aria-label="Node properties JSON"
                    className="nb-field tabular mt-1 min-h-40 resize-y font-mono text-[11px] leading-[1.5]"
                    value={advanced}
                    spellCheck={false}
                    disabled={!canUpdate}
                    onChange={(event) => {
                      setAdvanced(event.target.value);
                      setAdvancedError(null);
                    }}
                  />
                  {advancedError ? (
                    <p
                      className="mt-1 text-[11px]"
                      role="alert"
                      style={{ color: 'var(--color-signal-down)' }}
                    >
                      {advancedError}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="nb-button mt-1"
                    data-size="sm"
                    disabled={!canUpdate}
                    onClick={() => {
                      let parsed: unknown;
                      try {
                        parsed = JSON.parse(advanced);
                      } catch {
                        setAdvancedError('The properties are not valid JSON.');
                        return;
                      }
                      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                        setAdvancedError('The properties must be a JSON object.');
                        return;
                      }
                      setAdvancedError(null);
                      setProps(parsed as Record<string, unknown>);
                      onUpdateNode(
                        node.id,
                        { properties: parsed as Record<string, unknown> },
                        'properties',
                      );
                    }}
                  >
                    Save advanced JSON
                  </button>
                </details>
                <div
                  className="sticky bottom-0 -mx-3 mt-1 border-t px-3 py-2"
                  style={{
                    borderColor: 'var(--color-rule)',
                    background: 'var(--color-panel)',
                  }}
                >
                  <button
                    type="submit"
                    className="nb-button w-full"
                    data-size="sm"
                    data-variant="primary"
                    disabled={!canUpdate || form.formState.isSubmitting}
                  >
                    <Save size={12} aria-hidden /> Save changes
                  </button>
                </div>
              </form>
            ) : tab === 'ports' ? (
              <div className="flex flex-col gap-2">
                <section
                  className="rounded-[3px] border px-2 py-2"
                  style={{ borderColor: 'var(--color-rule)' }}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="nb-rule-label">Port settings</span>
                    <button
                      type="button"
                      className="nb-button"
                      data-size="sm"
                      disabled={!canUpdate}
                      onClick={savePorts}
                    >
                      <Save size={12} aria-hidden /> Save ports
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="First port name" htmlFor="port-first-name">
                      <Input
                        id="port-first-name"
                        className="py-1 text-[11px]"
                        placeholder="Ethernet"
                        value={portFirst}
                        disabled={!canUpdate}
                        onChange={(event) => setPortFirst(event.target.value)}
                      />
                    </Field>
                    <Field
                      label="Name format"
                      htmlFor="port-name-format"
                      hint="{0} or %d is the port index"
                    >
                      <Input
                        id="port-name-format"
                        className="tabular py-1 text-[11px]"
                        placeholder="Ethernet{0}"
                        value={portFormat}
                        disabled={!canUpdate}
                        onChange={(event) => setPortFormat(event.target.value)}
                      />
                    </Field>
                  </div>
                  {portsKind ? (
                    <div className="mt-2">
                      <PropertyFieldInput
                        field={mappingField}
                        value={portMapping}
                        disabled={!canUpdate}
                        onChange={(value) => setPortMapping(value)}
                      />
                    </div>
                  ) : null}
                  {portsError ? (
                    <p
                      className="mt-1 text-[11px]"
                      role="alert"
                      style={{ color: 'var(--color-signal-down)' }}
                    >
                      {portsError}
                    </p>
                  ) : null}
                </section>
                <Table label="Node ports">
                  <THead>
                    <Th>Port</Th>
                    <Th align="right">Adapter</Th>
                    <Th align="right">Port</Th>
                    <Th>Type</Th>
                  </THead>
                  <TBody>
                    {node.ports.map((port) => (
                      <Tr key={`${port.adapter}:${port.port}`}>
                        <Td mono>{port.name}</Td>
                        <Td mono align="right">
                          {port.adapter}
                        </Td>
                        <Td mono align="right">
                          {port.port}
                        </Td>
                        <Td mono>{port.type}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                {node.ports.length === 0 ? (
                  <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                    This node has no linkable ports.
                  </p>
                ) : null}
              </div>
            ) : tab === 'files' ? (
              canFiles ? (
                <NodeFilesPanel node={node} />
              ) : (
                <Notice tone="warn">Reading node files requires the node.files privilege.</Notice>
              )
            ) : (
              <NodeConsolePanel
                node={node}
                canConsole={canConsole}
                canControl={canControl}
                onOpenConsole={() => onOpenConsole(node)}
                onAction={(action) => onNodeAction(node, action)}
              />
            )}
          </div>
        </>
      ) : link ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <Badge tone="copper">{link.linkType}</Badge>
              {link.suspend ? <Badge tone="warn">suspended</Badge> : null}
              {link.capture?.active ? <Badge tone="down">capturing</Badge> : null}
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
              <span className="nb-rule-label">Endpoints</span>
              <span className="tabular">
                {link.nodeAName}:{link.adapterA}/{link.portA} ↔ {link.nodeBName}:{link.adapterB}/
                {link.portB}
              </span>
              <span className="nb-rule-label">Dataplane</span>
              <span className="tabular">{link.dataplane?.mode ?? 'inactive'}</span>
              <span className="nb-rule-label">Capture</span>
              <span className="tabular">
                {link.capture
                  ? `${link.capture.active ? 'active' : 'stopped'} · ${link.capture.sizeBytes} bytes · ${link.capture.dlt}`
                  : 'none'}
              </span>
              <span className="nb-rule-label">Updated</span>
              <span className="tabular">{formatStamp(link.updatedAt)}</span>
            </div>
            <div>
              <div className="nb-rule-label mb-1">Filters</div>
              {Object.keys(link.filters).length === 0 ? (
                <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                  No impairment or BPF filter.
                </p>
              ) : (
                <ul className="tabular flex flex-wrap gap-1 text-[10px]">
                  {Object.entries(link.filters).map(([key, value]) => (
                    <li
                      key={key}
                      className="rounded-[2px] border px-1"
                      style={{ borderColor: 'var(--color-rule)' }}
                    >
                      {key}={String(value)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className="nb-button"
                data-size="sm"
                data-variant="primary"
                onClick={() => onOpenLink(link.id)}
              >
                Filters &amp; capture
              </button>
              {canLinkWrite ? (
                <button
                  type="button"
                  className="nb-button"
                  data-size="sm"
                  data-variant="danger"
                  onClick={() => onDeleteLink(link)}
                >
                  Delete link
                </button>
              ) : null}
            </div>
            <p className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
              Click a link on the canvas to reopen the filter and capture dialog.
            </p>
          </div>
        </div>
      ) : drawing ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
            <span className="nb-rule-label">Type</span>
            <span>{drawing.type}</span>
            <span className="nb-rule-label">Layer</span>
            <span>{drawing.layer}</span>
            <span className="nb-rule-label">Position</span>
            <span className="tabular">
              {drawing.x}, {drawing.y}
            </span>
            <span className="nb-rule-label">Size</span>
            <span className="tabular">
              {drawing.width} × {drawing.height}
            </span>
            <span className="nb-rule-label">Locked</span>
            <span>{drawing.locked ? 'yes' : 'no'}</span>
          </div>
          {drawing.text !== null ? (
            <DrawingTextEditor
              drawing={drawing}
              editable={can('drawing.write') && !projectLocked}
              onSave={(text) => onUpdateDrawing(drawing, text)}
            />
          ) : null}
          {can('drawing.write') && !projectLocked ? (
            <button
              type="button"
              className="nb-button mt-2"
              data-size="sm"
              data-variant="danger"
              onClick={() => onDeleteDrawing(drawing)}
            >
              Delete drawing
            </button>
          ) : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <div className="flex flex-col gap-3">
            <ProjectStatsPanel projectId={project.id} />
            <div>
              <div className="nb-rule-label mb-1">Variables</div>
              {Object.keys(project.variables).length === 0 ? (
                <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                  No project variables.
                </p>
              ) : (
                <Table label="Project variables">
                  <THead>
                    <Th>Key</Th>
                    <Th>Value</Th>
                  </THead>
                  <TBody>
                    {Object.entries(project.variables).map(([key, value]) => (
                      <Tr key={key}>
                        <Td mono>{key}</Td>
                        <Td mono>{value}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>
            <p className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
              Select a node to edit its properties, ports, files, and console.
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}

/** Editable text for text and note drawings; solves the read-only canvas gap. */
function DrawingTextEditor({
  drawing,
  editable,
  onSave,
}: {
  drawing: DrawingRow;
  editable: boolean;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(drawing.text ?? '');
  useEffect(() => {
    setText(drawing.text ?? '');
  }, [drawing.id, drawing.text]);
  if (!editable) {
    return <Textarea className="mt-2 min-h-24 text-[12px]" readOnly value={text} />;
  }
  const dirty = text !== (drawing.text ?? '');
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <Textarea
        aria-label="Drawing text"
        className="min-h-24 text-[12px]"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button
        type="button"
        className="nb-button self-end"
        data-size="sm"
        data-variant="primary"
        disabled={!dirty}
        onClick={() => onSave(text)}
      >
        <Save size={12} aria-hidden /> Save text
      </button>
    </div>
  );
}

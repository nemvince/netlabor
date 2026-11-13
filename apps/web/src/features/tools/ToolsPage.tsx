import { useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Badge } from '../../components/Badge.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
import { DetailList } from '../../components/DetailList.tsx';
import { Field, Input, Select } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { Page, PageHeader } from '../../components/Page.tsx';
import { TabBar } from '../../components/TabBar.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/Table.tsx';
import {
  checkOverlap,
  formatIpv4,
  hostRange,
  maskForPrefix,
  networkLabel,
  parseCidr,
  planVlsm,
  splitSubnets,
  type VlsmRequirement,
} from './ipv4.ts';

type ToolTab = 'splitter' | 'vlsm' | 'calculator' | 'overlap';

const TABS: { id: ToolTab; label: string }[] = [
  { id: 'splitter', label: 'Subnet splitter' },
  { id: 'vlsm', label: 'VLSM planner' },
  { id: 'calculator', label: 'IP calculator' },
  { id: 'overlap', label: 'Overlap check' },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ToolSection({
  label,
  description,
  actions,
  narrow = false,
  children,
}: {
  label: string;
  description: string;
  actions?: ReactNode;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`mt-4 flex flex-col gap-3 ${narrow ? 'max-w-3xl' : ''}`} aria-label={label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
          {description}
        </p>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Controls({ children }: { children: ReactNode }) {
  return <div className="nb-panel p-3">{children}</div>;
}

function Summary({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-[3px] border px-3 py-2"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
    >
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
        {label}
      </span>
      <span className="tabular text-[11px]" style={{ color: 'var(--color-ink-dim)' }}>
        {value}
      </span>
    </span>
  );
}

function SubnetSplitter() {
  const [baseInput, setBaseInput] = useState('10.0.0.0/16');
  const [newPrefix, setNewPrefix] = useState('24');
  const [limit, setLimit] = useState('256');
  const base = useMemo(() => {
    try {
      return { value: parseCidr(baseInput), error: null as string | null };
    } catch (error) {
      return { value: null, error: errorMessage(error) };
    }
  }, [baseInput]);
  const result = useMemo(() => {
    if (!base.value) return { value: null, error: null as string | null };
    try {
      const prefix = Number(newPrefix);
      const rows = Number(limit);
      if (!Number.isInteger(rows) || rows < 1 || rows > 4096) {
        throw new Error('Rows must be an integer between 1 and 4096.');
      }
      return { value: splitSubnets(base.value, prefix, rows), error: null as string | null };
    } catch (error) {
      return { value: null, error: errorMessage(error) };
    }
  }, [base.value, newPrefix, limit]);
  const prefixOptions = base.value
    ? Array.from({ length: 33 - base.value.prefix }, (_, index) => base.value!.prefix + index)
    : [];

  useEffect(() => {
    if (base.value && Number(newPrefix) < base.value.prefix) {
      setNewPrefix(String(base.value.prefix));
    }
  }, [base.value, newPrefix]);

  const copyValue = result.value
    ? result.value.subnets
        .map((row) =>
          [
            networkLabel(row.network, row.prefix),
            formatIpv4(row.mask),
            formatIpv4(row.broadcast),
            hostRange(row),
          ].join('\t'),
        )
        .join('\n')
    : '';

  return (
    <ToolSection
      label="Subnet splitter"
      description="Split one IPv4 network into equal-sized subnets."
      actions={copyValue ? <CopyButton value={copyValue} label="Copy table" /> : undefined}
    >
      <Controls>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Base network" htmlFor="split-base" error={base.error ?? undefined}>
            <Input
              id="split-base"
              className="tabular"
              value={baseInput}
              onChange={(event) => setBaseInput(event.target.value)}
              placeholder="10.0.0.0/16"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
          <Field label="New prefix" htmlFor="split-prefix">
            <Select
              id="split-prefix"
              className="tabular"
              value={newPrefix}
              disabled={!base.value}
              onChange={(event) => setNewPrefix(event.target.value)}
            >
              {prefixOptions.length === 0 ? (
                <option value={newPrefix}>enter a base network first</option>
              ) : null}
              {prefixOptions.map((prefix) => (
                <option key={prefix} value={prefix}>
                  /{prefix} — {(2 ** (prefix - (base.value?.prefix ?? prefix))).toLocaleString()}{' '}
                  subnet{prefix - (base.value?.prefix ?? prefix) === 0 ? '' : 's'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rows to show" htmlFor="split-limit">
            <Select
              id="split-limit"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            >
              {['16', '64', '256', '1024', '4096'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Controls>
      {result.value && base.value ? (
        <>
          <Summary>
            <Stat label="Base" value={networkLabel(base.value.network, base.value.prefix)} />
            <Stat label="New prefix" value={`/${newPrefix}`} />
            <Stat label="Subnets" value={result.value.count.toLocaleString()} />
            {result.value.truncated ? (
              <span className="text-[10px]" style={{ color: 'var(--color-signal-warn)' }}>
                showing first {result.value.subnets.length}
              </span>
            ) : null}
          </Summary>
          <Table label="Split subnets" maxHeight={520} stickyHead>
            <THead>
              <Th>#</Th>
              <Th>Network</Th>
              <Th>Mask</Th>
              <Th>Broadcast</Th>
              <Th>Host range</Th>
              <Th align="right">Usable</Th>
            </THead>
            <TBody>
              {result.value.subnets.map((row) => (
                <Tr key={`${row.network}/${row.prefix}`}>
                  <Td mono align="right">
                    {row.index + 1}
                  </Td>
                  <Td mono>{networkLabel(row.network, row.prefix)}</Td>
                  <Td mono>{formatIpv4(row.mask)}</Td>
                  <Td mono>{formatIpv4(row.broadcast)}</Td>
                  <Td mono>{hostRange(row)}</Td>
                  <Td mono align="right">
                    {row.usable.toLocaleString()}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </>
      ) : null}
    </ToolSection>
  );
}

type RequirementRow = VlsmRequirement & { id: string };

function VlsmPlanner() {
  const [baseInput, setBaseInput] = useState('10.0.0.0/24');
  const [requirements, setRequirements] = useState<RequirementRow[]>([
    { id: 'lan', name: 'LAN', request: '100' },
    { id: 'dmz', name: 'DMZ', request: '50' },
    { id: 'wan', name: 'WAN', request: '2' },
  ]);
  const base = useMemo(() => {
    try {
      return { value: parseCidr(baseInput), error: null as string | null };
    } catch (error) {
      return { value: null, error: errorMessage(error) };
    }
  }, [baseInput]);
  const plan = useMemo(() => {
    if (!base.value) return null;
    return planVlsm(base.value, requirements);
  }, [base.value, requirements]);
  const copyValue = plan
    ? plan.allocations
        .filter((row) => row.fits)
        .map((row) =>
          [
            row.name,
            row.request,
            networkLabel(row.network, row.prefix),
            `${formatIpv4(row.firstHost)}-${formatIpv4(row.lastHost)}`,
          ].join('\t'),
        )
        .join('\n')
    : '';

  function update(id: string, patch: Partial<VlsmRequirement>) {
    setRequirements((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  return (
    <ToolSection
      label="VLSM planner"
      description="Allocate variable-length subnets from largest to smallest. Enter host counts, or a /prefix."
      actions={copyValue ? <CopyButton value={copyValue} label="Copy plan" /> : undefined}
    >
      <Controls>
        <div className="max-w-sm">
          <Field label="Base network" htmlFor="vlsm-base" error={base.error ?? undefined}>
            <Input
              id="vlsm-base"
              className="tabular"
              value={baseInput}
              onChange={(event) => setBaseInput(event.target.value)}
              placeholder="10.0.0.0/24"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-2 px-0.5">
            <span className="nb-rule-label">Name</span>
            <span className="nb-rule-label">Hosts or /prefix</span>
            <span className="w-[27px]" aria-hidden />
          </div>
          {requirements.map((requirement, index) => (
            <div
              key={requirement.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-2"
            >
              <Input
                aria-label={`Requirement ${index + 1} name`}
                value={requirement.name}
                placeholder="Name"
                onChange={(event) => update(requirement.id, { name: event.target.value })}
              />
              <Input
                aria-label={`Requirement ${index + 1} hosts or prefix`}
                className="tabular"
                value={requirement.request}
                placeholder="100 hosts or /28"
                spellCheck={false}
                onChange={(event) => update(requirement.id, { request: event.target.value })}
              />
              <button
                type="button"
                className="nb-button"
                data-size="sm"
                data-variant="ghost"
                aria-label={`Remove ${requirement.name || 'requirement'}`}
                title="Remove requirement"
                onClick={() =>
                  setRequirements((current) => current.filter((row) => row.id !== requirement.id))
                }
              >
                <Trash2 size={12} aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="nb-button mt-1 self-start"
            data-size="sm"
            onClick={() =>
              setRequirements((current) => [
                ...current,
                { id: crypto.randomUUID(), name: '', request: '' },
              ])
            }
          >
            <Plus size={12} aria-hidden /> Add requirement
          </button>
        </div>
      </Controls>
      {plan?.errors.length ? (
        <Notice tone="error">
          <ul className="flex list-inside list-disc flex-col gap-0.5">
            {plan.errors.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {plan && base.value ? (
        <>
          <Summary>
            <Stat label="Base" value={networkLabel(base.value.network, base.value.prefix)} />
            <Stat label="Used" value={`${plan.usedAddresses.toLocaleString()} addresses`} />
            <Stat label="Free" value={`${plan.freeAddresses.toLocaleString()} addresses`} />
            <Stat
              label="Requests"
              value={`${plan.allocations.filter((row) => row.fits).length} of ${plan.allocations.length} allocated`}
            />
          </Summary>
          <Table label="VLSM allocations" maxHeight={520} stickyHead>
            <THead>
              <Th>Name</Th>
              <Th>Request</Th>
              <Th>Subnet</Th>
              <Th>Host range</Th>
              <Th align="right">Usable</Th>
            </THead>
            <TBody>
              {plan.allocations.map((row) => (
                <Tr key={`${row.name}:${row.network}:${row.prefix}`}>
                  <Td>{row.name}</Td>
                  <Td mono>{row.request}</Td>
                  <Td mono>
                    {row.fits ? (
                      networkLabel(row.network, row.prefix)
                    ) : (
                      <span style={{ color: 'var(--color-signal-down)' }}>does not fit</span>
                    )}
                  </Td>
                  <Td mono>
                    {row.fits ? `${formatIpv4(row.firstHost)} – ${formatIpv4(row.lastHost)}` : '—'}
                  </Td>
                  <Td mono align="right">
                    {row.fits ? row.usable.toLocaleString() : '—'}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </>
      ) : null}
    </ToolSection>
  );
}

function IpCalculator() {
  const [input, setInput] = useState('192.168.10.42/24');
  const result = useMemo(() => {
    try {
      return { value: parseCidr(input), error: null as string | null };
    } catch (error) {
      return { value: null, error: errorMessage(error) };
    }
  }, [input]);
  const network = result.value;
  const rows: [string, string][] = network
    ? [
        ['Network', networkLabel(network.network, network.prefix)],
        ['Mask', `${formatIpv4(network.mask)} (/${network.prefix})`],
        ['Wildcard', formatIpv4(network.wildcard)],
        ['Broadcast', formatIpv4(network.broadcast)],
        ['First host', formatIpv4(network.firstHost)],
        ['Last host', formatIpv4(network.lastHost)],
        ['Total addresses', network.total.toLocaleString()],
        ['Usable addresses', network.usable.toLocaleString()],
        [
          'Binary address',
          [
            network.address >>> 24,
            (network.address >>> 16) & 255,
            (network.address >>> 8) & 255,
            network.address & 255,
          ]
            .map((octet) => octet.toString(2).padStart(8, '0'))
            .join('.'),
        ],
        [
          'Binary mask',
          [
            network.mask >>> 24,
            (network.mask >>> 16) & 255,
            (network.mask >>> 8) & 255,
            network.mask & 255,
          ]
            .map((octet) => octet.toString(2).padStart(8, '0'))
            .join('.'),
        ],
      ]
    : [];
  return (
    <ToolSection
      label="IP calculator"
      description="Inspect any IPv4 address and prefix."
      narrow
      actions={
        network ? (
          <CopyButton
            value={rows.map(([key, value]) => `${key}: ${value}`).join('\n')}
            label="Copy values"
          />
        ) : undefined
      }
    >
      <Controls>
        <div className="max-w-sm">
          <Field
            label="Address / prefix"
            htmlFor="ip-cidr"
            hint="Enter any address in the subnet; host bits are masked."
            error={result.error ?? undefined}
          >
            <Input
              id="ip-cidr"
              className="tabular"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="192.168.10.42/24"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
        </div>
      </Controls>
      {network ? (
        <div className="nb-panel px-3 py-2.5">
          <DetailList
            rows={rows.map(([label, value]) => ({
              label,
              value: <span className="tabular break-all">{value}</span>,
            }))}
          />
        </div>
      ) : null}
    </ToolSection>
  );
}

function OverlapCheck() {
  const [leftInput, setLeftInput] = useState('10.0.0.0/16');
  const [rightInput, setRightInput] = useState('10.0.4.0/24');
  const left = useMemo(() => {
    try {
      return { value: parseCidr(leftInput), error: null as string | null };
    } catch (error) {
      return { value: null, error: errorMessage(error) };
    }
  }, [leftInput]);
  const right = useMemo(() => {
    try {
      return { value: parseCidr(rightInput), error: null as string | null };
    } catch (error) {
      return { value: null, error: errorMessage(error) };
    }
  }, [rightInput]);
  const overlap = left.value && right.value ? checkOverlap(left.value, right.value) : null;
  return (
    <ToolSection
      label="Overlap check"
      description="Test whether two CIDR blocks overlap or contain each other."
      narrow
      actions={
        <button
          type="button"
          className="nb-button"
          data-size="sm"
          onClick={() => {
            setLeftInput(rightInput);
            setRightInput(leftInput);
          }}
        >
          <ArrowLeftRight size={12} aria-hidden /> Swap A/B
        </button>
      }
    >
      <Controls>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Network A" htmlFor="overlap-a" error={left.error ?? undefined}>
            <Input
              id="overlap-a"
              className="tabular"
              value={leftInput}
              onChange={(event) => setLeftInput(event.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
          <Field label="Network B" htmlFor="overlap-b" error={right.error ?? undefined}>
            <Input
              id="overlap-b"
              className="tabular"
              value={rightInput}
              onChange={(event) => setRightInput(event.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
        </div>
      </Controls>
      {overlap && left.value && right.value ? (
        <div className="nb-panel px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={overlap.overlap ? 'warn' : 'up'}>
              {overlap.overlap ? 'overlap' : 'no overlap'}
            </Badge>
            {overlap.container ? (
              <Badge tone="info">
                {overlap.container === 'a' ? 'A contains B' : 'B contains A'}
              </Badge>
            ) : null}
            {overlap.intersection ? (
              <span className="tabular text-[11px]">
                intersection{' '}
                {networkLabel(overlap.intersection.network, overlap.intersection.prefix)}
              </span>
            ) : null}
          </div>
          <div className="mt-2">
            <DetailList
              rows={[
                {
                  label: 'A',
                  value: (
                    <span className="tabular break-all">
                      {networkLabel(left.value.network, left.value.prefix)} · mask{' '}
                      {formatIpv4(maskForPrefix(left.value.prefix))} · {hostRange(left.value)}
                    </span>
                  ),
                },
                {
                  label: 'B',
                  value: (
                    <span className="tabular break-all">
                      {networkLabel(right.value.network, right.value.prefix)} · mask{' '}
                      {formatIpv4(maskForPrefix(right.value.prefix))} · {hostRange(right.value)}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </div>
      ) : null}
    </ToolSection>
  );
}

export function ToolsPage() {
  const search = useSearch({ strict: false }) as { tab?: string };
  const navigate = useNavigate();
  const view: ToolTab = TABS.some((entry) => entry.id === search.tab)
    ? (search.tab as ToolTab)
    : 'splitter';

  return (
    <Page>
      <PageHeader
        title="Network tools"
        description="Subnet math without leaving the control plane. Everything runs in the browser."
      />
      <div className="mt-4">
        <TabBar
          label="Network tools"
          value={view}
          items={TABS}
          onChange={(id) =>
            void navigate({
              to: '/tools',
              search: { tab: id === 'splitter' ? undefined : id },
              replace: true,
            })
          }
        />
      </div>
      <div className={view === 'splitter' ? undefined : 'hidden'}>
        <SubnetSplitter />
      </div>
      <div className={view === 'vlsm' ? undefined : 'hidden'}>
        <VlsmPlanner />
      </div>
      <div className={view === 'calculator' ? undefined : 'hidden'}>
        <IpCalculator />
      </div>
      <div className={view === 'overlap' ? undefined : 'hidden'}>
        <OverlapCheck />
      </div>
    </Page>
  );
}

import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '../../components/Badge.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
import { Field, Input, Select } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { Page, PageHeader, Section } from '../../components/Page.tsx';
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
  const error = base.error ?? result.error;
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
    <Section
      title="Subnet splitter"
      description="Split one IPv4 network into equal-sized subnets."
      actions={copyValue ? <CopyButton value={copyValue} label="Copy table" /> : undefined}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Base network" htmlFor="split-base" error={base.error ?? undefined}>
          <Input
            id="split-base"
            className="tabular"
            value={baseInput}
            onChange={(event) => setBaseInput(event.target.value)}
            placeholder="10.0.0.0/16"
          />
        </Field>
        <Field label="New prefix" htmlFor="split-prefix" error={result.error ?? undefined}>
          <Input
            id="split-prefix"
            className="tabular"
            inputMode="numeric"
            value={newPrefix}
            onChange={(event) => setNewPrefix(event.target.value)}
            placeholder="24"
          />
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
      {error ? (
        <div className="mt-2">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : result.value ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
            <span style={{ color: 'var(--color-ink-faint)' }}>Base</span>
            <span className="tabular">{networkLabel(result.value.subnets[0]?.network ?? 0, Number(newPrefix))}</span>
            <span style={{ color: 'var(--color-ink-faint)' }}>Subnets</span>
            <Badge tone="copper">{result.value.count.toLocaleString()}</Badge>
            {result.value.truncated ? (
              <span style={{ color: 'var(--color-signal-warn)' }}>
                showing first {result.value.subnets.length}
              </span>
            ) : null}
          </div>
          <div className="mt-2">
            <Table label="Split subnets">
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
          </div>
        </>
      ) : null}
    </Section>
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
    <Section
      title="VLSM planner"
      description="Allocate variable-length subnets from largest to smallest. Enter host counts, or a /prefix."
      actions={copyValue ? <CopyButton value={copyValue} label="Copy plan" /> : undefined}
    >
      <Field label="Base network" htmlFor="vlsm-base" error={base.error ?? undefined}>
        <Input
          id="vlsm-base"
          className="tabular"
          value={baseInput}
          onChange={(event) => setBaseInput(event.target.value)}
          placeholder="10.0.0.0/24"
        />
      </Field>
      <div className="mt-3 flex flex-col gap-1.5">
        {requirements.map((requirement, index) => (
          <div key={requirement.id} className="flex items-center gap-2">
            <Input
              aria-label={`Requirement ${index + 1} name`}
              className="basis-1/3"
              value={requirement.name}
              placeholder="Name"
              onChange={(event) => update(requirement.id, { name: event.target.value })}
            />
            <Input
              aria-label={`Requirement ${index + 1} hosts or prefix`}
              className="tabular flex-1"
              value={requirement.request}
              placeholder="100 hosts or /28"
              onChange={(event) => update(requirement.id, { request: event.target.value })}
            />
            <button
              type="button"
              className="nb-button shrink-0"
              data-size="sm"
              data-variant="ghost"
              aria-label={`Remove ${requirement.name || 'requirement'}`}
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
          className="nb-button justify-self-start"
          data-size="sm"
          onClick={() => setRequirements((current) => [
            ...current,
            { id: crypto.randomUUID(), name: '', request: '' },
          ])}
        >
          <Plus size={12} aria-hidden /> Add requirement
        </button>
      </div>
      {plan?.errors.length ? (
        <div className="mt-3 flex flex-col gap-1">
          {plan.errors.map((entry) => (
            <Notice key={entry} tone="error">
              {entry}
            </Notice>
          ))}
        </div>
      ) : null}
      {plan && base.value ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
            <span style={{ color: 'var(--color-ink-faint)' }}>Base</span>
            <span className="tabular">{networkLabel(base.value.network, base.value.prefix)}</span>
            <span style={{ color: 'var(--color-ink-faint)' }}>Used</span>
            <span className="tabular">{plan.usedAddresses.toLocaleString()} addresses</span>
            <span style={{ color: 'var(--color-ink-faint)' }}>Free</span>
            <Badge tone={plan.freeAddresses > 0 ? 'up' : 'neutral'}>
              {plan.freeAddresses.toLocaleString()}
            </Badge>
          </div>
          <div className="mt-2">
            <Table label="VLSM allocations">
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
                        <span style={{ color: 'var(--color-signal-down)' }}>
                          does not fit
                        </span>
                      )}
                    </Td>
                    <Td mono>
                      {row.fits
                        ? `${formatIpv4(row.firstHost)} – ${formatIpv4(row.lastHost)}`
                        : '—'}
                    </Td>
                    <Td mono align="right">
                      {row.fits ? row.usable.toLocaleString() : '—'}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </>
      ) : null}
    </Section>
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
  const rows = network
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
          [network.address >>> 24, (network.address >>> 16) & 255, (network.address >>> 8) & 255, network.address & 255]
            .map((octet) => octet.toString(2).padStart(8, '0'))
            .join('.'),
        ],
        [
          'Binary mask',
          [network.mask >>> 24, (network.mask >>> 16) & 255, (network.mask >>> 8) & 255, network.mask & 255]
            .map((octet) => octet.toString(2).padStart(8, '0'))
            .join('.'),
        ],
      ]
    : [];
  return (
    <Section
      title="IP calculator"
      description="Inspect any IPv4 address and prefix."
      actions={network ? <CopyButton value={rows.map(([key, value]) => `${key}: ${value}`).join('\n')} label="Copy values" /> : undefined}
    >
      <Field label="Address / prefix" htmlFor="ip-cidr" error={result.error ?? undefined}>
        <Input
          id="ip-cidr"
          className="tabular"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="192.168.10.42/24"
        />
      </Field>
      {network ? (
        <div className="mt-3 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
          {rows.map(([key, value]) => (
            <div key={key} className="contents">
              <span className="nb-rule-label self-center">{key}</span>
              <span className="tabular break-all">{value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

function OverlapCheck() {
  const [leftInput, setLeftInput] = useState('10.0.0.0/16');
  const [rightInput, setRightInput] = useState('10.0.4.0/24');
  const result = useMemo(() => {
    try {
      const left = parseCidr(leftInput);
      const right = parseCidr(rightInput);
      return { left, right, overlap: checkOverlap(left, right), error: null as string | null };
    } catch (error) {
      return { left: null, right: null, overlap: null, error: errorMessage(error) };
    }
  }, [leftInput, rightInput]);
  return (
    <Section title="Overlap check" description="Test whether two CIDR blocks overlap or contain each other.">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Network A" htmlFor="overlap-a" error={result.error ?? undefined}>
          <Input
            id="overlap-a"
            className="tabular"
            value={leftInput}
            onChange={(event) => setLeftInput(event.target.value)}
          />
        </Field>
        <Field label="Network B" htmlFor="overlap-b">
          <Input
            id="overlap-b"
            className="tabular"
            value={rightInput}
            onChange={(event) => setRightInput(event.target.value)}
          />
        </Field>
      </div>
      {result.overlap && result.left && result.right ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={result.overlap.overlap ? 'warn' : 'up'}>
              {result.overlap.overlap ? 'overlap' : 'no overlap'}
            </Badge>
            {result.overlap.container ? (
              <Badge tone="info">
                {result.overlap.container === 'a' ? 'A contains B' : 'B contains A'}
              </Badge>
            ) : null}
            {result.overlap.intersection ? (
              <span className="tabular text-[11px]">
                intersection {networkLabel(result.overlap.intersection.network, result.overlap.intersection.prefix)}
              </span>
            ) : null}
          </div>
          <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[12px]">
            <span className="nb-rule-label">A</span>
            <span className="tabular">
              {networkLabel(result.left.network, result.left.prefix)} · mask {formatIpv4(maskForPrefix(result.left.prefix))}
            </span>
            <span className="nb-rule-label">B</span>
            <span className="tabular">
              {networkLabel(result.right.network, result.right.prefix)} · mask {formatIpv4(maskForPrefix(result.right.prefix))}
            </span>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

export function ToolsPage() {
  const [tab, setTab] = useState<ToolTab>('splitter');
  return (
    <Page>
      <PageHeader
        title="Network tools"
        description="Subnet math without leaving the control plane. Everything runs in the browser."
      />
      <div
        className="mt-4 flex flex-wrap gap-1 border-b"
        style={{ borderColor: 'var(--color-rule)' }}
        role="tablist"
        aria-label="Network tools"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className="px-3 py-1.5 text-[12px]"
            style={{
              color: tab === entry.id ? 'var(--color-ink)' : 'var(--color-ink-dim)',
              borderBottom:
                tab === entry.id ? '2px solid var(--color-copper)' : '2px solid transparent',
            }}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {tab === 'splitter' ? <SubnetSplitter /> : null}
      {tab === 'vlsm' ? <VlsmPlanner /> : null}
      {tab === 'calculator' ? <IpCalculator /> : null}
      {tab === 'overlap' ? <OverlapCheck /> : null}
    </Page>
  );
}

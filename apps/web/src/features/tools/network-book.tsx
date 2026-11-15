/** Remembered IPv4 networks: stored in the browser and fed by the subnet tools. */

import { BookmarkSimpleIcon as BookmarkPlus, TrashIcon as Trash2   } from '@phosphor-icons/react';
import { useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CopyButton } from '../../components/copy-button.tsx';
import { Input } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/table.tsx';
import { toast } from '../../components/toast.tsx';
import { hostRange, networkLabel, parseCidr } from './ipv4.ts';
import { Button } from '@netlabor/ui/components/button';

export interface SavedNetwork {
  id: string;
  name: string;
  cidr: string;
}

interface NetworkBookState {
  networks: SavedNetwork[];
  /** Returns null when the same CIDR is already remembered. */
  add: (input: { cidr: string; name?: string }) => SavedNetwork | null;
  remove: (id: string) => void;
}

export const useNetworkBook = create<NetworkBookState>()(
  persist(
    (set) => ({
      networks: [],
      add: (input) => {
        const parsed = parseCidr(input.cidr);
        const normalized = networkLabel(parsed.network, parsed.prefix);
        let added: SavedNetwork | null = null;
        set((state) => {
          if (state.networks.some((network) => network.cidr === normalized)) return state;
          added = {
            id: crypto.randomUUID(),
            name: input.name?.trim() || normalized,
            cidr: normalized,
          };
          return { networks: [...state.networks, added] };
        });
        return added;
      },
      remove: (id) =>
        set((state) => ({ networks: state.networks.filter((network) => network.id !== id) })),
    }),
    { name: 'netlabor-network-book' },
  ),
);

/** One-click "remember this network" for a result row. */
export function RememberNetworkButton({ cidr, name }: { cidr: string; name?: string }) {
  const add = useNetworkBook((state) => state.add);
  return (
    <Button type="button" aria-label={`Save ${cidr} to Networks`} title="Save to Networks" onClick={() => { try { const saved = add({ cidr, name }); if (saved) toast.success(`${saved.cidr} saved to Networks.`); else toast.info(`${cidr} is already in Networks.`); } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); } }} variant="ghost" size="xs">
      <BookmarkPlus size={12} aria-hidden />
    </Button>
  );
}

/** The remembered-network list, with a manual add form. */
export function NetworksTool() {
  const networks = useNetworkBook((state) => state.networks);
  const add = useNetworkBook((state) => state.add);
  const remove = useNetworkBook((state) => state.remove);
  const [name, setName] = useState('');
  const [cidr, setCidr] = useState('10.0.0.0/24');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    try {
      const parsed = parseCidr(cidr);
      const saved = add({ cidr: networkLabel(parsed.network, parsed.prefix), name });
      if (!saved) {
        setError('That network is already remembered.');
        return;
      }
      setError(null);
      setName('');
      toast.success(`${saved.cidr} saved to Networks.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="max-w-2xl text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
        Networks worth keeping: save them here from any subnet tool, or add one by hand. The list
        lives in this browser.
      </p>
      <div className="nb-panel p-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="flex flex-col gap-1 text-[11px]">
            <span style={{ color: 'var(--color-ink-faint)' }}>Name</span>
            <Input
              value={name}
              placeholder="Office LAN"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px]">
            <span style={{ color: 'var(--color-ink-faint)' }}>Network</span>
            <Input
              className="tabular"
              value={cidr}
              placeholder="10.0.0.0/24"
              spellCheck={false}
              onChange={(event) => setCidr(event.target.value)}
            />
          </label>
          <Button type="button" onClick={submit} className="self-end" variant="default" size="sm">
            <BookmarkPlus size={13} aria-hidden /> Remember
          </Button>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
      {networks.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
          No networks remembered yet.
        </p>
      ) : (
        <Table label="Remembered networks" maxHeight={520} stickyHead>
          <THead>
            <Th>Name</Th>
            <Th>Network</Th>
            <Th>Host range</Th>
            <Th align="right">Usable</Th>
            <Th align="right">Actions</Th>
          </THead>
          <TBody>
            {networks.map((network) => {
              const parsed = parseCidr(network.cidr);
              return (
                <Tr key={network.id}>
                  <Td>{network.name}</Td>
                  <Td mono>{network.cidr}</Td>
                  <Td mono>{hostRange(parsed)}</Td>
                  <Td mono align="right">
                    {parsed.usable.toLocaleString()}
                  </Td>
                  <Td align="right">
                    <span className="flex items-center justify-end gap-1">
                      <CopyButton value={network.cidr} label="Copy network" />
                      <Button type="button" aria-label={`Remove ${network.name}`} title="Remove from Networks" onClick={() => remove(network.id)} variant="ghost" size="xs">
                        <Trash2 size={12} aria-hidden />
                      </Button>
                    </span>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
      <p className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
        {networks.length} remembered
      </p>
    </div>
  );
}

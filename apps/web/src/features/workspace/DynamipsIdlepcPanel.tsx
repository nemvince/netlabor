import type { IdlepcProposal, NodeRow } from '@netlabor/contract';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Gauge } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { Notice } from '../../components/Notice.tsx';
import { toast } from '../../components/Toast.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';

type Proposal = z.infer<typeof IdlepcProposal>;

function stringProperty(properties: Record<string, unknown>, key: string): string | null {
  const value = properties[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Dynamips idle-PC proposals. The agent boots a temporary hypervisor against
 * the selected IOS image, so values are fetched on demand, not on mount.
 */
export function DynamipsIdlepcPanel({
  node,
  canUpdate,
  canProbe,
}: {
  node: NodeRow;
  canUpdate: boolean;
  canProbe: boolean;
}) {
  const queryClient = useQueryClient();
  const platform = stringProperty(node.properties, 'platform');
  const imageId = stringProperty(node.properties, 'imageId');
  const current = stringProperty(node.properties, 'idlepc');

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when platform/image changes.
  useEffect(() => {
    setProposals([]);
    setError(null);
  }, [platform, imageId]);

  const running = node.status === 'started';

  async function propose() {
    if (!platform || !imageId) return;
    setBusy(true);
    setError(null);
    setProposals([]);
    try {
      const result = await client.computes.dynamipsIdlepcProposals({
        id: node.computeId,
        platform,
        imageId,
      });
      setProposals(result);
      if (result.length === 0) {
        setError('The hypervisor reported no idle-PC candidates for this image.');
      }
    } catch (proposalError) {
      setError(messageOf(proposalError));
    } finally {
      setBusy(false);
    }
  }

  async function apply(idlepc: string) {
    setApplying(idlepc);
    setError(null);
    try {
      await client.nodes.dynamips.idlepc({ nodeId: node.id, idlepc });
      toast.success(`Idle-PC ${idlepc} applied to ${node.name}.`);
      void queryClient.invalidateQueries({ queryKey: orpc.nodes.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.nodes.get.key() });
    } catch (applyError) {
      setError(messageOf(applyError));
    } finally {
      setApplying(null);
    }
  }

  return (
    <section
      className="mt-1 flex flex-col gap-2 border-t pt-2"
      style={{ borderColor: 'var(--color-rule)' }}
      aria-label="Dynamips idle-PC"
    >
      <div className="flex items-center justify-between">
        <span className="nb-rule-label flex items-center gap-1">
          <Gauge size={12} aria-hidden /> Idle-PC
        </span>
        <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
          {current ? `current ${current}` : 'not set'}
        </span>
      </div>
      {!platform || !imageId ? (
        <Notice tone="info">
          Choose a platform and an IOS image in the runtime properties above, then request idle-PC
          values.
        </Notice>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span
            className="tabular truncate text-[10px]"
            style={{ color: 'var(--color-ink-faint)' }}
          >
            {platform} · image {imageId.slice(0, 8)}
          </span>
          <button
            type="button"
            className="nb-button"
            data-size="sm"
            disabled={busy || !canProbe}
            onClick={() => void propose()}
          >
            {busy ? 'Probing…' : 'Get proposals'}
          </button>
        </div>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {proposals.length > 0 ? (
        <div className="flex flex-col gap-1">
          {proposals.map((proposal) => (
            <div
              key={proposal.idlepc}
              className="flex items-center justify-between gap-2 rounded-[3px] border px-2 py-1"
              style={{ borderColor: 'var(--color-rule)' }}
            >
              <div className="min-w-0">
                <div className="tabular text-[11px]">{proposal.idlepc}</div>
                <div
                  className="truncate text-[10px]"
                  style={{ color: 'var(--color-ink-faint)' }}
                  title={proposal.description ?? undefined}
                >
                  score {proposal.score}
                  {proposal.description ? ` · ${proposal.description}` : ''}
                </div>
              </div>
              <button
                type="button"
                className="nb-button"
                data-size="sm"
                data-variant={current === proposal.idlepc ? 'primary' : undefined}
                disabled={!canUpdate || !running || applying !== null}
                onClick={() => void apply(proposal.idlepc)}
              >
                {current === proposal.idlepc ? <Check size={12} aria-hidden /> : null}
                {applying === proposal.idlepc ? 'Applying…' : 'Apply'}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {proposals.length > 0 && !running ? (
        <Notice tone="warn">Start {node.name} to apply an idle-PC value.</Notice>
      ) : null}
    </section>
  );
}

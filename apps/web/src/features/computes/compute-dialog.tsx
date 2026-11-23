import { zodResolver } from '@hookform/resolvers/zod';
import type { ComputeRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { StackIcon as Boxes, ArrowsClockwiseIcon as RefreshCw } from '@phosphor-icons/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { Field, Input } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { useMe } from '../../features/auth/use-me.ts';
import { client, orpc } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { messageOf } from '../../lib/errors.ts';
import { waitForJob } from '../../lib/jobs.ts';
import { queryClient } from '../../lib/query-client.ts';
import { TokenOncePanel } from './token-once-panel.tsx';
import { Button } from '@netlabor/ui/components/button';

const computeSchema = z.object({
  name: z.string().min(1, 'enter a compute name').max(64, 'use at most 64 characters'),
  url: z.string().url('enter an http(s) URL, for example https://10.0.0.2:8081'),
  underlayHost: z.string().min(1, 'enter the routable underlay address'),
  poolIds: z.array(z.string()),
});

type ComputeValues = z.infer<typeof computeSchema>;

interface IssuedToken {
  token: string;
  environment: string;
}

function PoolChoices({
  selected,
  pools,
  onToggle,
}: {
  selected: string[];
  pools: { id: string; name: string; description: string | null }[];
  onToggle: (id: string) => void;
}) {
  if (pools.length === 0) {
    return (
      <p className="text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
        No compute pools exist yet. The compute remains directly addressable.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {pools.map((pool) => (
        <label key={pool.id} className="flex cursor-pointer items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            className="size-3.5"
            style={{ accentColor: 'var(--color-copper)' }}
            checked={selected.includes(pool.id)}
            onChange={() => onToggle(pool.id)}
          />
          <span>{pool.name}</span>
          {pool.description ? (
            <span style={{ color: 'var(--color-ink-faint)' }}>{pool.description}</span>
          ) : null}
        </label>
      ))}
    </div>
  );
}

/**
 * Create or edit a compute. Create and rotation both surface the plaintext
 * agent token once, with the environment block the operator pastes on the host.
 */
export function ComputeDialog({
  compute,
  onOpenChange,
}: {
  compute?: ComputeRow;
  onOpenChange: (open: boolean) => void;
}) {
  const editing = compute !== undefined;
  const { can } = useMe();
  const [serverError, setServerError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const pools = useQuery(orpc.pools.list.queryOptions({ input: {} }));

  const form = useForm<ComputeValues>({
    resolver: zodResolver(computeSchema),
    defaultValues: {
      name: compute?.name ?? '',
      url: compute?.url ?? 'http://127.0.0.1:8081',
      underlayHost: compute?.underlayHost ?? '',
      poolIds: compute?.pools.map((pool) => pool.id) ?? [],
    },
  });

  const selectedPools = form.watch('poolIds');

  const createCompute = useMutation({
    ...orpc.computes.create.mutationOptions(),
    onSuccess: (result) => {
      setServerError(null);
      setIssued({ token: result.token, environment: result.environment });
      void queryClient.invalidateQueries({ queryKey: orpc.computes.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.pools.list.key() });
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  const updateCompute = useMutation({
    ...orpc.computes.update.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.computes.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.pools.list.key() });
      onOpenChange(false);
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  function togglePool(id: string) {
    const current = form.getValues('poolIds');
    form.setValue(
      'poolIds',
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      { shouldDirty: true },
    );
  }

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    if (editing) {
      updateCompute.mutate({
        id: compute.id,
        name: values.name.trim(),
        url: values.url.trim(),
        underlayHost: values.underlayHost.trim(),
        poolIds: values.poolIds,
      });
      return;
    }
    createCompute.mutate({
      name: values.name.trim(),
      url: values.url.trim(),
      underlayHost: values.underlayHost.trim(),
      poolIds: values.poolIds,
    });
  });

  if (issued) {
    return (
      <Dialog
        open
        onOpenChange={onOpenChange}
        title={editing ? 'Agent token rotated' : 'Compute registered'}
        description="Paste the environment block into the agent's EnvironmentFile, then restart the agent."
        width={620}
      >
        <TokenOncePanel token={issued.token} environment={issued.environment} />
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="default" size="sm">
            Done
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={editing ? `Edit ${compute.name}` : 'Add compute'}
      description={
        editing
          ? 'The underlay index is immutable; update the address or pool membership.'
          : 'The controller allocates the next free underlay index when the compute is created.'
      }
      width={560}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        <Field label="Name" htmlFor="compute-name" error={form.formState.errors.name?.message}>
          <Input id="compute-name" autoFocus placeholder="edge-01" {...form.register('name')} />
        </Field>
        <Field
          label="Agent URL"
          htmlFor="compute-url"
          hint="Must be https:// unless the controller allows insecure agents."
          error={form.formState.errors.url?.message}
        >
          <Input id="compute-url" placeholder="https://10.0.0.2:8081" {...form.register('url')} />
        </Field>
        <Field
          label="Underlay host"
          htmlFor="compute-host"
          hint="Address other computes reach this host on, for example its WireGuard address."
          error={form.formState.errors.underlayHost?.message}
        >
          <Input id="compute-host" placeholder="10.0.0.2" {...form.register('underlayHost')} />
        </Field>
        <Field label="Pools">
          <PoolChoices selected={selectedPools} pools={pools.data ?? []} onToggle={togglePool} />
        </Field>
        {pools.isError ? <Notice tone="error">{messageOf(pools.error)}</Notice> : null}
        {editing ? (
          <DockerImagesSection computeId={compute.id} canPull={can('image.write')} />
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={createCompute.isPending || updateCompute.isPending}
            variant="default"
            size="sm"
          >
            {editing
              ? updateCompute.isPending
                ? 'Saving…'
                : 'Save compute'
              : createCompute.isPending
                ? 'Registering…'
                : 'Register compute'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** Rotation warning + plaintext token, shown once. */
export function RotateTokenDialog({
  compute,
  onOpenChange,
}: {
  compute: ComputeRow;
  onOpenChange: (open: boolean) => void;
}) {
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const rotate = useMutation({
    ...orpc.computes.rotateToken.mutationOptions(),
    onSuccess: (result) => {
      setIssued({ token: result.token, environment: result.environment });
      void queryClient.invalidateQueries({ queryKey: orpc.computes.list.key() });
    },
  });

  if (issued) {
    return (
      <Dialog
        open
        onOpenChange={onOpenChange}
        title={`Token rotated for ${compute.name}`}
        description="Update the agent environment file and restart the agent; the previous token is dead."
        width={620}
      >
        <TokenOncePanel token={issued.token} environment={issued.environment} />
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="default" size="sm">
            Done
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`Rotate token for ${compute.name}`}
      description="The agent loses access until its environment file carries the new token."
      width={480}
    >
      <div className="flex flex-col gap-3">
        <Notice tone="warn">
          Rotation invalidates the current token immediately. The agent reconnects after restart.
        </Notice>
        {rotate.isError ? <Notice tone="error">{messageOf(rotate.error)}</Notice> : null}
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
            Cancel
          </Button>
          <Button
            type="button"
            disabled={rotate.isPending}
            onClick={() => rotate.mutate({ id: compute.id })}
            variant="destructive"
            size="sm"
          >
            {rotate.isPending ? 'Rotating…' : 'Rotate token'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

/** Docker images on one compute, with a pull action that reports job progress. */
function DockerImagesSection({ computeId, canPull }: { computeId: string; canPull: boolean }) {
  const [image, setImage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);

  const images = useQuery({
    ...orpc.computes.dockerImages.list.queryOptions({ input: { id: computeId } }),
    retry: false,
  });

  async function pull() {
    const reference = image.trim();
    if (reference === '') return;
    setError(null);
    setNotice(null);
    setPulling(reference);
    try {
      const job = await client.computes.dockerImages.pull({ id: computeId, image: reference });
      await waitForJob(job.id);
      setNotice(`Pulled ${reference}.`);
      setImage('');
      void images.refetch();
    } catch (pullError) {
      setError(messageOf(pullError));
    } finally {
      setPulling(null);
    }
  }

  return (
    <fieldset
      className="flex flex-col gap-2 rounded-[3px] border px-3 py-2"
      style={{ borderColor: 'var(--color-rule)' }}
    >
      <legend className="nb-rule-label px-1">Docker images</legend>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px]" style={{ color: 'var(--color-ink-dim)' }}>
          {images.data?.length ?? 0} image(s) cached on this compute
        </span>
        <Button
          type="button"
          aria-label="Reload Docker images"
          disabled={images.isFetching}
          onClick={() => void images.refetch()}
          variant="outline"
          size="xs"
        >
          <RefreshCw size={12} aria-hidden />
        </Button>
      </div>
      {images.isPending ? (
        <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
          Reading Docker images…
        </p>
      ) : images.isError ? (
        <Notice tone="error">{messageOf(images.error)}</Notice>
      ) : images.data.length === 0 ? (
        <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
          No Docker image is cached yet. Pull one before starting a Docker node here.
        </p>
      ) : (
        <ul className="max-h-40 overflow-y-auto text-[11px]">
          {images.data.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-2 py-0.5">
              <span className="tabular min-w-0 truncate" title={entry.tags.join(', ')}>
                {entry.tags.length > 0 ? entry.tags.join(', ') : entry.id.slice(0, 19)}
              </span>
              <span className="tabular shrink-0" style={{ color: 'var(--color-ink-faint)' }}>
                {formatBytes(entry.sizeBytes)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canPull ? (
        <div className="flex items-end gap-2">
          <Field label="Pull an image" htmlFor="compute-docker-image">
            <Input
              id="compute-docker-image"
              placeholder="alpine:3.21"
              value={image}
              disabled={pulling !== null}
              onChange={(event) => setImage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                void pull();
              }}
            />
          </Field>
          <Button
            type="button"
            disabled={pulling !== null || image.trim() === ''}
            onClick={() => void pull()}
            variant="default"
            size="xs"
          >
            <Boxes size={12} aria-hidden /> {pulling ? 'Pulling…' : 'Pull'}
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}

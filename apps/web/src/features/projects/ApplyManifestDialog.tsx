import type { ProjectApplyInput, ProjectApplyResult, ProjectRow } from '@netlabor/contract';
import { useMutation } from '@tanstack/react-query';
import { FileJson2 } from 'lucide-react';
import { useState } from 'react';
import { Dialog, DialogFooter } from '../../components/Dialog.tsx';
import { Field, Textarea } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { toast } from '../../components/Toast.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { queryClient } from '../../lib/queryClient.ts';

const SAMPLE = {
  nodes: [{ name: 'sw1', template: 'Ethernet switch' }],
  links: [],
  drawings: [],
  prune: false,
  start: false,
};

function summarize(result: ProjectApplyResult): string {
  const created = result.nodes.filter((node) => node.created).length;
  const updated = result.nodes.filter((node) => node.updated).length;
  const deleted =
    result.deleted.nodes.length + result.deleted.links.length + result.deleted.drawings.length;
  const parts = [
    `${created} node(s) created`,
    `${updated} updated`,
    `${result.links.filter((link) => link.created).length} link(s) added`,
    `${result.drawings.filter((drawing) => drawing.created).length} drawing(s) added`,
  ];
  if (deleted > 0) parts.push(`${deleted} removed`);
  if (result.started.length > 0) parts.push(`${result.started.length} started`);
  return `Applied to ${result.project.name}: ${parts.join(', ')}.`;
}

/**
 * Apply a declarative project manifest. When a project is supplied the
 * manifest cannot move to another project; otherwise `name` finds or creates.
 */
export function ApplyManifestDialog({
  project,
  onOpenChange,
}: {
  project?: ProjectRow;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState(() =>
    JSON.stringify(
      project ? { name: project.name, ...SAMPLE } : { name: 'new-lab', ...SAMPLE },
      null,
      2,
    ),
  );
  const [serverError, setServerError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ProjectApplyResult | null>(null);

  const apply = useMutation({
    mutationFn: async (input: ProjectApplyInput) => client.projects.apply(input),
    onSuccess: (applied) => {
      setServerError(null);
      setResult(applied);
      void queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.projects.get.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.projects.stats.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.nodes.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.links.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.drawings.list.key() });
      toast.success('Manifest applied.');
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  function submit() {
    setServerError(null);
    setParseError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'invalid JSON');
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setParseError('the manifest must be a JSON object');
      return;
    }
    const manifest = parsed as Record<string, unknown>;
    apply.mutate({
      ...(manifest as ProjectApplyInput),
      ...(project ? { projectId: project.id } : {}),
    });
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={project ? `Apply manifest · ${project.name}` : 'Apply manifest'}
      description="One idempotent pass over nodes, links, drawings, and files. Reapplying the same manifest updates instead of duplicating."
      width={680}
    >
      <div className="flex flex-col gap-3">
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        {parseError ? <Notice tone="error">Invalid JSON: {parseError}</Notice> : null}
        {result ? (
          <Notice tone="success">{summarize(result)}</Notice>
        ) : (
          <Field
            label="Manifest"
            htmlFor="apply-manifest"
            hint={
              project
                ? 'projectId is fixed to this project. Set prune or start inside the manifest.'
                : 'Omit projectId to find or create a project by name.'
            }
          >
            <Textarea
              id="apply-manifest"
              className="tabular min-h-[320px] font-mono text-[11px] leading-[1.55]"
              spellCheck={false}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setParseError(null);
              }}
            />
          </Field>
        )}
        <DialogFooter>
          <button type="button" className="nb-button" onClick={() => onOpenChange(false)}>
            Close
          </button>
          <button
            type="button"
            className="nb-button"
            data-variant="primary"
            disabled={apply.isPending || result !== null}
            onClick={submit}
          >
            <FileJson2 size={13} aria-hidden />
            {apply.isPending ? 'Applying…' : 'Apply manifest'}
          </button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

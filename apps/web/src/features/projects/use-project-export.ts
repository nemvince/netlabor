import { useCallback, useState } from 'react';
import { client } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { jobResultString, triggerDownload, waitForJob } from '../../lib/jobs.ts';

export interface ExportProgress {
  projectId: string;
  progress: number;
  busy: boolean;
  error?: string;
}

/**
 * Runs a project export and polls the background job. The download only starts
 * once the archive job reports completed, so the link is never empty.
 */
export function useProjectExport() {
  const [state, setState] = useState<ExportProgress | null>(null);

  const run = useCallback(async (projectId: string) => {
    setState({ projectId, progress: 0, busy: true });
    try {
      const output = await client.projects.export({ id: projectId });
      const job = await waitForJob(output.jobId, {
        onUpdate: (update) =>
          setState({ projectId, progress: Math.round(update.progress), busy: true }),
      });
      triggerDownload(jobResultString(job, 'downloadUrl') ?? output.downloadUrl);
      setState({ projectId, progress: 100, busy: false });
    } catch (error) {
      setState({ projectId, progress: 0, busy: false, error: messageOf(error) });
    }
  }, []);

  const clear = useCallback(() => setState(null), []);

  return { state, run, clear };
}

import { ToastViewport, toast } from '@web/components/toast.tsx';
import { Button } from '@netlabor/ui/components/button';

export default function ToastDemo() {
  return (
    <>
      <div className="docs-stack">
        <Button
          type="button"
          onClick={() => toast.success('Project apply finished: 12 nodes, 14 links')}
          variant="default"
          size="sm"
        >
          Success toast
        </Button>
        <Button
          type="button"
          onClick={() => toast.info('Snapshot created')}
          variant="outline"
          size="sm"
        >
          Info toast
        </Button>
        <Button
          type="button"
          onClick={() => toast.error('AGENT_UNAVAILABLE: compute eu-1 is offline')}
          variant="destructive"
          size="sm"
        >
          Error toast
        </Button>
      </div>
      <ToastViewport />
    </>
  );
}

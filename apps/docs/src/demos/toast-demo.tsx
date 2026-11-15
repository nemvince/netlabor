import { ToastViewport, toast } from '@web/components/toast.tsx';

export default function ToastDemo() {
  return (
    <>
      <div className="docs-stack">
        <button
          type="button"
          className="nb-button"
          data-variant="primary"
          onClick={() => toast.success('Project apply finished: 12 nodes, 14 links')}
        >
          Success toast
        </button>
        <button type="button" className="nb-button" onClick={() => toast.info('Snapshot created')}>
          Info toast
        </button>
        <button
          type="button"
          className="nb-button"
          data-variant="danger"
          onClick={() => toast.error('AGENT_UNAVAILABLE: compute eu-1 is offline')}
        >
          Error toast
        </button>
      </div>
      <ToastViewport />
    </>
  );
}

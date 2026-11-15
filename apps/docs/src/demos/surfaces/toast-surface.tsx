import { ToastViewport, toast } from '@web/components/toast.tsx';

export interface ToastSurfaceProps {
  infoMessage?: string;
  errorMessage?: string;
}

/**
 * The real toast store and viewport. Every open workspace and the docs share
 * one queue; the buttons push a message the same way an SSE event handler or
 * a failed mutation does.
 */
export default function ToastSurface({
  infoMessage = 'Maya joined the project',
  errorMessage = 'CONFLICT: node sw2 was changed by another editor',
}: ToastSurfaceProps) {
  return (
    <>
      <div className="docs-stack">
        <button
          type="button"
          className="nb-button"
          data-variant="primary"
          onClick={() => toast.info(infoMessage)}
        >
          Collaborator joined
        </button>
        <button
          type="button"
          className="nb-button"
          data-variant="danger"
          onClick={() => toast.error(errorMessage)}
        >
          Conflicting save
        </button>
      </div>
      <ToastViewport />
    </>
  );
}

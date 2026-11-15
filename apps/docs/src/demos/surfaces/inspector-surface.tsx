import Deferred from './deferred.tsx';
import type { InspectorSurfaceProps } from './inspector-surface-body.tsx';

const load = () => import('./inspector-surface-body.tsx');

export type { InspectorSurfaceProps };

export default function InspectorSurface(props: InspectorSurfaceProps) {
  return (
    <Deferred
      load={load}
      props={props}
      placeholder={
        <div
          className="docs-ui-inspector"
          style={{ height: props.height ?? 380 }}
          aria-busy="true"
        />
      }
    />
  );
}

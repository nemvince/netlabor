import Deferred from './Deferred.tsx';
import type { InspectorSurfaceProps } from './InspectorSurfaceBody.tsx';

const load = () => import('./InspectorSurfaceBody.tsx');

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

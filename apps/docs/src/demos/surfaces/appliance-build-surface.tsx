import type { ApplianceBuildSurfaceProps } from './appliance-build-body.tsx';
import Deferred from './deferred.tsx';

const load = () => import('./appliance-build-body.tsx');

export type { ApplianceBuildSurfaceProps };

export default function ApplianceBuildSurface(props: ApplianceBuildSurfaceProps) {
  return (
    <Deferred
      load={load}
      props={props}
      placeholder={
        <button type="button" className="nb-button" data-variant="primary" disabled>
          New appliance build
        </button>
      }
    />
  );
}

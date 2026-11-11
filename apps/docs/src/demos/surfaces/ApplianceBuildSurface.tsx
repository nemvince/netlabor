import type { ApplianceBuildSurfaceProps } from './ApplianceBuildBody.tsx';
import Deferred from './Deferred.tsx';

const load = () => import('./ApplianceBuildBody.tsx');

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

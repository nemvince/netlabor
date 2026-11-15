import type { ApplianceBuildSurfaceProps } from './appliance-build-body.tsx';
import Deferred from './deferred.tsx';
import { Button } from '@netlabor/ui/components/button';

const load = () => import('./appliance-build-body.tsx');

export type { ApplianceBuildSurfaceProps };

export default function ApplianceBuildSurface(props: ApplianceBuildSurfaceProps) {
  return (
    <Deferred
      load={load}
      props={props}
      placeholder={
        <Button type="button" disabled variant="default" size="sm">
          New appliance build
        </Button>
      }
    />
  );
}

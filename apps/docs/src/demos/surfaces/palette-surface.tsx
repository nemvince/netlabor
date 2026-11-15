import Deferred from './deferred.tsx';
import type { PaletteSurfaceProps } from './palette-body.tsx';

const load = () => import('./palette-body.tsx');

export type { PaletteSurfaceProps };

export default function PaletteSurface(props: PaletteSurfaceProps) {
  return (
    <Deferred
      load={load}
      props={props}
      placeholder={
        <div
          className="docs-ui-panel docs-ui-palette"
          style={{ height: props.height ?? 320 }}
          aria-busy="true"
        />
      }
    />
  );
}

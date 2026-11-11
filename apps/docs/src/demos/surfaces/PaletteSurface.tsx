import Deferred from './Deferred.tsx';
import type { PaletteSurfaceProps } from './PaletteBody.tsx';

const load = () => import('./PaletteBody.tsx');

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

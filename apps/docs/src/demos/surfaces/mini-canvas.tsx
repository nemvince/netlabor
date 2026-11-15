import Deferred from './deferred.tsx';
import type { MiniCanvasProps } from './mini-canvas-body.tsx';

const load = () => import('./mini-canvas-body.tsx');

export type { MiniCanvasProps };

export default function MiniCanvas(props: MiniCanvasProps) {
  return (
    <Deferred
      load={load}
      props={props}
      placeholder={
        <div
          className="nb-canvas docs-ui-canvas relative"
          style={{ height: props.height ?? 360 }}
          aria-busy="true"
        />
      }
    />
  );
}

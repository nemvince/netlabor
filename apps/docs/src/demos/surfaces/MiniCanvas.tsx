import Deferred from './Deferred.tsx';
import type { MiniCanvasProps } from './MiniCanvasBody.tsx';

const load = () => import('./MiniCanvasBody.tsx');

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

import { type ComponentType, type ReactNode, useEffect, useState } from 'react';

export interface DeferredProps<P extends object> {
  load: () => Promise<{ default: ComponentType<P> }>;
  props: P;
  placeholder: ReactNode;
}

/**
 * Loads a component module after hydration. The workspace's API client reads
 * `window.location` at module scope, so any surface that imports it cannot be
 * part of the server bundle; deferring keeps the page static without giving up
 * `client:visible` and the SSR'd frame around it.
 */
export default function Deferred<P extends object>({ load, props, placeholder }: DeferredProps<P>) {
  const [Inner, setInner] = useState<ComponentType<P> | null>(null);

  useEffect(() => {
    let live = true;
    void load().then((module) => {
      if (live) setInner(() => module.default);
    });
    return () => {
      live = false;
    };
  }, [load]);

  if (!Inner) return placeholder;
  return <Inner {...props} />;
}

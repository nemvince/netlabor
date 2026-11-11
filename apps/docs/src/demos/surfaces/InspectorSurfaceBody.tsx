import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Inspector } from '@web/features/workspace/Inspector.tsx';
import { orpc } from '@web/lib/api.ts';
import { me, nodeByName, project, stats } from '../fixtures/workspace.ts';

/**
 * The right-rail inspector. `useMe` and the project counters are seeded into a
 * query cache that never fetches, so the real component mounts without auth or
 * a controller. Every callback is inert.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      enabled: false,
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
    },
  },
});
queryClient.setQueryData(orpc.auth.me.queryOptions({ input: {} }).queryKey, me);
queryClient.setQueryData(
  orpc.projects.stats.queryOptions({ input: { id: project.id } }).queryKey,
  stats,
);

const noop = () => {};

export interface InspectorSurfaceProps {
  /** Fixture node name for the properties tab; omit for the overview. */
  nodeName?: string;
  height?: number;
}

export default function InspectorSurface({ nodeName, height = 380 }: InspectorSurfaceProps) {
  const node = nodeName ? (nodeByName.get(nodeName) ?? null) : null;

  return (
    <QueryClientProvider client={queryClient}>
      <div className="docs-ui-inspector" style={{ height }}>
        <Inspector
          key={node?.id ?? 'overview'}
          project={project}
          node={node}
          link={null}
          drawing={null}
          symbols={[]}
          onUpdateNode={noop}
          onNodeAction={noop}
          onOpenConsole={noop}
          onOpenLink={noop}
          onDeleteLink={noop}
          onDeleteDrawing={noop}
        />
      </div>
    </QueryClientProvider>
  );
}

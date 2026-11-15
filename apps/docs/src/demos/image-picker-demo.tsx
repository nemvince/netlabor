import type { ImageRow } from '@netlabor/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { ImagePicker } from '@web/components/image-picker.tsx';
import { orpc } from '@web/lib/api.ts';
import { useState } from 'react';

/**
 * The picker is query-backed and links to /images with the app router, so the
 * demo mounts a memory router and seeds the query cache with library rows. No
 * network request is made.
 */
const images: ImageRow[] = [
  {
    id: '0b000000-0000-4000-8000-000000000001',
    name: 'debian-13-genericcloud-amd64',
    kind: 'qemu',
    filename: 'debian-13-genericcloud-amd64.qcow2',
    sha256: 'a3f1c9e27b4d8065a3f1c9e27b4d8065a3f1c9e27b4d8065a3f1c9e27b4d8065',
    sizeBytes: 402653184,
    metadata: {},
    createdBy: null,
    createdAt: '2026-11-11T08:00:00+00:00',
    replicas: [
      {
        computeId: '0b000000-0000-4000-8000-0000000000aa',
        computeName: 'eu-1',
        state: 'present',
        path: '/var/lib/netlabor/images/debian-13',
        verifiedAt: '2026-11-11T08:04:00+00:00',
      },
    ],
  },
  {
    id: '0b000000-0000-4000-8000-000000000002',
    name: 'ccna-xfce-build',
    kind: 'qemu',
    filename: 'ccna-xfce-build.qcow2',
    sha256: 'b7e2d4f60c1a9385b7e2d4f60c1a9385b7e2d4f60c1a9385b7e2d4f60c1a9385',
    sizeBytes: 8589934592,
    metadata: {},
    createdBy: null,
    createdAt: '2026-11-11T09:00:00+00:00',
    replicas: [],
  },
];

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { enabled: false, retry: false, staleTime: Number.POSITIVE_INFINITY },
  },
});
queryClient.setQueryData(
  orpc.images.list.queryOptions({ input: { limit: 200, offset: 0 } }).queryKey,
  images,
);

function Picker() {
  const [value, setValue] = useState<string | null>(images[0]?.id ?? null);
  const selected = images.find((image) => image.id === value);
  return (
    <div className="flex flex-col gap-2">
      <ImagePicker
        id="demo-image"
        label="Disk image"
        kind="qemu"
        value={value}
        onChange={(next) => setValue(next)}
        hint="Name, kind, sha prefix, and size — never a bare UUID."
      />
      <p className="tabular text-[11px] text-[var(--color-ink-faint)]">
        selected:{' '}
        {selected ? `${selected.name} · ${(selected.sizeBytes / 1024 ** 3).toFixed(1)} GB` : 'none'}
      </p>
    </div>
  );
}

const rootRoute = createRootRoute();
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Picker });
const imagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/images',
  component: () => <p className="text-[12px]">Images page (router target)</p>,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, imagesRoute]),
  history: createMemoryHistory({ initialEntries: ['/'] }),
});

export default function ImagePickerDemo() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

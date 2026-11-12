/** Link, capture, marker, and drawing routes. */

import { AppError, type LinkFilters } from '@netlabor/contract';
import { issueTicket } from '@netlabor/shared';
import type { AppDeps, Implementer } from '../implementer.ts';
import {
  captureStatus,
  clearFilters,
  createLink,
  createMarker,
  deleteLink,
  deleteMarker,
  getFilters,
  getLink,
  listLinks,
  listMarkers,
  resetLink,
  setFilters,
  startCapture,
  stopCapture,
  updateLink,
  updateMarker,
} from '../services/links.ts';
import { getNode } from '../services/nodes.ts';

export function linkRoutes(os: Implementer, deps: AppDeps) {
  const requireUser = (context: { auth: { user: { id: string } | null } }): string => {
    const user = context.auth.user;
    if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
    return user.id;
  };

  return {
    links: {
      list: os.links.list.handler(async ({ input, context }) =>
        listLinks(context.db, input.projectId),
      ),
      get: os.links.get.handler(async ({ input, context }) => getLink(context.db, input.id)),
      create: os.links.create.handler(async ({ input, context }) =>
        createLink(context, requireUser(context), {
          projectId: input.projectId,
          nodeAId: input.nodeAId,
          adapterA: input.adapterA,
          portA: input.portA,
          nodeBId: input.nodeBId,
          adapterB: input.adapterB,
          portB: input.portB,
          ...(input.style ? { style: input.style } : {}),
        }),
      ),
      update: os.links.update.handler(async ({ input, context }) =>
        updateLink(context, requireUser(context), {
          id: input.id,
          ...(input.style ? { style: input.style } : {}),
          ...(input.suspend !== undefined ? { suspend: input.suspend } : {}),
        }),
      ),
      delete: os.links.delete.handler(async ({ input, context }) => {
        await deleteLink(context, requireUser(context), input.id);
        return { ok: true as const };
      }),
      reset: os.links.reset.handler(async ({ input, context }) =>
        resetLink(context, requireUser(context), input.id),
      ),
      filters: {
        get: os.links.filters.get.handler(async ({ input, context }) =>
          getFilters(context, input.linkId),
        ),
        set: os.links.filters.set.handler(async ({ input, context }) =>
          setFilters(context, requireUser(context), input.linkId, input.filters as LinkFilters),
        ),
        clear: os.links.filters.clear.handler(async ({ input, context }) =>
          clearFilters(context, requireUser(context), input.linkId),
        ),
      },
      capture: {
        start: os.links.capture.start.handler(async ({ input, context }) =>
          startCapture(context, input.linkId, input.dlt),
        ),
        stop: os.links.capture.stop.handler(async ({ input, context }) =>
          stopCapture(context, input.linkId),
        ),
        status: os.links.capture.status.handler(async ({ input, context }) =>
          captureStatus(context, input.linkId),
        ),
        ticket: os.links.capture.ticket.handler(async ({ input, context }) => {
          const link = await getLink(context.db, input.linkId);
          const ticket = issueTicket(
            {
              sub: requireUser(context),
              purpose: 'wireshark',
              resourceId: input.linkId,
              projectId: link.projectId,
            },
            deps.config.secretKey,
          );
          return {
            ticket,
            wsUrl: `/ws/wireshark/${input.linkId}?ticket=${encodeURIComponent(ticket)}`,
            pcapUrl: `/api/links/${input.linkId}/capture.pcap`,
          };
        }),
        download: os.links.capture.download.handler(async ({ input, context }) => {
          const link = await getLink(context.db, input.linkId);
          const node = await getNode(context.db, link.nodeAId);
          const state = await captureStatus(context, input.linkId);
          if (!state.path) throw new AppError('NOT_FOUND', 'no capture');
          const token = await context.agents.agentToken(node.computeId);
          const compute = await context.db.unsafe<{ url: string }[]>(
            'SELECT url FROM computes WHERE id = $1',
            [node.computeId],
          );
          const upstream = await fetch(
            `${(compute[0]?.url ?? '').replace(/\/$/, '')}/agent/projects/${link.projectId}/captures/${link.id}.pcap`,
            { headers: token ? { authorization: `Bearer ${token}` } : {} },
          ).catch(() => null);
          if (!upstream?.ok || !upstream.body) {
            throw new AppError('NOT_FOUND', 'capture not available');
          }
          return upstream.body;
        }),
      },
      markers: {
        list: os.links.markers.list.handler(async ({ input, context }) =>
          listMarkers(context, input.linkId),
        ),
        create: os.links.markers.create.handler(async ({ input, context }) =>
          createMarker(context, input),
        ),
        update: os.links.markers.update.handler(async ({ input, context }) =>
          updateMarker(context, {
            id: input.id,
            ...(input.name ? { name: input.name } : {}),
            ...(input.bpf ? { bpf: input.bpf } : {}),
            ...(input.color ? { color: input.color } : {}),
            ...(input.highlightDuration !== undefined
              ? { highlightDuration: input.highlightDuration }
              : {}),
            ...(input.direction !== undefined ? { direction: input.direction } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            ...(input.paused !== undefined ? { paused: input.paused } : {}),
          }),
        ),
        delete: os.links.markers.delete.handler(async ({ input, context }) => {
          await deleteMarker(context, input.id);
          return { ok: true as const };
        }),
        hits: os.links.markers.hits.handler(async ({ input, context }) => {
          const rows = await context.db.unsafe<{ project_id: string }[]>(
            'SELECT project_id FROM links WHERE id = $1',
            [input.linkId],
          );
          const projectId = rows[0]?.project_id;
          if (!projectId) throw new AppError('NOT_FOUND', 'link not found');
          return context.events
            .recentMarkerHits(projectId, 1000)
            .filter((event) => event.payload.linkId === input.linkId)
            .slice(-200)
            .map((event) => event.payload);
        }),
      },
    },
  };
}

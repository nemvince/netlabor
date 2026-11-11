/** Packet analysis routes: tshark-backed frames and the field registry. */

import { AppError } from '@netlabor/contract';
import type { Implementer } from '../implementer.ts';
import { getLink } from '../services/links.ts';
import { getNode } from '../services/nodes.ts';

export function packetRoutes(os: Implementer) {
  return {
    packet: {
      analyze: os.packet.analyze.handler(async ({ input, context }) => {
        const link = await getLink(context.db, input.linkId);
        const node = await getNode(context.db, link.nodeAId);
        return context.agents.call(node.computeId, (agent) =>
          agent.packet.analyze({
            projectId: link.projectId,
            linkId: link.id,
            ...(input.displayFilter ? { displayFilter: input.displayFilter } : {}),
            ...(input.fields ? { fields: input.fields } : {}),
            limit: input.limit,
          }),
        );
      }),
      fields: os.packet.fields.handler(async ({ input, context }) => {
        const computes = await context.db.unsafe<{ id: string }[]>(
          `SELECT id FROM computes WHERE status = 'online' ORDER BY name LIMIT 1`,
        );
        const computeId = computes[0]?.id;
        if (!computeId) throw new AppError('AGENT_UNAVAILABLE', 'no compute is online');
        return context.agents.call(computeId, (agent) =>
          agent.packet.fields({ query: input.query, limit: 50 }),
        );
      }),
    },
  };
}

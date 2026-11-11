import { client } from '../../lib/api.ts';
import type { HistoryAction } from './store.ts';

/**
 * Applies one history entry and returns the entry that performs the opposite
 * operation. Recreated rows receive fresh ids, so the returned action carries
 * the current snapshot instead of the stale one.
 */
export async function applyHistory(
  action: HistoryAction,
  direction: 'undo' | 'redo',
): Promise<HistoryAction> {
  const reverse = direction === 'undo';

  switch (action.kind) {
    case 'node.create': {
      if (reverse) {
        await client.nodes.delete({ id: action.id });
        return action;
      }
      const created = await client.nodes.create(action.input);
      return { ...action, id: created.id };
    }
    case 'node.update': {
      const patch = reverse ? action.before : action.after;
      await client.nodes.update({ ...patch, id: action.id });
      return action;
    }
    case 'node.delete': {
      if (reverse) {
        const created = await client.nodes.create({
          projectId: action.node.projectId,
          ...(action.node.templateId ? { templateId: action.node.templateId } : {}),
          nodeType: action.node.nodeType,
          computeId: action.node.computeId,
          name: action.node.name,
          x: action.node.x,
          y: action.node.y,
          z: action.node.z,
          layer: action.node.layer,
          symbol: action.node.symbol,
          properties: { ...action.node.properties, consoleType: action.node.consoleType },
        });
        const restored = await client.nodes.update({
          id: created.id,
          locked: action.node.locked,
          consoleAutoStart: action.node.consoleAutoStart,
        });
        return { ...action, node: restored };
      }
      await client.nodes.delete({ id: action.node.id });
      return action;
    }
    case 'link.create': {
      if (reverse) {
        await client.links.delete({ id: action.id });
        return action;
      }
      const created = await client.links.create(action.input);
      return { ...action, id: created.id };
    }
    case 'link.delete': {
      if (reverse) {
        const created = await client.links.create({
          projectId: action.link.projectId,
          nodeAId: action.link.nodeAId,
          adapterA: action.link.adapterA,
          portA: action.link.portA,
          nodeBId: action.link.nodeBId,
          adapterB: action.link.adapterB,
          portB: action.link.portB,
          style: action.link.style,
        });
        return { ...action, link: created };
      }
      await client.links.delete({ id: action.link.id });
      return action;
    }
    case 'drawing.create': {
      if (reverse) {
        await client.drawings.delete({ id: action.id });
        return action;
      }
      const created = await client.drawings.create(action.input);
      return { ...action, id: created.id };
    }
    case 'drawing.delete': {
      if (reverse) {
        const created = await client.drawings.create({
          projectId: action.drawing.projectId,
          type: action.drawing.type,
          x: action.drawing.x,
          y: action.drawing.y,
          width: action.drawing.width,
          height: action.drawing.height,
          rotation: action.drawing.rotation,
          z: action.drawing.z,
          layer: action.drawing.layer,
          text: action.drawing.text,
          svg: action.drawing.svg,
          filePath: action.drawing.filePath,
          style: action.drawing.style,
        });
        return { ...action, drawing: created };
      }
      await client.drawings.delete({ id: action.drawing.id });
      return action;
    }
  }
}

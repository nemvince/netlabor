/** Project teardown: stop nodes and links before removing the namespace. */

import type { AgentConfig } from '../config.ts';
import type { ProjectRegistry } from '../state.ts';
import { deleteLinkDataplane } from './link.ts';
import { readNodeSpec, stopNode } from './node.ts';
import { removeProject } from './project.ts';

export interface TeardownDeps {
  config: AgentConfig;
  registry: ProjectRegistry;
}

/** Stop every node, drop link dataplane, then delete the project namespace. */
export async function teardownProject(
  deps: TeardownDeps,
  projectId: string,
  options: { deleteFiles?: boolean } = {},
): Promise<void> {
  const project = deps.registry.get(projectId);
  if (project) {
    for (const node of [...project.nodes.values()]) {
      const spec = await readNodeSpec(deps.config, projectId, node.nodeId);
      if (!spec) continue;
      await stopNode(deps.config, deps.registry, spec).catch(() => undefined);
    }
    for (const link of [...project.links.values()]) {
      await deleteLinkDataplane(deps, projectId, link.linkId).catch(() => undefined);
    }
  }
  await removeProject(deps, projectId, { deleteFiles: options.deleteFiles ?? false });
}

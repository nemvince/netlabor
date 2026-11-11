/**
 * Agent runtime state: projects (namespace + ubridge), node processes, links,
 * captures, and console listeners. The agent owns every privileged object on
 * the host; this registry is the single writer.
 */

import type { AgentProjectMeta } from '@netlabor/contract';
import { netnsName } from '@netlabor/shared';
import type { AgentConfig } from './config.ts';

export interface NodeRuntime {
  nodeId: string;
  projectId: string;
  nodeType: string;
  status: 'stopped' | 'started' | 'suspended' | 'error';
  pid: number | null;
  internalConsolePort: number | null;
  internalVncPort: number | null;
  message: string | null;
  /** Extra runtime data per emulator (QMP socket, container id, ...). */
  extra: Record<string, string>;
}

export interface LinkRuntime {
  linkId: string;
  projectId: string;
  status: 'pending' | 'active' | 'suspended' | 'error';
  mode: 'kernel' | 'relay';
  bridgeName: string | null;
  anchors: string[];
  udpPorts: number[];
  message: string | null;
}

export interface CaptureRuntime {
  linkId: string;
  projectId: string;
  path: string;
  dlt: string;
  startedAt: string;
  mode: 'kernel' | 'relay';
}

export interface ProjectRuntime {
  projectId: string;
  slot: number;
  netns: string;
  projectIp: string;
  ubridgeSocket: string | null;
  ubridgePid: number | null;
  nodes: Map<string, NodeRuntime>;
  links: Map<string, LinkRuntime>;
  captures: Map<string, CaptureRuntime>;
}

export function projectShortId(projectId: string): string {
  return projectId.replaceAll('-', '').slice(0, 10);
}

export function projectIpFor(config: AgentConfig, slot: number): string {
  return `10.99.${config.underlayIndex}.${slot}`;
}

export function hostVethIp(slot: number): string {
  return `169.254.${slot}.1`;
}

export function peerVethIp(slot: number): string {
  return `169.254.${slot}.2`;
}

export class ProjectRegistry {
  private readonly projects = new Map<string, ProjectRuntime>();
  private readonly nodes = new Map<string, NodeRuntime>();
  private readonly internalPorts = new Map<string, number>();
  private readonly vncDisplays = new Map<string, Set<number>>();

  constructor(readonly config: AgentConfig) {}

  get(projectId: string): ProjectRuntime | undefined {
    return this.projects.get(projectId);
  }

  /** Register a project after `ensureProject` created its namespace. */
  register(meta: AgentProjectMeta & { ubridgePid?: number | null }): ProjectRuntime {
    const runtime: ProjectRuntime = {
      projectId: meta.projectId,
      slot: meta.slot,
      netns: meta.netns,
      projectIp: meta.projectIp,
      ubridgeSocket: meta.ubridgeSocket,
      ubridgePid: meta.ubridgePid ?? null,
      nodes: new Map(),
      links: new Map(),
      captures: new Map(),
    };
    this.projects.set(meta.projectId, runtime);
    return runtime;
  }

  /** Re-register a project after an agent restart by reading meta.json. */
  adopt(meta: AgentProjectMeta): ProjectRuntime {
    const existing = this.projects.get(meta.projectId);
    if (existing) return existing;
    return this.register(meta);
  }

  remove(projectId: string): ProjectRuntime | undefined {
    const project = this.projects.get(projectId);
    if (!project) return undefined;
    for (const node of project.nodes.values()) this.nodes.delete(node.nodeId);
    this.projects.delete(projectId);
    return project;
  }

  projectMeta(project: ProjectRuntime): AgentProjectMeta {
    return {
      projectId: project.projectId,
      slot: project.slot,
      netns: project.netns,
      projectIp: project.projectIp,
      ubridgeSocket: project.ubridgeSocket,
    };
  }

  list(): ProjectRuntime[] {
    return [...this.projects.values()];
  }

  node(nodeId: string): NodeRuntime | undefined {
    return this.nodes.get(nodeId);
  }

  trackNode(projectId: string, node: NodeRuntime): void {
    this.nodes.set(node.nodeId, node);
    this.projects.get(projectId)?.nodes.set(node.nodeId, node);
  }

  untrackNode(projectId: string, nodeId: string): void {
    this.nodes.delete(nodeId);
    this.projects.get(projectId)?.nodes.delete(nodeId);
  }

  allNodes(): NodeRuntime[] {
    return [...this.nodes.values()];
  }

  /** Namespace-local port allocator (emulator consoles, internal services). */
  allocateInternalPort(projectId: string, start = 3000): number {
    this.internalPorts.set(projectId, (this.internalPorts.get(projectId) ?? start - 1) + 1);
    return this.internalPorts.get(projectId) as number;
  }

  /** QEMU VNC display number (0-99); proxied through the node console port. */
  allocateVncDisplay(projectId: string): number {
    const used = this.vncDisplays.get(projectId) ?? new Set<number>();
    for (let display = 0; display < 100; display++) {
      if (used.has(display)) continue;
      used.add(display);
      this.vncDisplays.set(projectId, used);
      return display;
    }
    throw new Error('no free VNC display in this project');
  }

  releaseVncDisplay(projectId: string, display: number): void {
    this.vncDisplays.get(projectId)?.delete(display);
  }

  netnsFor(projectId: string): string {
    const project = this.projects.get(projectId);
    return project?.netns ?? netnsName(projectId);
  }
}

/** Agent RPC router: state reporting and project lifecycle. */

import { cp } from 'node:fs/promises';
import {
  type AgentCapabilities,
  type AgentProjectMeta,
  type AgentSnapshot,
  AppError,
  agentRouter,
} from '@netlabor/contract';
import type { Logger } from '@netlabor/shared';
import { implement } from '@orpc/server';
import type { AgentConfig } from './config.ts';
import { execConsole } from './console/exec.ts';
import { closeConsole, openConsole } from './console/proxy.ts';
import {
  deleteNodeFile,
  deleteProjectFile,
  listFiles,
  listNodeFiles,
  readNodeFile,
  readProjectFile,
  writeNodeFile,
  writeProjectFile,
} from './dataplane/files.ts';
import {
  applyFilters,
  applyMarkers,
  captureStatus,
  clearMarkers,
  createLink,
  deleteLink,
  resetLink,
  startCapture,
  stopCapture,
} from './dataplane/link.ts';
import {
  createNode,
  deleteNode,
  readNodeSpec,
  startNode,
  stopNode,
  suspendNode,
} from './dataplane/node.ts';
import { cleanupStaleState, ensureProject, nodeDir } from './dataplane/project.ts';
import { teardownProject } from './dataplane/teardown.ts';
import { buildStatus, cancelBuild, startBuild } from './emulators/appliance-build.ts';
import { dockerClientFor } from './emulators/docker.ts';
import { idlepcProposalsForImage, setIdlepc } from './emulators/dynamips.ts';
import { createDiskImage, deleteDiskImage, resizeDiskImage } from './emulators/qemu.ts';
import type { AgentEvents } from './events.ts';
import { listNetlaborBridges, listNetns } from './netns/netns.ts';
import { collectStats } from './services/stats.ts';
import type { ProjectRegistry } from './state.ts';
import { deleteImage, ensureImage, listImages } from './storage/images.ts';
import { analyzeCapture, searchFields } from './wireshark/analyze.ts';

export interface AgentContext {
  config: AgentConfig;
  registry: ProjectRegistry;
  markers: import('./markers/watcher.ts').MarkerWatcher;
  events: AgentEvents;
  logger: Logger;
  startedAt: string;
  capabilities: AgentCapabilities;
  onCaptureStopped?: (projectId: string, linkId: string) => void;
}

export function createAgentRouter(ctx: AgentContext) {
  const os = implement(agentRouter);
  const deps = {
    config: ctx.config,
    registry: ctx.registry,
    markers: ctx.markers,
    logger: ctx.logger,
    onMarkerHit: (hit: import('./markers/sink.ts').MarkerHit) => {
      ctx.events.emit({
        type: 'agent.marker.hit',
        projectId: hit.projectId,
        linkId: hit.linkId,
        payload: {
          projectId: hit.projectId,
          linkId: hit.linkId,
          name: hit.filter,
          tag: hit.tag,
          direction: hit.direction,
          length: hit.length,
          ts: hit.ts,
        },
      });
    },
  };

  return {
    info: os.info.handler(() => ({
      version: ctx.config.version,
      apiVersion: '1',
      hostname: Bun.env.HOSTNAME ?? 'unknown',
      underlayIndex: ctx.config.underlayIndex,
      underlayHost: ctx.config.underlayHost,
      startedAt: ctx.startedAt,
    })),

    capabilities: os.capabilities.handler(() => ctx.capabilities),

    state: os.state.handler(async () => {
      const projects: AgentProjectMeta[] = ctx.registry
        .list()
        .map((project) => ctx.registry.projectMeta(project));
      const nodes = ctx.registry.allNodes().map((node) => ({
        nodeId: node.nodeId,
        projectId: node.projectId,
        status: node.status,
        pid: node.pid,
      }));
      const links = ctx.registry
        .list()
        .flatMap((project) => [...project.links.values()])
        .map((link) => ({ linkId: link.linkId, projectId: link.projectId, status: link.status }));
      const captures = ctx.registry
        .list()
        .flatMap((project) => [...project.captures.values()])
        .map((capture) => ({
          linkId: capture.linkId,
          projectId: capture.projectId,
          path: capture.path,
          sizeBytes: 0,
          dlt: capture.dlt,
        }));
      const snapshot: AgentSnapshot = {
        projects,
        nodes,
        links,
        captures,
        namespaces: await listNetns(),
        bridges: await listNetlaborBridges(),
        ubridgeProcesses: ctx.registry.list().flatMap((project) =>
          project.ubridgePid && project.ubridgeSocket
            ? [
                {
                  pid: project.ubridgePid,
                  projectId: project.projectId,
                  socket: project.ubridgeSocket,
                },
              ]
            : [],
        ),
      };
      return snapshot;
    }),

    heartbeat: os.heartbeat.handler(() => {
      const projects = ctx.registry.list();
      const nodes = ctx.registry.allNodes();
      return {
        status: 'online' as const,
        nodeCount: nodes.length,
        runningNodeCount: nodes.filter((node) => node.status === 'started').length,
        linkCount: projects.reduce((sum, project) => sum + project.links.size, 0),
        captureCount: projects.reduce((sum, project) => sum + project.captures.size, 0),
        sharkdSessions: 0,
        at: new Date().toISOString(),
      };
    }),

    stats: os.stats.handler(async () => collectStats(ctx.config, ctx.registry)),

    projectFiles: {
      list: os.projectFiles.list.handler(async ({ input }) =>
        listFiles(ctx.config, input.projectId, input.path),
      ),
      read: os.projectFiles.read.handler(async ({ input }) =>
        readProjectFile(ctx.config, input.projectId, input.path, input.encoding),
      ),
      write: os.projectFiles.write.handler(async ({ input }) =>
        writeProjectFile(ctx.config, input.projectId, input.path, input.content, input.encoding),
      ),
      delete: os.projectFiles.delete.handler(async ({ input }) => {
        await deleteProjectFile(ctx.config, input.projectId, input.path);
        return { ok: true as const };
      }),
    },

    nodeFiles: {
      list: os.nodeFiles.list.handler(async ({ input }) =>
        listNodeFiles(ctx.config, input.projectId, input.nodeId, input.path),
      ),
      read: os.nodeFiles.read.handler(async ({ input }) =>
        readNodeFile(ctx.config, input.projectId, input.nodeId, input.path),
      ),
      write: os.nodeFiles.write.handler(async ({ input }) =>
        writeNodeFile(ctx.config, input.projectId, input.nodeId, input.path, input.content),
      ),
      delete: os.nodeFiles.delete.handler(async ({ input }) => {
        await deleteNodeFile(ctx.config, input.projectId, input.nodeId, input.path);
        return { ok: true as const };
      }),
    },

    createNode: os.createNode.handler(async ({ input }) => {
      const status = await createNode(ctx.config, ctx.registry, input);
      ctx.events.emit({
        type: 'agent.node.created',
        projectId: input.projectId,
        nodeId: input.nodeId,
        payload: {},
      });
      return status;
    }),

    updateNode: os.updateNode.handler(async ({ input }) => {
      const existing = ctx.registry.node(input.spec.nodeId);
      if (input.requireStopped && existing?.status === 'started') {
        throw new AppError('NODE_BUSY', 'stop the node before changing these properties');
      }
      const status = await createNode(ctx.config, ctx.registry, input.spec);
      ctx.events.emit({
        type: 'agent.node.updated',
        projectId: input.spec.projectId,
        nodeId: input.spec.nodeId,
        payload: {},
      });
      return status;
    }),

    deleteNode: os.deleteNode.handler(async ({ input }) => {
      await deleteNode(ctx.config, ctx.registry, input.projectId, input.nodeId);
      ctx.events.emit({
        type: 'agent.node.deleted',
        projectId: input.projectId,
        nodeId: input.nodeId,
        payload: {},
      });
      return { ok: true as const };
    }),

    startNode: os.startNode.handler(async ({ input }) => {
      const status = await startNode(ctx.config, ctx.registry, input, (nodeId, port) => {
        ctx.events.emit({
          type: 'agent.node.status',
          projectId: input.projectId,
          nodeId,
          payload: { status: 'started', consolePort: port },
        });
      });
      ctx.events.emit({
        type: 'agent.node.status',
        projectId: input.projectId,
        nodeId: input.nodeId,
        payload: { status: status.status },
      });
      return status;
    }),

    stopNode: os.stopNode.handler(async ({ input }) => {
      const spec = await readNodeSpec(ctx.config, input.projectId, input.nodeId);
      if (!spec) {
        return {
          nodeId: input.nodeId,
          status: 'stopped' as const,
          pid: null,
          internalConsolePort: null,
          internalVncPort: null,
          message: null,
        };
      }
      const status = await stopNode(ctx.config, ctx.registry, spec);
      ctx.events.emit({
        type: 'agent.node.status',
        projectId: input.projectId,
        nodeId: input.nodeId,
        payload: { status: 'stopped' },
      });
      return status;
    }),

    suspendNode: os.suspendNode.handler(async ({ input }) => {
      const spec = await readNodeSpec(ctx.config, input.projectId, input.nodeId);
      if (!spec) throw new AppError('NOT_FOUND', 'node not found on this agent');
      return suspendNode(ctx.config, ctx.registry, spec);
    }),

    reloadNode: os.reloadNode.handler(async ({ input }) => {
      const spec = (await readNodeSpec(ctx.config, input.projectId, input.nodeId)) ?? input;
      await stopNode(ctx.config, ctx.registry, spec);
      return startNode(ctx.config, ctx.registry, spec);
    }),

    image: {
      ensure: os.image.ensure.handler(async ({ input }) => {
        const replica = await ensureImage(ctx.config, input);
        ctx.events.emit({
          type: 'agent.image.ensured',
          payload: {
            sha256: replica.sha256,
            filename: replica.filename,
            path: replica.path,
            sizeBytes: replica.sizeBytes,
          },
        });
        return replica;
      }),
      list: os.image.list.handler(async () => listImages(ctx.config)),
      delete: os.image.delete.handler(async ({ input }) => {
        await deleteImage(ctx.config, input.sha256);
        ctx.events.emit({ type: 'agent.image.removed', payload: { sha256: input.sha256 } });
        return { ok: true as const };
      }),
    },

    applianceBuilds: {
      start: os.applianceBuilds.start.handler(async ({ input }) =>
        startBuild({ config: ctx.config, logger: ctx.logger }, input),
      ),
      status: os.applianceBuilds.status.handler(async ({ input }) =>
        buildStatus({ config: ctx.config, logger: ctx.logger }, input.buildId),
      ),
      cancel: os.applianceBuilds.cancel.handler(async ({ input }) =>
        cancelBuild({ config: ctx.config, logger: ctx.logger }, input.buildId),
      ),
    },

    duplicateNode: os.duplicateNode.handler(async ({ input }) => {
      const source = nodeDir(ctx.config, input.projectId, input.nodeId);
      const target = nodeDir(ctx.config, input.projectId, input.targetNodeId);
      await cp(source, target, { recursive: true });
      return { ok: true as const };
    }),

    resetConsole: os.resetConsole.handler(async ({ input }) => {
      const node = ctx.registry.node(input.nodeId);
      const project = ctx.registry.get(input.projectId);
      const spec = await readNodeSpec(ctx.config, input.projectId, input.nodeId);
      if (!node || !project || !spec)
        throw new AppError('NOT_FOUND', 'node not found on this agent');
      if (
        spec.console.type === 'telnet' &&
        spec.console.externalPort !== null &&
        node.internalConsolePort
      ) {
        await closeConsole(input.nodeId);
        await openConsole({
          nodeId: input.nodeId,
          externalPort: spec.console.externalPort,
          projectIp: project.projectIp,
          internalPort: node.internalConsolePort,
        });
      }
      return { ok: true as const };
    }),

    qemu: {
      diskImage: {
        create: os.qemu.diskImage.create.handler(async ({ input }) =>
          createDiskImage({
            config: ctx.config,
            registry: ctx.registry,
            projectId: input.projectId,
            nodeId: input.nodeId,
            disk: input.disk,
            sizeBytes: input.sizeBytes,
            backingImagePath: input.backingImagePath ?? null,
          }),
        ),
        delete: os.qemu.diskImage.delete.handler(async ({ input }) => {
          await deleteDiskImage({
            config: ctx.config,
            registry: ctx.registry,
            projectId: input.projectId,
            nodeId: input.nodeId,
            disk: input.disk,
          });
          return { ok: true as const };
        }),
        resize: os.qemu.diskImage.resize.handler(async ({ input }) =>
          resizeDiskImage({
            config: ctx.config,
            registry: ctx.registry,
            projectId: input.projectId,
            nodeId: input.nodeId,
            disk: input.disk,
            sizeBytes: input.sizeBytes,
          }),
        ),
      },
    },

    docker: {
      images: {
        list: os.docker.images.list.handler(async () => {
          const client = dockerClientFor(ctx.config);
          const images = await client.listImages();
          return images.map((image) => ({
            id: image.Id,
            tags: image.RepoTags ?? [],
            sizeBytes: image.Size,
            createdAt: new Date(image.Created * 1000).toISOString(),
          }));
        }),
        pull: os.docker.images.pull.handler(async ({ input }) => {
          const client = dockerClientFor(ctx.config);
          await client.pullImage(input.image, (message) => {
            ctx.events.emit({
              type: 'agent.docker.pull',
              payload: { image: input.image, message },
            });
          });
          return { ok: true as const };
        }),
      },
    },

    dynamips: {
      idlepcProposals: os.dynamips.idlepcProposals.handler(async ({ input }) =>
        idlepcProposalsForImage({
          imagePath: input.imagePath,
          platform: input.platform,
          count: input.count,
          runDir: ctx.config.runDir,
        }),
      ),
      setIdlepc: os.dynamips.setIdlepc.handler(async ({ input }) => {
        const node = ctx.registry.node(input.nodeId);
        if (!node) throw new AppError('NOT_FOUND', 'node not found on this agent');
        await setIdlepc(ctx.registry, input.projectId, node.nodeId, input.idlepc);
        return { ok: true as const };
      }),
    },

    packet: {
      analyze: os.packet.analyze.handler(async ({ input }) =>
        analyzeCapture({
          config: ctx.config,
          projectId: input.projectId,
          linkId: input.linkId,
          ...(input.displayFilter ? { displayFilter: input.displayFilter } : {}),
          ...(input.fields ? { fields: input.fields } : {}),
          limit: input.limit,
        }),
      ),
      fields: os.packet.fields.handler(async ({ input }) => searchFields(input.query, input.limit)),
    },

    execConsole: os.execConsole.handler(async ({ input }) =>
      execConsole(
        ctx.registry,
        {
          projectId: input.projectId,
          nodeId: input.nodeId,
          commands: input.commands,
          timeoutMs: input.timeoutMs,
          prompt: input.prompt ?? null,
        },
        ctx.config.dockerSocket,
      ),
    ),

    createLink: os.createLink.handler(async ({ input }) => {
      const state = await createLink(deps, input);
      ctx.events.emit({
        type: 'agent.link.status',
        projectId: input.projectId,
        linkId: input.linkId,
        payload: { status: state.status },
      });
      return state;
    }),

    updateLink: os.updateLink.handler(async ({ input }) => {
      const state = await resetLink(deps, input);
      ctx.events.emit({
        type: 'agent.link.status',
        projectId: input.projectId,
        linkId: input.linkId,
        payload: { status: state.status },
      });
      return state;
    }),

    deleteLink: os.deleteLink.handler(async ({ input }) => {
      await deleteLink(deps, input.projectId, input.linkId);
      ctx.events.emit({
        type: 'agent.link.deleted',
        projectId: input.projectId,
        linkId: input.linkId,
        payload: {},
      });
      return { ok: true as const };
    }),

    resetLink: os.resetLink.handler(async ({ input }) => resetLink(deps, input)),

    applyFilters: os.applyFilters.handler(async ({ input }) => {
      await applyFilters(deps, { ...input.spec, filters: input.filters });
      return { ok: true as const };
    }),

    applyMarkers: os.applyMarkers.handler(async ({ input }) => {
      await applyMarkers(deps, input);
      return { ok: true as const };
    }),

    clearMarkers: os.clearMarkers.handler(async ({ input }) => {
      await clearMarkers(deps, input.projectId, input.linkId);
      return { ok: true as const };
    }),

    startCapture: os.startCapture.handler(async ({ input }) => {
      const state = await startCapture(deps, {
        linkId: input.linkId,
        projectId: input.projectId,
        mode: input.mode,
        dlt: input.dlt,
      });
      ctx.events.emit({
        type: 'agent.capture.started',
        projectId: input.projectId,
        linkId: input.linkId,
        payload: { path: state.path },
      });
      return state;
    }),

    stopCapture: os.stopCapture.handler(async ({ input }) => {
      const state = await stopCapture(deps, input.projectId, input.linkId);
      ctx.onCaptureStopped?.(input.projectId, input.linkId);
      ctx.events.emit({
        type: 'agent.capture.stopped',
        projectId: input.projectId,
        linkId: input.linkId,
        payload: {},
      });
      return state;
    }),

    captureStatus: os.captureStatus.handler(async ({ input }) =>
      captureStatus(deps, input.projectId, input.linkId),
    ),

    ensureProject: os.ensureProject.handler(async ({ input }) => {
      const meta = await ensureProject(deps, input.projectId, input.slot, input.markerPort);
      ctx.events.emit({
        type: 'agent.project.ready',
        projectId: input.projectId,
        payload: { netns: meta.netns },
      });
      return meta;
    }),

    removeProject: os.removeProject.handler(async ({ input }) => {
      await teardownProject(deps, input.projectId, { deleteFiles: input.deleteFiles });
      ctx.events.emit({ type: 'agent.project.removed', projectId: input.projectId, payload: {} });
      return { ok: true as const };
    }),

    events: os.events.handler(async function* ({ input, signal }) {
      for await (const event of ctx.events.stream(signal)) {
        if (input.projectId && event.projectId && event.projectId !== input.projectId) continue;
        yield event;
      }
    }),
  };
}

export async function startupCleanup(config: AgentConfig, logger: Logger): Promise<void> {
  const result = await cleanupStaleState(config);
  logger.info('stale dataplane objects removed', result);
}

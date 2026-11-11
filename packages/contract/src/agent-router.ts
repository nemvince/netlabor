/**
 * Controller → agent contract. The controller is the only client. Every
 * procedure except `info` requires the compute bearer token.
 */

import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { Id, Ok, Timestamp } from './schemas/common.ts';
import { AgentCapabilities as AgentCapabilitiesSchema } from './schemas/computes.ts';
import { PacketAnalyzeOutput, PacketFieldRow } from './schemas/misc.ts';

/** Describes where an agent should obtain an image blob from. */
export const ImageSource = z.union([
  z.object({ type: z.literal('controller'), url: z.string(), token: z.string() }),
  z.object({ type: z.literal('peer'), url: z.string(), token: z.string() }),
  z.object({ type: z.literal('nfs') }),
  z.object({ type: z.literal('present') }),
]);
export type ImageSource = z.infer<typeof ImageSource>;

export type AgentInfo = z.infer<typeof AgentInfo>;

export const AgentInfo = z.object({
  version: z.string(),
  apiVersion: z.string(),
  hostname: z.string(),
  underlayIndex: z.number().int(),
  underlayHost: z.string(),
  startedAt: Timestamp,
});

export const AgentProjectMeta = z.object({
  projectId: Id,
  slot: z.number().int(),
  netns: z.string(),
  projectIp: z.string(),
  ubridgeSocket: z.string().nullable(),
});

export type AgentProjectMeta = z.infer<typeof AgentProjectMeta>;

export const AgentAnchor = z.object({
  kind: z.enum(['tap', 'veth', 'udp', 'none']),
  name: z.string().nullable(),
  mac: z.string().nullable().optional(),
});

export type AgentPortSpec = z.infer<typeof AgentPortSpec>;

export const AgentPortSpec = z.object({
  adapter: z.number().int(),
  port: z.number().int(),
  anchor: AgentAnchor,
  laneType: z.enum(['ethernet', 'serial', 'atm', 'frame_relay']),
  udp: z
    .object({ lport: z.number().int(), rhost: z.string(), rport: z.number().int() })
    .nullable()
    .optional(),
  vlan: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type AgentNodeSpec = z.infer<typeof AgentNodeSpec>;

export const AgentNodeSpec = z.object({
  nodeId: Id,
  projectId: Id,
  computeId: Id,
  name: z.string(),
  nodeType: z.string(),
  templateId: Id.nullable(),
  properties: z.record(z.string(), z.unknown()),
  ports: z.array(AgentPortSpec),
  console: z.object({
    type: z.enum(['telnet', 'none', 'vnc', 'http', 'https']),
    externalPort: z.number().int().nullable(),
    auxExternalPort: z.number().int().nullable().optional(),
  }),
  applicationId: z.number().int().nullable(),
  images: z.record(z.string(), z.string()).default({}),
});

export type AgentNodeStatus = z.infer<typeof AgentNodeStatus>;

export const AgentNodeStatus = z.object({
  nodeId: Id,
  status: z.enum(['stopped', 'started', 'suspended', 'error']),
  pid: z.number().int().nullable(),
  internalConsolePort: z.number().int().nullable(),
  internalVncPort: z.number().int().nullable(),
  message: z.string().nullable(),
});

export type AgentLinkSpec = z.infer<typeof AgentLinkSpec>;

export const AgentLinkSpec = z.object({
  linkId: Id,
  projectId: Id,
  mode: z.enum(['kernel', 'relay']),
  captureNodeId: Id.nullable(),
  filterSide: Id.nullable(),
  laneType: z.enum(['ethernet', 'serial', 'atm', 'frame_relay']),
  endpoints: z.array(
    z.object({
      computeId: Id,
      nodeId: Id,
      nodeType: z.string().optional(),
      /** Kernel interface inside the project namespace, if any. */
      anchor: AgentAnchor,
      /** ubridge UDP NIO for this endpoint (relay mode). */
      udp: z
        .object({ lport: z.number().int(), rhost: z.string(), rport: z.number().int() })
        .nullable()
        .optional(),
      /** Socket parameters handed to a UDP-based emulator (VPCS, Dynamips). */
      emulatorUdp: z
        .object({
          localPort: z.number().int(),
          remotePort: z.number().int(),
          remoteHost: z.string(),
        })
        .nullable()
        .optional(),
    }),
  ),
  peer: z
    .object({
      computeId: Id,
      projectIp: z.string(),
      port: z.number().int(),
      localPort: z.number().int(),
    })
    .nullable(),
  filters: z.record(z.string(), z.unknown()).default({}),
  markers: z
    .array(
      z.object({
        id: Id,
        name: z.string(),
        bpf: z.string(),
        tag: z.number().int(),
        direction: z.enum(['tx', 'rx']).nullable(),
        pcapPath: z.string(),
      }),
    )
    .default([]),
});

export type AgentLinkState = z.infer<typeof AgentLinkState>;

export const AgentLinkState = z.object({
  linkId: Id,
  status: z.enum(['pending', 'active', 'suspended', 'error']),
  message: z.string().nullable(),
});

export type AgentCaptureSpec = z.infer<typeof AgentCaptureSpec>;

export const AgentCaptureSpec = z.object({
  linkId: Id,
  projectId: Id,
  mode: z.enum(['kernel', 'relay']),
  anchor: AgentAnchor,
  path: z.string(),
  dlt: z.string(),
});

export const AgentStateNode = z.object({
  nodeId: Id,
  projectId: Id,
  status: z.enum(['stopped', 'started', 'suspended', 'error']),
  pid: z.number().int().nullable(),
});

export const AgentStateLink = z.object({
  linkId: Id,
  projectId: Id,
  status: z.enum(['pending', 'active', 'suspended', 'error']),
});

export type AgentSnapshot = z.infer<typeof AgentSnapshot>;

export const AgentSnapshot = z.object({
  projects: z.array(AgentProjectMeta),
  nodes: z.array(AgentStateNode),
  links: z.array(AgentStateLink),
  captures: z.array(
    z.object({
      linkId: Id,
      projectId: Id,
      path: z.string(),
      sizeBytes: z.number(),
      dlt: z.string(),
    }),
  ),
  namespaces: z.array(z.string()),
  bridges: z.array(z.string()),
  ubridgeProcesses: z.array(
    z.object({ pid: z.number().int(), projectId: Id, socket: z.string().nullable() }),
  ),
});

export type AgentStats = z.infer<typeof AgentStats>;

export const AgentStats = z.object({
  underlayHost: z.string(),
  cpuCount: z.number().int(),
  loadAverage: z.tuple([z.number(), z.number(), z.number()]),
  memoryTotalBytes: z.number(),
  memoryUsedBytes: z.number(),
  diskTotalBytes: z.number(),
  diskUsedBytes: z.number(),
  processCount: z.number().int(),
  uptimeSeconds: z.number(),
  processes: z.array(
    z.object({
      pid: z.number().int(),
      name: z.string(),
      nodeId: Id.nullable(),
      cpuPercent: z.number(),
      memoryBytes: z.number(),
    }),
  ),
  collectedAt: Timestamp,
});

export type AgentHeartbeat = z.infer<typeof AgentHeartbeat>;

export const AgentHeartbeat = z.object({
  status: z.enum(['online', 'error']),
  nodeCount: z.number().int(),
  runningNodeCount: z.number().int(),
  linkCount: z.number().int(),
  captureCount: z.number().int(),
  sharkdSessions: z.number().int(),
  at: Timestamp,
});

/** Agent event envelope: hints only, no replay buffer. */
export const AgentEvent = z.object({
  type: z.string(),
  projectId: Id.nullable().optional(),
  nodeId: Id.nullable().optional(),
  linkId: Id.nullable().optional(),
  ts: Timestamp,
  payload: z.record(z.string(), z.unknown()),
});
export type AgentEvent = z.infer<typeof AgentEvent>;

const base = oc;

function proc(summary: string) {
  return base.meta({ summarize: summary });
}

/* ----------------------------------------------------- appliance builds --- */

/** One provisioning run: boot the base image online, install, power off. */
export const ApplianceBuildSpec = z.object({
  buildId: Id,
  /** Name of the qcow2 artifact written into the image store. */
  artifactName: z.string().min(1).max(200),
  /** Base cloud image already replicated on this compute. */
  base: z.object({ sha256: z.string(), filename: z.string() }),
  diskGb: z.number().int().min(2).max(400),
  memoryMb: z.number().int().min(512).max(131072),
  cpus: z.number().int().min(1).max(64),
  /** Complete cloud-init user-data; the controller composes the recipe. */
  userData: z.string().min(1),
  metaData: z.string().default(''),
  networkConfig: z.string().optional(),
});
export type ApplianceBuildSpec = z.infer<typeof ApplianceBuildSpec>;

export const ApplianceBuildStartOutput = z.object({ buildId: Id, workspace: z.string() });
export type ApplianceBuildStartOutput = z.infer<typeof ApplianceBuildStartOutput>;

export const ApplianceBuildArtifact = z.object({
  sha256: z.string(),
  filename: z.string(),
  sizeBytes: z.number(),
});
export type ApplianceBuildArtifact = z.infer<typeof ApplianceBuildArtifact>;

export const ApplianceBuildStatusOutput = z.object({
  buildId: Id,
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  /** 0..1 provisioning scale steps reported by the build script. */
  progress: z.number(),
  message: z.string().nullable(),
  /** Tail of the build console log, newest last. */
  log: z.string().nullable(),
  artifact: ApplianceBuildArtifact.nullable(),
  error: z.string().nullable(),
});
export type ApplianceBuildStatusOutput = z.infer<typeof ApplianceBuildStatusOutput>;

export const agentRouter = {
  info: proc('Agent version, host identity, and underlay assignment')
    .input(z.object({}))
    .output(AgentInfo),

  capabilities: proc('Detected emulator binaries and kernel dataplane support')
    .input(z.object({}))
    .output(AgentCapabilitiesSchema),

  state: proc('Actual namespaces, processes, bridges, links, and captures')
    .input(z.object({}))
    .output(AgentSnapshot),

  heartbeat: proc('Periodic liveness call with counters')
    .input(z.object({}))
    .output(AgentHeartbeat),

  stats: proc('CPU, memory, disk, load, and per-process usage')
    .input(z.object({}))
    .output(AgentStats),

  ensureProject: proc('Create the project namespace, uplink, ubridge, and directories')
    .input(
      z.object({
        projectId: Id,
        slot: z.number().int().min(1).max(254),
        markerPort: z.number().int().min(40000).max(44999).nullable().default(null),
      }),
    )
    .output(AgentProjectMeta),

  removeProject: proc('Stop nodes, delete links and namespace, optionally keep files')
    .input(z.object({ projectId: Id, deleteFiles: z.boolean().default(false) }))
    .output(Ok),

  createNode: proc('Validate, write files, bind ports, and create a node without starting it')
    .input(AgentNodeSpec)
    .output(AgentNodeStatus),

  updateNode: proc('Apply node property changes')
    .input(z.object({ spec: AgentNodeSpec, requireStopped: z.boolean().default(false) }))
    .output(AgentNodeStatus),

  deleteNode: proc('Stop the node and delete its working directory')
    .input(z.object({ projectId: Id, nodeId: Id }))
    .output(Ok),
  startNode: proc('Prepare anchors, start the emulator, and start the console proxy')
    .input(AgentNodeSpec)
    .output(AgentNodeStatus),
  stopNode: proc('Stop the emulator and remove anchors')
    .input(z.object({ projectId: Id, nodeId: Id }))
    .output(AgentNodeStatus),
  suspendNode: proc('Suspend a QEMU or Dynamips node')
    .input(z.object({ projectId: Id, nodeId: Id }))
    .output(AgentNodeStatus),
  reloadNode: proc('Stop then start a node').input(AgentNodeSpec).output(AgentNodeStatus),
  duplicateNode: proc('Copy a node working directory to a new node ID')
    .input(z.object({ projectId: Id, nodeId: Id, targetNodeId: Id }))
    .output(Ok),

  projectFiles: {
    list: proc('List files in a project directory')
      .input(z.object({ projectId: Id, path: z.string().default('') }))
      .output(
        z.array(
          z.object({
            path: z.string(),
            sizeBytes: z.number(),
            mtime: z.string(),
            directory: z.boolean(),
          }),
        ),
      ),
    read: proc('Read a project file')
      .input(
        z.object({
          projectId: Id,
          path: z.string().min(1),
          /** When 'base64', content returns as base64 of the raw bytes. */
          encoding: z.enum(['base64']).optional(),
        }),
      )
      .output(z.object({ path: z.string(), content: z.string(), sizeBytes: z.number() })),
    write: proc('Write a project file')
      .input(
        z.object({
          projectId: Id,
          path: z.string().min(1),
          content: z.string(),
          /** When 'base64', content decodes to raw bytes; text otherwise. */
          encoding: z.enum(['base64']).optional(),
        }),
      )
      .output(z.object({ path: z.string(), content: z.string(), sizeBytes: z.number() })),
    delete: proc('Delete a project file')
      .input(z.object({ projectId: Id, path: z.string().min(1) }))
      .output(Ok),
  },

  nodeFiles: {
    list: proc('List files in a node directory')
      .input(z.object({ projectId: Id, nodeId: Id, path: z.string().default('') }))
      .output(
        z.array(
          z.object({
            path: z.string(),
            sizeBytes: z.number(),
            mtime: z.string(),
            directory: z.boolean(),
          }),
        ),
      ),
    read: proc('Read a node file')
      .input(z.object({ projectId: Id, nodeId: Id, path: z.string().min(1) }))
      .output(z.object({ path: z.string(), content: z.string(), sizeBytes: z.number() })),
    write: proc('Write a node file')
      .input(z.object({ projectId: Id, nodeId: Id, path: z.string().min(1), content: z.string() }))
      .output(z.object({ path: z.string(), content: z.string(), sizeBytes: z.number() })),
    delete: proc('Delete a node file')
      .input(z.object({ projectId: Id, nodeId: Id, path: z.string().min(1) }))
      .output(Ok),
  },

  createLink: proc('Create a kernel or relay link, optionally with a peer')
    .input(AgentLinkSpec)
    .output(AgentLinkState),
  updateLink: proc('Change dataplane properties of a link')
    .input(AgentLinkSpec)
    .output(AgentLinkState),
  deleteLink: proc('Remove bridges, filters, captures, and markers')
    .input(z.object({ projectId: Id, linkId: Id }))
    .output(Ok),
  resetLink: proc('Recreate a link dataplane without dropping endpoints')
    .input(AgentLinkSpec)
    .output(AgentLinkState),
  applyFilters: proc('Apply or clear impairment on a link')
    .input(z.object({ spec: AgentLinkSpec, filters: z.record(z.string(), z.unknown()) }))
    .output(Ok),
  applyMarkers: proc('Program ubridge packet markers').input(AgentLinkSpec).output(Ok),
  clearMarkers: proc('Remove programmed packet markers')
    .input(z.object({ projectId: Id, linkId: Id }))
    .output(Ok),

  startCapture: proc('Start a pcap capture')
    .input(AgentCaptureSpec)
    .output(z.object({ path: z.string(), dlt: z.string(), active: z.boolean() })),
  stopCapture: proc('Stop a pcap capture')
    .input(z.object({ projectId: Id, linkId: Id }))
    .output(z.object({ path: z.string(), sizeBytes: z.number(), active: z.boolean() })),
  captureStatus: proc('Read capture state')
    .input(z.object({ projectId: Id, linkId: Id }))
    .output(
      z.object({
        active: z.boolean(),
        path: z.string(),
        sizeBytes: z.number(),
        dlt: z.string(),
      }),
    ),

  resetConsole: proc('Recreate the console listener for a node')
    .input(z.object({ projectId: Id, nodeId: Id }))
    .output(Ok),

  execConsole: proc('Send console commands and return the transcript')
    .input(
      z.object({
        projectId: Id,
        nodeId: Id,
        commands: z.array(z.string()).min(1),
        timeoutMs: z.number().int().default(15_000),
        terminalLengthZero: z.boolean().default(true),
        prompt: z.string().nullable().optional(),
      }),
    )
    .output(z.object({ transcript: z.string(), ok: z.boolean(), timedOut: z.boolean() })),

  qemu: {
    diskImage: {
      create: proc('Create a qcow2 disk image')
        .input(
          z.object({
            projectId: Id,
            nodeId: Id,
            disk: z.string(),
            sizeBytes: z.number().int(),
            backingImagePath: z.string().nullable().optional(),
          }),
        )
        .output(z.object({ path: z.string(), sizeBytes: z.number() })),
      delete: proc('Delete a disk image')
        .input(z.object({ projectId: Id, nodeId: Id, disk: z.string() }))
        .output(Ok),
      resize: proc('Resize a disk image')
        .input(
          z.object({ projectId: Id, nodeId: Id, disk: z.string(), sizeBytes: z.number().int() }),
        )
        .output(z.object({ path: z.string(), sizeBytes: z.number() })),
    },
  },

  dynamips: {
    idlepcProposals: proc('Collect idle-PC proposals for a platform')
      .input(
        z.object({
          imagePath: z.string(),
          platform: z.string(),
          count: z.number().int().default(10),
        }),
      )
      .output(
        z.array(
          z.object({ idlepc: z.string(), score: z.number(), description: z.string().optional() }),
        ),
      ),
    setIdlepc: proc('Apply an idle-PC value to a running node')
      .input(z.object({ projectId: Id, nodeId: Id, idlepc: z.string() }))
      .output(Ok),
  },

  docker: {
    images: {
      list: proc('List Docker images')
        .input(z.object({}))
        .output(
          z.array(
            z.object({
              id: z.string(),
              tags: z.array(z.string()),
              sizeBytes: z.number(),
              createdAt: z.string(),
            }),
          ),
        ),
      pull: proc('Pull a Docker image')
        .input(z.object({ image: z.string(), jobId: Id.optional() }))
        .output(Ok),
    },
  },

  image: {
    ensure: proc('Ensure an image is present from the controller, a peer, or NFS')
      .input(
        z.object({
          sha256: z.string(),
          filename: z.string(),
          source: ImageSource,
          jobId: Id.optional(),
        }),
      )
      .output(z.object({ path: z.string(), sha256: z.string(), sizeBytes: z.number() })),
    list: proc('List image replicas on this compute')
      .input(z.object({}))
      .output(
        z.array(
          z.object({
            sha256: z.string(),
            filename: z.string(),
            path: z.string(),
            sizeBytes: z.number(),
          }),
        ),
      ),
    delete: proc('Delete an image replica')
      .input(z.object({ sha256: z.string() }))
      .output(Ok),
  },

  applianceBuilds: {
    start: proc('Boot a throwaway VM that provisions an appliance image')
      .input(ApplianceBuildSpec)
      .output(ApplianceBuildStartOutput),
    status: proc('Read build progress and the produced artifact')
      .input(z.object({ buildId: Id }))
      .output(ApplianceBuildStatusOutput),
    cancel: proc('Cancel a running build and drop its workspace')
      .input(z.object({ buildId: Id }))
      .output(Ok),
  },

  cloudInterfaces: proc('List host interfaces allowed for Cloud nodes')
    .input(z.object({}))
    .output(
      z.array(z.object({ name: z.string(), kind: z.string(), addresses: z.array(z.string()) })),
    ),

  packet: {
    analyze: proc('Analyze a link capture with tshark')
      .input(
        z.object({
          projectId: Id,
          linkId: Id,
          displayFilter: z.string().optional(),
          fields: z.array(z.string()).optional(),
          limit: z.number().int().min(1).max(2000).default(200),
        }),
      )
      .output(PacketAnalyzeOutput),
    fields: proc('Search the tshark field registry')
      .input(z.object({ query: z.string().default(''), limit: z.number().int().default(50) }))
      .output(z.array(PacketFieldRow)),
  },

  events: proc('Stream agent status, logs, marker hits, and job progress')
    .input(z.object({ projectId: Id.optional() }))
    .output(eventIterator(AgentEvent)),
};

export type AgentRouter = typeof agentRouter;

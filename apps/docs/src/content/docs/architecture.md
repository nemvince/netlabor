---
title: Architecture
description: Processes, control-plane invariants, the Linux dataplane, storage and replication, realtime channels, and the job model.
---

```
browser ──oRPC/HTTP+SSE+WS── controller ──oRPC── agent ──netns── emulators + ubridge
                                  │
                            PostgreSQL 17+
                                  │
                           image/blob store
```

## Processes

| Process    | Responsibility                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| Controller | Only writer of PostgreSQL, only issuer of agent tokens and WebSocket tickets, HTTP API, MCP, UI host. |
| Agent      | Privileged host objects: namespaces, veth/TAP, ubridge, emulator processes, consoles, captures.       |
| Emulators  | External: QEMU, IOU, DynaMips, VPCS, Docker. Never managed in-process.                                |

One active controller is enforced by a PostgreSQL advisory lock (`0x6e65746c`); a second instance
exits. Agents reconcile from their reported state, so a controller restart does not stop a lab.

## Control-plane invariants

- The controller is the only writer of PostgreSQL and the only issuer of agent tokens and
  WebSocket tickets.
- Agents own every privileged host object. A controller restart never stops the dataplane.
- Every procedure declares `authz` metadata; one middleware enforces it. There is no second
  authorization path, and MCP calls use the same one.
- Every mutation is audited with user, IP, action, resource, and a redacted diff.

## Dataplane

- One Linux network namespace per project: `nb-<first10hex(projectId)>`.
- Uplink veth `nbp<short>`/`nbp<short>p` with `169.254.<slot>.1/30` on the host,
  `169.254.<slot>.2/30` plus `10.99.<idx>.<slot>/32` inside the namespace.
- nftables `inet netlabor` drop policy with explicit underlay allowances.
- ubridge runs inside the namespace and owns TAP/bridge/capture/marker work.
- Interface names derive from `sha256(owner:adapter:port)` so reconciliation recreates the same
  names.
- Links are kernel bridges when both anchors are kernel interfaces on the same compute; otherwise
  ubridge relays (UDP NIOs, TAP NIOs, kernel bridge + relay TAP). Cross-compute links use UDP
  tunnels over the `10.99.0.0/16` underlay.
- Console proxies bind external ports on the agent host and forward into the namespace; browsers
  reach them through controller WebSocket proxies.
- Markers are ubridge `mark` filters writing one pcap per marker; the agent tails them and emits
  `marker.hit` events for live link animation.

## Storage and replication

PostgreSQL holds identity (`users`, `sessions`, `api_keys`, `roles`, `groups`,
`project_grants`), infrastructure (`computes`, `pools`, `images`, `image_replicas`, `uploads`),
content (`templates`, `symbols`, `settings`), and topology (`projects`, `project_slots`, `nodes`,
`links`, `drawings`, `markers`, `faults`, `snapshots`, `port_allocations`, `jobs`, `events`,
`audit_log`). Migrations are plain SQL applied in lexical order inside transactions.

Images are content-addressed by sha256. Uploads stream into the controller's staging store
(`blobs/<sha256>/<filename>`); the library records one `images` row and a replica per compute.
`images.sync` copies a replica to another compute. Snapshots and exports live under the staging
directory and are streamed by procedures through the OpenAPI surface.

## API and realtime

- oRPC over POST/GET at `/rpc`; procedures are typed end to end.
- The same contract is served as REST/OpenAPI at `/api` (spec at `/api/openapi.json`, reference at
  `/api/docs`); file and proxy procedures use its detailed output mode for Blobs, streams, and
  non-200 success statuses.
- SSE: `projects.events` and `events.subscribe` (persisted events).
- WebSockets: `/ws/console/:nodeId`, `/ws/vnc/:nodeId`, `/ws/wireshark/:linkId`,
  `/ws/collab/:projectId`; each requires a session and, for the proxy channels, a single-use HMAC
  ticket.
- MCP: `/mcp` speaks JSON-RPC 2.0 over Streamable HTTP; tools derive from the contract and are
  filtered per API key.
- Large transfers are contract procedures with binary responses: uploads, blobs, project and
  snapshot archives, pcap download.

## Job model

Long operations return a `JobRow` instead of blocking: snapshot create/restore, project import and
duplicate, OS download, appliance build, image sync. Jobs move through `queued`, `running`,
`completed`, and `failed`, report progress and a payload, and publish events. `jobs.list/get/cancel`
inspect and cancel them. Builds that outlive a controller restart are marked failed at startup.

## Realtime collaboration

Presence is an in-memory hub on `/ws/collab/:projectId`: participants, cursors, selections, and
live drag previews. Durable mutations still flow through the API and the project SSE stream, so
every editor converges on persisted state. The model is last-write-wins; there is no CRDT.
Project locking remains the coarse read-only switch.

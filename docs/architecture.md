# Netlabor architecture

Netlabor is a browser-first network lab control plane: a Bun controller, Bun
compute agents, and a React UI. Emulators (QEMU, Docker, IOU, Dynamips, VPCS)
stay external; Netlabor owns identity, persistence, dataplane orchestration,
and the browser experience.

```
Browser ──oRPC/HTTP+SSE+WS── Controller ──oRPC── Agent ──netns── emulators + ubridge
                                │
                          PostgreSQL 17
                                │
                         image/blob store
```

## Packages

| Path                | Purpose                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contract` | oRPC router (`router.ts`), agent router (`agent-router.ts`), zod schemas, error model, authz metadata. Single source of truth for the UI, OpenAPI, MCP. |
| `packages/db`       | `Bun.sql` client, migration runner, jsonb decoding helper.                                                                                              |
| `packages/catalog`  | Built-in templates, symbols, fault catalog, port derivation, deterministic anchor names.                                                                |
| `packages/shared`   | IDs, logging, path safety, telnet codec, HMAC tickets, AES-GCM secrets, async queue.                                                                    |
| `apps/controller`   | HTTP server, auth middleware, services, MCP endpoint, WebSocket proxies.                                                                                |
| `apps/agent`        | Privileged host operations: namespaces, veth/TAP, ubridge, emulator processes, consoles, captures.                                                      |
| `apps/web`          | React 19, TanStack Router/Query, React Flow canvas, xterm consoles.                                                                                     |

## Control plane invariants

- The controller is the only writer of PostgreSQL and the only issuer of agent
  tokens and WebSocket tickets.
- Agents own every privileged host object. A controller restart never stops the
  dataplane; agents reconcile from their reported state.
- One active controller: a PostgreSQL advisory lock (`0x6e65746c`) makes a
  second instance exit.
- Every procedure declares `authz` metadata; one middleware enforces it. There
  is no second authorization path.
- Every mutation is audited with user, IP, action, resource, and a redacted diff.

## Identity and authorization

- Sessions: random 32-byte token, SHA-256 at rest, `nb_session` HttpOnly cookie,
  CSRF enforced for cookie-authenticated mutations (Origin or Sec-Fetch-Site).
- API keys: `nbk_<base64url>`, SHA-256 at rest, effective scopes are the
  intersection of key scopes and the user's current privileges.
- Six built-in roles: `admin` (global only), `operator`, `editor`, `owner`
  (project grants only), `viewer`, `auditor`. Project grants add the granted
  role's privileges inside that project; owners get the `owner` role implicitly.
- OIDC: `openid-client` discovery, PKCE + state + nonce in a signed 10-minute
  cookie, claim-to-group mapping, optional auto-provisioning.

## Dataplane

- One Linux network namespace per project: `nb-<first10hex(projectId)>`.
- Uplink veth `nbp<short>`/`nbp<short>p` with `169.254.<slot>.1/30` on the host
  and `169.254.<slot>.2/30` plus `10.99.<idx>.<slot>/32` inside the namespace.
- nftables `inet netlabor` drop policy with explicit underlay allowances.
- ubridge runs inside the namespace and owns TAP/bridge/capture/marker work.
- Interfaces derive from `sha256(owner:adapter:port)` so reconciliation can
  recreate the same names.
- Links are kernel bridges when both anchors are kernel interfaces on the same
  compute, otherwise ubridge relays (UDP NIOs, TAP NIOs, kernel bridge + relay
  TAP for kernel interfaces). Cross-compute links use UDP tunnels over the
  `10.99.0.0/16` underlay.
- Console proxies bind external ports on the agent host and forward into the
  namespace; browsers reach them through controller WebSocket proxies.
- Packet markers are programmed as ubridge `mark` filters that write a pcap per
  marker; the agent tails those files to emit `marker.hit` events (tag, link,
  direction, length) for live link animation. ubridge's UDP marker sink is also
  bound per project for kernels that report it.

## API surface

- oRPC over POST/GET at `/rpc`; procedures are typed end to end.
- SSE: `projects.events`, `events.subscribe` (persisted events), agent events.
- WebSockets: `/ws/console/:nodeId`, `/ws/vnc/:nodeId`,
  `/ws/wireshark/:linkId`; each requires a single-use HMAC ticket and the
  session cookie.
- MCP: `/mcp` speaks JSON-RPC 2.0 (initialize, tools/list, tools/call) over
  Streamable HTTP. Tools derive from the contract, are filtered per API key,
  and are invoked through the same authorization middleware.
- Large transfers use dedicated HTTP routes: uploads, blobs, project and
  snapshot archives, pcap download.

## Realtime collaboration

- `/ws/collab/:projectId` is a cookie-authenticated, same-origin WebSocket for
  ephemeral project presence. The in-memory hub tracks participants, cursors,
  selections, and live node-drag previews.
- Durable mutations still flow through the API and project SSE stream, so every
  editor refreshes from the same persisted state. Presence does not use the
  database and is discarded when the last connection closes.
- The protocol is deliberately last-write-wins: concurrent edits are visible
  immediately, but there is no CRDT or per-field merge. Project locking remains
  the coarse read-only switch.

## Persistence

PostgreSQL tables cover identity (`users`, `sessions`, `api_keys`, `roles`,
`groups`, `project_grants`), infrastructure (`computes`, `pools`, `images`,
`image_replicas`, `uploads`), content (`templates`, `symbols`, `settings`), and
topology (`projects`, `project_slots`, `nodes`, `links`, `drawings`, `markers`,
`faults`, `snapshots`, `port_allocations`, `jobs`, `events`, `audit_log`).
Migrations are plain SQL applied in lexical order inside transactions.

---
title: Getting started
description: Stand up the controller and an agent, create a project, start a node, open its console, and connect it to a second device.
---

The shortest path from an empty host to a running two-node lab. Each step names the screen and
the procedure behind it, so the same actions are reproducible from the API.

## What you need

Two roles are involved. One controller process owns PostgreSQL, the HTTP API, and the browser
app. One agent process per compute host owns the privileged host objects: network namespaces,
TAP devices, `ubridge`, and emulator processes.

| Host       | Requirements                                                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controller | Bun 1.4 or the compiled binary, PostgreSQL 18 reachable through `NB_DATABASE_URL`, a 32-byte base64 `NB_SECRET_KEY`, `NB_PUBLIC_URL`.                                                              |
| Agent      | Linux with `ip`, `nft`, `tc`, `/dev/net/tun`, root or `CAP_NET_ADMIN`/`CAP_NET_RAW`/`CAP_SYS_ADMIN`, `ubridge` built with the marker and `iol_bridge` modules, `xorriso` for cloud-init templates. |
| Emulators  | Only the ones you use: `qemu-system-x86_64` with KVM, `dynamips`, `iou`, `vpcs`, Docker Engine or a Podman compatibility socket, `sharkd`/`tshark`, `tcpdump`.                                     |

A single machine can host both processes for a first lab. Multi-compute labs additionally need IP
reachability for the `10.99.0.0/16` underlay between computes and, for NAT nodes, an
administrator-provisioned bridge (`NB_NAT_BRIDGE`, default `nb-nat`) that runs DHCP and egress NAT
itself. Netlabor does not run DHCP.

<div class="docs-callout" data-tone="warn">
  <span class="docs-callout__label">Check before you start</span>
  <p>
    <code>ubridge</code> must be built with the marker and <code>iol_bridge</code> modules. Without
    them, links still forward through relays but marker hits and IOU bridging are unavailable.
  </p>
</div>

## Start the stack

For development, one supervisor runs the controller in watch mode, the agent in watch mode, and
Vite:

```bash
bun install
bun run dev
```

That command is also the whole first-run setup: it writes `.env` when missing, starts a local
PostgreSQL cluster in `.dev/postgres` if no server is reachable, migrates the database, and
registers the local agent as a compute named `dev`. The agent needs root for namespaces, so the
supervisor runs it with passwordless `sudo` when available (otherwise it starts unprivileged and
node starts fail with a clear warning). On a fresh database, the UI opens the first-run setup
wizard to create the admin account.

The controller listens on `127.0.0.1:8080`, the agent on `127.0.0.1:8081`, and the UI on
`http://127.0.0.1:5173`. Vite proxies `/rpc`, `/api`, `/auth`, `/ws`, and `/healthz` to the
controller and rewrites the proxy origin so the controller's same-origin mutation check passes.

For a packaged install:

1. `bun run build` produces `dist/netlabor-controller`, `dist/netlabor-agent`, and
   `apps/web/dist`.
2. Run `scripts/install-controller.sh` and `scripts/install-agent.sh`, then edit the environment
   files under `/etc/netlabor/`.
3. `systemctl enable --now netlabor-controller`. Migrations run at startup; with
   `NB_ADMIN_PASSWORD` set, the first administrator account is created on the same start.
4. In the UI, open **Computes → Add compute**. The dialog prints the agent token and its
   environment block once. Put them in `/etc/netlabor/agent.env` and start `netlabor-agent`.
5. The compute turns online on the next heartbeat (every 10 seconds) and reports its capabilities.

<div class="docs-callout" data-tone="info">
  <span class="docs-callout__label">Agent tokens</span>
  <p>
    The controller is the only issuer of agent tokens. If you lose the token, rotate it from the
    compute row instead of reusing the printed value.
  </p>
</div>

## Sign in

Open the UI origin (`http://127.0.0.1:5173` in development, `NB_PUBLIC_URL` in production). Sign in
with the local administrator, or with an enabled OIDC provider if one is configured. The session is
a random token stored as a SHA-256 hash in PostgreSQL and delivered as the HttpOnly `nb_session`
cookie; cookie-authenticated mutations are also checked against the request origin.

## Create the first project

Open **Projects → New project**. Give it a name and an optional description. A new project is
`closed`: the topology exists, but no namespaces, slots, or link dataplanes are allocated.

Select **Open** on the project row (or in the workspace top bar). Opening allocates the project
namespace on every compute that hosts nodes and creates the uplink slot
(`169.254.<slot>.1/30` on the host, `169.254.<slot>.2/30` plus `10.99.<idx>.<slot>/32` in the
namespace). Every compute that hosts a node must be online before the project opens; otherwise the
call fails with `AGENT_UNAVAILABLE`.

A project owns:

- one topology — nodes, links, drawings, markers, faults — and its files;
- one network namespace per participating compute, named `nb-<first10hex(projectId)>`;
- images and snapshots linked to it, plus project-scoped templates;
- its members and project grants;
- its event stream and collaboration channel.

## Add the first node

Inside the workspace, the **Palette** on the left lists templates by category. Search, then drag a
template onto the canvas or double-click it. The new node is `stopped`.

Select it and use the **Inspector** on the right for name, properties, cloud-init, and files. The
node's ports are derived from its type and properties: a switch exposes Ethernet ports, an IOU
router exposes serial and Ethernet ports matching its configured adapters, and a `nat` node has a
single port.

Use **Start** in the inspector, or **Start all** in the project top bar. The top bar disables
**Start all** until the project is open. Starting a QEMU node also requires its image to be present
on the compute; missing images fail with `IMAGE_MISSING` and a library hint in the UI.

<div class="docs-callout" data-tone="warn">
  <span class="docs-callout__label">Node files need a stopped node</span>
  <p>
    Writes through the node file API are refused with <code>NODE_BUSY</code> while the node is
    started. Stop the node, write the file, then start it again.
  </p>
</div>

## Open the first console

Select a started node and open the **Console** tab in the bottom dock. The console kind comes from
the template or node:

| Console        | Typical nodes                     | Notes                                                      |
| -------------- | --------------------------------- | ---------------------------------------------------------- |
| `telnet`       | IOU, DynaMips, VPCS, serial QEMU  | Proxied over a controller WebSocket.                       |
| `vnc`          | QEMU desktops and appliances      | VNC display forwarded through `/ws/vnc/:nodeId`.           |
| `http`/`https` | Web-managed appliances            | Uses a dedicated management network per container.         |
| `none`         | Nodes with no interactive console | Console tab shows the reason instead of an empty terminal. |

The browser never connects to the agent directly. The controller issues a single-use HMAC ticket
(valid for 60 seconds) and proxies the stream. If a console looks stuck, `console_reset` clears the
proxy; if the tab stays empty, check that the node has a `consolePort` and that the agent console
listener is bound.

## Connect the first link

Hover a node: its port handles appear on the node edges. Drag from one handle to another to create
a link, or open the port context menu to search ports by name. New links default to
`ethernet`; serial, ATM, and Frame Relay are selectable in the link dialog.

When both nodes are started, the controller builds the dataplane: a kernel bridge when both anchors
are kernel interfaces on the same compute, otherwise a `ubridge` relay with UDP or TAP NIOs. Links
between computes use UDP tunnels over the underlay. A link that stays `pending` means at least one
endpoint is not started.

## Where things live

| Screen        | What it owns                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------- |
| **Projects**  | Create, import, export, open, close, lock, delete. Search and status filters.                |
| **Workspace** | Canvas, palette, inspector, console dock, link dialogs, markers, faults, snapshots, sharing. |
| **Library**   | Device templates, appliances, the image library, and symbols, in one tabbed screen.          |
| **Computes**  | Agent registration, capabilities, underlay index, online state, image replicas.              |
| **Admin**     | Users, groups, roles, project grants, audit log, OIDC providers, settings, and secrets.      |
| **Profile**   | Your preferences, sessions, and API keys.                                                    |

## Next

- [Projects](/concepts/projects) explains opening, locking, and deletion in detail.
- [Nodes & ports](/concepts/nodes) covers templates, images, properties, and port derivation.
- [Declarative apply](/apply) rebuilds the same lab from one JSON manifest.

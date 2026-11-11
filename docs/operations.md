# Netlabor operations

## Host prerequisites

Controller:

- Bun 1.4 or the compiled `netlabor-controller` binary.
- PostgreSQL 17 reachable through `NB_DATABASE_URL`.
- A 32-byte base64 `NB_SECRET_KEY` (tickets and encrypted secrets).
- `NB_PUBLIC_URL` matching the browser origin. Mutations are also accepted when
  the `Origin` header matches the `Host` the request arrived on, so the UI works
  over `localhost`, a hostname, or a LAN address as well; set `NB_PUBLIC_URL` to
  the address users are given, and to the proxy origin behind a reverse proxy.

Agent (per compute host):

- Linux with `ip`, `nft`, `tc`, `/dev/net/tun`, root or `CAP_NET_ADMIN`,
  `CAP_NET_RAW`, `CAP_SYS_ADMIN`.
- ubridge (`/usr/local/bin/ubridge` by default) built with the marker and
  `iol_bridge` modules.
- Cloud-init templates need `xorriso` on the agent.
- Optional emulators: `qemu-system-x86_64` (with KVM), `dynamips`, `iou`,
  `vpcs`, Docker Engine (or a Podman compat socket), `sharkd`/`tshark`,
  `tcpdump`.
- IP reachability for the underlay prefix (`10.99.0.0/16`) between computes,
  e.g. WireGuard on `NB_UNDERLAY_INTERFACE`.
- A host bridge for NAT nodes (`NB_NAT_BRIDGE`, default `nb-nat`) with DHCP and
  NAT provisioned by the administrator. Netlabor does not run DHCP.
- An unprivileged account for emulators (`NB_EMULATOR_UID`/`GID`); ubridge and
  namespace setup run as root.

## First start

1. `bun run build` produces `dist/netlabor-controller`, `dist/netlabor-agent`,
   and `apps/web/dist`.
2. Install with `scripts/install-controller.sh` and `scripts/install-agent.sh`,
   then edit `/etc/netlabor/*.env`.
3. `systemctl enable --now netlabor-controller` — migrations run automatically
   and, with `NB_ADMIN_PASSWORD` set, the first administrator is created.
4. Register the compute in the UI (Computes → Add compute). The dialog prints
   the agent token and environment block exactly once; put them in
   `/etc/netlabor/agent.env` and start `netlabor-agent`.
5. The controller marks the compute online on the next heartbeat (10 s) and
   stores its capabilities.

## Environment reference

Controller: `NB_DATABASE_URL`, `NB_LISTEN`, `NB_PUBLIC_URL`, `NB_SECRET_KEY`,
`NB_WEB_ROOT`, `NB_STAGING_DIR`, `NB_STORAGE_DRIVER` (`local`/`nfs`),
`NB_NFS_IMAGE_DIR`, `NB_SESSION_TTL_HOURS`, `NB_AUTO_CLOSE_IDLE_MINUTES`,
`NB_ADMIN_USER`, `NB_ADMIN_PASSWORD`, `NB_LOG_LEVEL`, `NB_LOG_PRETTY`,
`NB_MAX_UPLOAD_BYTES`, `NB_MAX_NODES_PER_PROJECT`, `NB_ALLOW_INSECURE_AGENT`,
`NB_TLS_CERT`/`NB_TLS_KEY`, `NB_DISABLE_RATE_LIMITS` (tests only),
`NB_ALLOW_INSECURE_OIDC` (http issuers outside loopback). OIDC issuers must use
https; loopback issuers are accepted for local mock providers.

Agent: `NB_AGENT_LISTEN`, `NB_AGENT_TOKEN`, `NB_STATE_DIR`, `NB_RUN_DIR`,
`NB_UNDERLAY_INDEX`, `NB_UNDERLAY_HOST`, `NB_UNDERLAY_CIDR`,
`NB_UNDERLAY_INTERFACE`, `NB_UBRIDGE_PATH`, `NB_NAT_BRIDGE`,
`NB_CLOUD_INTERFACES`, `NB_EMULATOR_UID`/`GID`, `NB_DOCKER_SOCKET`,
`NB_DOCKER_AUTO_PULL`, `NB_STORAGE_DRIVER`, `NB_IMAGE_DIR`,
`NB_NFS_IMAGE_DIR`, `NB_MAX_SHARKD_SESSIONS`, `NB_TLS_CERT`/`NB_TLS_KEY`.

## Importing GNS3 appliance bundles

Netlabor can ingest a directory of GNS3 appliance bundles (`.gns3a` plus its
image files) as system templates and library images:

```bash
sudo -n env NB_DATABASE_URL="$NB_DATABASE_URL" NB_IMAGE_DIR=/var/lib/netlabor/images \
  bun run import:appliances --dir /path/to/appliances
```

Options: `--dry-run` reports the mapping without writing. The importer:

- hashes each appliance image, hard-links qcow2 files into
  `$NB_IMAGE_DIR/<sha256>/`, and converts raw `.img` bases to qcow2 once;
- inserts the image row and a `present` replica on the first online compute;
- creates or updates `builtin` templates grouped into Routers, Switches,
  Firewalls, End devices, and Containers;
- maps GNS3 QEMU options (`-machine`, `-cpu`, USB devices) onto Netlabor
  properties and uses VNC for SPICE consoles;
- imports IOU appliances with `licenseCheck: false` (the runtime never
  embeds a license), and Docker appliances without an image (pull the
  container image from Images or on start);
- is idempotent: reruns reuse cached hashes and existing rows, and never
  overwrites a user template with the same name.

Images are registered on one compute; use **Images → Sync** to replicate them
to additional computes.

## Debian cloud-init templates

The catalog seeds **Debian 13 cloud** (serial console) and **Debian 13 cloud
desktop** (VNC + XFCE) templates. Both use the official genericcloud
image `debian-13-genericcloud-amd64.qcow2`; upload it as a QEMU image before
first use. Agents need `xorriso` to build the NoCloud seed ISO.

Creating a node from either template prompts for a cloud-init username,
password, optional hostname, and DHCP or static network settings. The same
fields are editable from the inspector and template dialog under **Cloud-init**;
changing them changes the seed and therefore the cloud-init instance on the next
node start.

- **Server profile**: headless, serial console, `serial-getty@ttyS0` enabled.
- **Desktop profile**: installs `xfce4`, Xorg, and
  `qemu-guest-agent` on first boot, switches to `graphical.target`, and
  auto-logs the cloud user into XFCE on tty1 (`getty` autologin + `startx`).
  Use the VNC console. The desktop template provisions a 32 GiB disk and
  needs reachable DNS/internet for the first-boot package install.
- Static networking accepts CIDR (`10.0.0.10/24`), gateway, and comma-separated
  DNS servers.

The seed ISO is written to `cloud-init/seed.iso` in the node directory and
attached read-only as a CD-ROM; it is regenerated on every start.

For generated cloud-init (for example a project that renders one `user-data`
per VM), set `cloudInitUserData`, `cloudInitMetaData`, or
`cloudInitNetworkConfig` on the node. Each non-empty value is written verbatim
instead of the generated file; `cloudInitMetaData` keeps its `instance-id`, and
without it the agent derives one from the user-data and network-config contents.
This lets a project keep its own cloud-init pipeline while Netlabor still builds
and attaches the NoCloud seed. The same fields are under **Cloud-init (custom
seed)** in the inspector.

## Emulator startup files

QEMU's default MAC address keeps the adapter number in its last octet. This
matches GNS3, and lets tooling map a guest that renamed its NICs (`eth1`,
`eth2`, …) back to the adapter index used in generated configs.

- IOU runs with `-c startup-config.cfg` when that file exists in the node
  directory. Set the node's `startupConfig` property or upload the file through
  the node file API before starting.
- Docker `extraVolumes` entries that are absolute container paths (for example
  `/etc/frr`) bind the matching path under the node file directory
  (`<node dir>/etc/frr`) into the container. Upload `etc/frr/frr.conf` through
  the node file API, then start or recreate the node. Entries containing `:`
  are passed through as explicit Docker bind specifications.
- Docker nodes run privileged by default, matching GNS3. Routing images such as
  FRR cannot start their daemons without it. Set the node's `privileged`
  property to `false` only for images that do not need kernel networking
  capabilities.

## NAT nodes and the host NAT bridge

Netlabor does not run DHCP or NAT itself. NAT nodes expect an admin-provisioned
Linux bridge (`NB_NAT_BRIDGE`, default `nb-nat`) with DHCP and egress NAT. For a
single-host lab:

```bash
sudo NB_NAT_BRIDGE=nb-nat NB_NAT_ADDRESS=10.10.99.1/24 \
  scripts/provision-nat-bridge.sh
```

The script creates the bridge, enables forwarding, starts dnsmasq (DHCP range
`10.10.99.100–199`, DNS `1.1.1.1/9.9.9.9`), adds masquerade rules on the default
uplink, and allows `nt*` NAT veth traffic through Netlabor's isolation table.
Override `NB_NAT_UPLINK`, `NB_NAT_DHCP_RANGE`, or `NB_NAT_DNS` as needed.

The NAT node itself has one port: connect it to the segment that should reach
the internet. A GUI Debian cloud node needs the NAT node on the same
switch/segment (or static networking with a working gateway/DNS) before
cloud-init can install XFCE.

## Appliance images (global OS repository)

The UI for this lives on **Images → OS repository & builds** (the Templates page
keeps device templates and symbols; appliance builds are reached from there and
from the missing-image hint in a template's details).

The controller keeps a global repository of base cloud images (`os_images`) with
fixed seed entries for Debian 13 (`trixie`) and Ubuntu 24.04 LTS (`noble`).
Each entry points at an upstream qcow2 cloud image; Netlabor never fabricates
artifacts, it copies and verifies them into the image library:

1. **Populate** — `appliances.os.download({id})` streams the upstream image into
   the blob store, validates it with `qemu-img info`, and creates the library
   `images` row (kind `qemu`). `appliances.os.adopt({id, imageId})` links an
   image you already uploaded instead, for air-gapped sites.
2. **Build** — `appliances.builds.create({name, osImageId, desktop, packages,
diskGb, memoryMb, cpus})` boots the base image in a throwaway QEMU VM on a
   compute with QEMU user networking, so the guest is **online** while it
   provisions. cloud-init runs one generated script that updates apt, installs
   the chosen desktop (`none|xfce|gnome|kde|lxqt`) plus your package list,
   enables the display manager and `graphical.target`, and prints progress
   markers to the serial console. The script always finishes with
   `NETLABOR_BUILD_OK`/`NETLABOR_BUILD_FAILED` and powers the VM off.
3. **Publish** — on `NETLABOR_BUILD_OK` the agent moves the qcow2 into its image
   store, the controller pulls it back, registers a library image under the
   build name, and marks that compute's replica present. From then on the image
   replicates like any other (`images.sync`).
4. **Use** — `appliances.builds.template({buildId, name, projectId})` creates a
   QEMU device template whose `requiredImages` point at the built image. Nodes
   created from it get their disk from that image, and they only ever attach to
   project links, so a finished appliance is **offline** inside the lab
   namespace with no uplink of its own.

Progress and logs are visible through `appliances.builds.list`/`get` (the agent
reports the tail of the serial console) and through the `appliance.build` job.
Builds that outlive a controller restart are marked failed at startup; a build VM
that loses its process without a marker is reported as `build interrupted`.

The build VM attaches its disk as IDE, matching the node default: the Debian
cloud image's BIOS GRUB cannot load its kernel from virtio-blk (Ubuntu boots
either way). Keep `disks.hda.interface` unset/`ide` on templates built from a
Debian base.

Desktop package sets live in `packages/catalog/src/os-images.ts`
(`desktopRecipes`); package names are validated against a strict apt-name
pattern before they reach the build script.

### Project-scoped templates

Device templates carry an optional `projectId`. Global templates (`projectId`
null) are the shared library; project templates only appear to that project's
members and are only accepted for nodes in that project. `templates.list` takes
an optional `projectId` and then returns the global library plus that project's
own templates. Roles: `editor` and `owner` may write templates (project grants
therefore allow a project lead to curate their own appliance templates), while
`image.write` stays with operators and admins for repository and build actions.

## MCP for agents

Netlabor exposes a stateless Streamable HTTP MCP endpoint at `/mcp`. It accepts
JSON-RPC 2.0 POST requests and authenticates with an API key:

```bash
curl -s http://127.0.0.1:8080/mcp \
  -H "Authorization: Bearer nbk_..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Create the key from the user API-key page (or `auth.apiKeys.create`). It needs
`mcp.use` plus the privileges of the tools it should call; for a read-only lab
operator that usually means `project.read`, `node.read`, `link.read`, and
`node.console`. API keys cannot exceed their owner's privileges.

The server supports protocol versions `2025-06-18`, `2025-03-26`, and
`2024-11-05`. Tool schemas are generated from the oRPC contract, and every call
goes through the same authorization and audit middleware as the HTTP API.

`console_exec` is the agent-facing console tool. It runs commands against a
node's serial/telnet console and returns the transcript with `ok`/`timedOut`.
It accepts:

```json
{
  "id": "<node uuid>",
  "commands": ["show ip interface brief"],
  "timeoutMs": 8000,
  "prompt": "Switch[>#]\\s*$",
  "terminalLengthZero": true
}
```

`prompt` is an optional JS regular expression; omit it for the usual `>`/`#`
prompt. `terminalLengthZero` is for IOS-style consoles. `console_reset` clears a
stuck console proxy. Console exec requires a running node with a serial or
telnet console; VNC-only QEMU desktop nodes do not expose a command console.

### Declarative applies with `project_apply`

`project_apply` builds or updates a whole lab from one manifest instead of a
call per node, file, and link. Nodes are referenced by name, templates by name,
and ports are picked automatically:

```json
{
  "name": "ccna-lab",
  "nodes": [
    { "name": "sw1", "template": "Ethernet switch" },
    {
      "name": "r1",
      "template": "Cisco IOU L3",
      "files": [{ "path": "startup-config.cfg", "content": "hostname r1\n" }]
    }
  ],
  "links": [{ "a": "sw1", "b": "r1" }],
  "drawings": [{ "key": "title", "type": "text", "text": "CCNA lab", "x": 40, "y": 20 }]
}
```

- Reapplying is idempotent for nodes (by name), links (by node pair, either
  orientation) and drawings (by `style.applyKey`), so the same manifest can be
  sent again without duplicates.
- Omit `projectId` to find or create a project by `name`; that path needs a
  global `project.write` because authorization resolves the project first.
  Project-scoped roles and project-restricted API keys must pass `projectId`.
- `prune: true` deletes nodes, links, and keyed drawings that the manifest no
  longer lists; unkeyed drawings drawn by hand are never touched. `start: true`
  starts every manifest node once the project is open. Both default to false.
- Explicit ports are optional (`aPort`/`bPort`, exact names from the node's port
  list). Supply both or neither; a name that is already in use is a conflict.
- Files are written only to stopped nodes (`NODE_BUSY` otherwise), and node
  names, templates, computes, and emulator types are never changed by apply.
- Besides `project.write`, the caller needs `node.create`/`node.update`/
  `node.files`, `link.write`, `drawing.write`, `node.delete` for pruning, and
  `node.control` for `start`.

Deterministic problems (unknown names, ambiguous template names, port
exhaustion, missing privileges, unsafe paths, running nodes) are all raised
before anything is written. An agent failure mid-apply can still leave a
partially applied project.

## Backup and restore

Backup:

1. `pg_dump --format=custom "$NB_DATABASE_URL" > netlabor.dump`
2. Copy the blob store: the NFS image directory, or `NB_STAGING_DIR`
   (`blobs/<sha256>/<filename>`) plus each compute's `NB_IMAGE_DIR`.
3. Optionally copy `NB_STAGING_DIR/snapshots` and `exports`.

Restore:

1. Recreate the database and `pg_restore -d "$NB_DATABASE_URL" netlabor.dump`.
2. Restore the blob store to the same paths.
3. Start the controller; it re-marks computes offline and reconciles when
   agents reconnect. Agents re-download missing images on demand.

## Upgrade

Replace both binaries and the web bundle, then restart the controller (migrations
run at startup) and the agents. There is no rolling upgrade: the controller
compares agent API versions and reports `AGENT_ERROR` for incompatible agents.
Running labs keep forwarding while the controller is down; agent state is
reconciled on reconnect. An agent restart terminates its emulators and ubridge
processes (`KillMode=control-group`) and cleans stale namespaces on startup.

## Troubleshooting

- `GET /healthz` fails 503 → database unreachable; check `NB_DATABASE_URL`.
- Compute stays offline → check agent `/healthz`, the token, and that the
  controller can reach the agent URL (`NB_ALLOW_INSECURE_AGENT=1` for http).
- Project open returns `AGENT_UNAVAILABLE` → every compute hosting nodes must be
  online before a project opens.
- Links stay `pending` → nodes are not both started; start them and the
  controller creates the dataplane.
- No console → check the node has `consolePort`, the agent console listener is
  bound, and the WebSocket ticket is fresh (they expire after 60 s).
- Web Wireshark returns `CAPABILITY_UNSUPPORTED` → `sharkd`/`tshark` missing.
- Kernel-mode links unavailable → the agent reports `kernelDataplane=false`;
  links still work through ubridge relays.

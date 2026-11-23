---
title: Operations
description: Environment variables, first start, computes, NAT, backups, upgrades, and a troubleshooting index.
---

## Host prerequisites

Controller: Bun 1.4 or the compiled binary, PostgreSQL 17 or newer, a 32-byte base64 `NB_SECRET_KEY`, and
`NB_PUBLIC_URL` matching the browser origin. Mutations are also accepted when `Origin` matches the
request `Host`, so a lab reachable by hostname or LAN address still works; behind a proxy set
`NB_PUBLIC_URL` to the proxy origin.

Agent: Linux with `ip`, `nft`, `tc`, `/dev/net/tun`, root or
`CAP_NET_ADMIN`/`CAP_NET_RAW`/`CAP_SYS_ADMIN`; `ubridge` built with the marker and `iol_bridge`
modules; `xorriso` for cloud-init; optional emulators (`qemu-system-x86_64`, `dynamips`, `iou`,
`vpcs`, Docker Engine or a Podman socket, `sharkd`/`tshark`, `tcpdump`); IP reachability for the
`10.99.0.0/16` underlay between computes; a host bridge for NAT nodes (`NB_NAT_BRIDGE`, default
`nb-nat`) with DHCP and NAT provisioned by the administrator; an unprivileged emulator account
(`NB_EMULATOR_UID`/`NB_EMULATOR_GID`).

## First start

1. Release installs need no build: `curl -fsSL https://raw.githubusercontent.com/nemvince/netlabor/main/scripts/install.sh | sudo bash`
   installs the controller and/or the agent, its dependencies (PostgreSQL, database and role, QEMU,
   vpcs, tshark, nftables, xorriso, and a source-built ubridge), and the systemd units. Pass
   `--skip-deps` when those are managed separately, `--with-docker` for container nodes, or
   `--with-nat` to provision the NAT bridge. `bun run build` produces the same binaries locally in
   `dist/`, which `scripts/install.sh --binary-dir dist` installs. Run the same command again
   to update: it keeps the environment files, skips dependencies, and restarts the services.
2. `systemctl enable --now netlabor-controller` — migrations run automatically, and with
   `NB_ADMIN_PASSWORD` set the first administrator is created.
3. Installing the agent next to the controller (or with `--controller-url` and admin credentials)
   registers the compute automatically and writes the token to `/etc/netlabor/agent.env`. Otherwise
   register it in the UI (**Computes → Add compute**) and copy the printed token and environment
   block into that file, then start `netlabor-agent`.
4. The compute turns online on the next heartbeat (10 s) and reports capabilities.

## Environment reference

Controller: `NB_DATABASE_URL`, `NB_LISTEN` (default `0.0.0.0:8080`), `NB_PUBLIC_URL`,
`NB_SECRET_KEY`, `NB_WEB_ROOT` (serve the UI from a directory instead of the copy embedded in the
binary), `NB_STAGING_DIR`, `NB_TEMPLATE_DIR` (appliance source directory for
`import:appliances`), `NB_STORAGE_DRIVER` (`local`/`nfs`),
`NB_NFS_IMAGE_DIR`, `NB_SESSION_TTL_HOURS`, `NB_AUTO_CLOSE_IDLE_MINUTES` (default 10),
`NB_ADMIN_USER`, `NB_ADMIN_PASSWORD`, `NB_LOG_LEVEL`, `NB_LOG_PRETTY`, `NB_MAX_UPLOAD_BYTES`,
`NB_MAX_NODES_PER_PROJECT` (default 500), `NB_ALLOW_INSECURE_AGENT`, `NB_TRUST_PROXY`
(read the client address from `X-Forwarded-For`; only set behind a proxy you control),
`NB_ISSUE_URL` (where the account menu's **Report a problem** link goes; set it to `off` or
`none` to hide it), `NB_TLS_CERT`/`NB_TLS_KEY`, `NB_DISABLE_RATE_LIMITS` (tests only),
`NB_ALLOW_INSECURE_OIDC` (http issuers outside loopback).

Agent: `NB_AGENT_LISTEN` (default `0.0.0.0:8081`), `NB_AGENT_TOKEN`, `NB_STATE_DIR` (default
`/var/lib/netlabor`), `NB_PROJECT_DIR` (project and node working files; default
`$NB_STATE_DIR/projects`), `NB_RUN_DIR`, `NB_UNDERLAY_INDEX`, `NB_UNDERLAY_HOST`, `NB_UNDERLAY_CIDR`,
`NB_UNDERLAY_INTERFACE`, `NB_UBRIDGE_PATH`, `NB_NAT_BRIDGE`, `NB_CLOUD_INTERFACES`,
`NB_EMULATOR_UID`/`NB_EMULATOR_GID`, `NB_DOCKER_SOCKET`, `NB_DOCKER_AUTO_PULL`,
`NB_STORAGE_DRIVER`, `NB_IMAGE_DIR`, `NB_NFS_IMAGE_DIR`, `NB_MAX_SHARKD_SESSIONS`,
`NB_TLS_CERT`/`NB_TLS_KEY`.

## Load and abuse limits

The controller refuses work instead of letting a burst exhaust it:

- a project stops accepting new nodes at `NB_MAX_NODES_PER_PROJECT` (default 500), including nodes
  added through `projects.apply`;
- background job kinds have a concurrent cap: appliance builds, OS downloads, imports, duplicates,
  and snapshot create/restore run at most 2 at a time; image sync, project export, and Docker pulls
  at most 4; other kinds at most 8. Excess calls return `TOO_MANY_REQUESTS`;
- `projects.apply` accepts at most 2 000 nodes, 10 000 links, 5 000 drawings, and 500 files per
  node in one manifest;
- project and node file writes accept at most 32 MiB of content per call and a 1 024-character path;
- uploads are bounded by `NB_MAX_UPLOAD_BYTES` (default 64 GiB) and chunked, and the upload start
  endpoint is rate-limited per IP;
- login, WebSocket upgrades, console tickets, and upload starts have per-IP rate limits; set
  `NB_DISABLE_RATE_LIMITS=1` only in tests.

## Computes and agents

The controller marks a compute offline when heartbeats stop and re-reconciles on reconnect. Agent
capabilities drive what the UI offers: emulator binaries, `sharkd`, kernel dataplane support. An
agent restart terminates its emulators and ubridge processes (`KillMode=control-group`) and cleans
stale namespaces at startup; a controller restart does not stop a running lab.

## NAT bridge

Netlabor does not run DHCP or NAT. Provision a bridge once on the compute:

```bash
curl -fsSL https://raw.githubusercontent.com/nemvince/netlabor/main/scripts/install.sh |
  sudo bash -s -- --agent --with-nat
```

`--with-nat` installs `/usr/local/sbin/netlabor-nat-bridge` and the
`netlabor-nat-bridge.service` unit, which re-creates the bridge on every boot. The script creates
`nb-nat` (`10.10.99.1/24`), enables forwarding, starts dnsmasq (`10.10.99.100–199`, DNS
`1.1.1.1`/`9.9.9.9`), and adds masquerade rules on the default uplink. NAT-node veths (`nt*`) are
allowed by the isolation table. Override the name, address, uplink, or DHCP range with
`NB_NAT_BRIDGE`, `NB_NAT_ADDRESS`, `NB_NAT_UPLINK`, and `NB_NAT_DHCP_RANGE`; the agent reads the
bridge name from `NB_NAT_BRIDGE` and refuses to start NAT nodes without it. The bridge script adds
no nftables rules; the agent owns `inet netlabor` and rebuilds it on boot and on every project
realize. From a checkout,
`sudo scripts/provision-nat-bridge.sh` does the same thing. A NAT node has one port: connect it to
the segment that should reach the internet.

## Shared image storage (NFS)

The full head-node-plus-workers walkthrough is in the [4-node cluster install](/deployment) guide.
The rules below are the storage-specific details.

`NB_STORAGE_DRIVER=local` keeps one copy of each image per compute. Set
`NB_STORAGE_DRIVER=nfs` on the controller and on every agent to keep one copy in
`NB_NFS_IMAGE_DIR` on a head node and share it with the other computes.

1. Export the directory from the head node. Only the controller writes; the
   agents and the emulator account need read and traverse access:

   ```ini
   # /etc/exports
   /srv/netlabor/images 10.0.0.0/24(rw,sync,root_squash,no_subtree_check)
   ```

   Create it with mode `0755`, owned by the controller user
   (`netlabor-controller`), and make sure every parent is world-traversable
   (`0711` or `0755`). `bun scripts/install.sh --controller --storage-driver nfs
--nfs-image-dir /srv/netlabor/images` does the ownership part; run the export
   itself once by hand.

2. Mount the same directory on each worker at the same path, for example in
   `/etc/fstab`:

   ```fstab
   head:/srv/netlabor/images /srv/netlabor/images nfs ro,nosuid,nodev,_netdev 0 0
   ```

   Agents only read it, so `ro` is enough. Add the mount to systemd with
   `x-systemd.required-by=netlabor-agent.service` or rely on the installer's
   `RequiresMountsFor` drop-in, which makes the unit refuse to start until the
   path is mounted.

3. Set the same `NB_STORAGE_DRIVER=nfs` and `NB_NFS_IMAGE_DIR` in every
   `/etc/netlabor/agent.env`. The installer does this with
   `--agent --storage-driver nfs --nfs-image-dir <dir>`; re-run it on each host
   with those flags, then `systemctl restart netlabor-agent`.
4. Upload the images once through the library. The controller stages them
   straight into the shared directory and verifies every read by sha256, so all
   computes see a new image without `image.sync`.

The controller and every agent fail at startup when the directory is missing or
unreadable, rather than silently using an unmounted local mountpoint. In NFS
mode **Images → Prune** removes the one shared copy from the controller;
replicas are bookkeeping rows, not separate files. Deleting files on a compute
by hand breaks every other compute, so use the UI.

Weak NFS permissions are the usual failure: the emulator account cannot read a
`0700` directory, and `root_squash` means root on a worker cannot read or delete
files owned by `netlabor-controller`. Keep the tree `0755`/`0644`.

Appliance builds write new image files into the active image root. With the
recommended read-only worker mounts they cannot build; either build on the head
node (with a writable local export) or mount the export writable on the builder
and export it with `all_squash` mapped to the controller uid, so the files stay
owned by the account that later prunes them.

Only the template images belong on the shared export. Node disks, logs, and
captures stay on each compute and should sit on fast local storage: set
`NB_PROJECT_DIR` per agent (for example `/mnt/local/netlabor/projects`) and add
`--project-dir /mnt/local/netlabor/projects` when running the installer so the
systemd unit waits for that mount. The controller's `NB_TEMPLATE_DIR` is only the
input directory for `import:appliances`; it is never served or mounted.

## Accounts and approval

New accounts created by OIDC/Entra start in the built-in `pending` role, which
holds no privileges and shows an "awaiting approval" page. An administrator
assigns a real role from **Settings → Users** (or changes the provider's default
role to skip the wait). Project grants use only the project roles; the grant
endpoint refuses global roles such as `admin` or `pending`.

`editor` projects can create, edit, and operate their own nodes but cannot export
a project archive; `project.export` belongs to owners and administrators. Import
still requires the global `project.write` privilege.

Users can create their own groups from **Groups**, invite classmates, and project
owners can grant those groups a project role. Group owners cannot assign global
roles to a group; only administrators can. IdP-mapped groups are tracked by
provider, so a student cannot reserve an SSO group name to receive mapped
members; if a mapping hits a self-service group of that name, the mapping is
skipped until the name is freed.

## Microsoft Entra ID

Register an application in the tenant, add the redirect URI
`https://<controller>/auth/oidc/<provider-id>/callback`, and create a client
secret. In Netlabor use the tenant issuer, never `common` or `organizations`:

```
https://login.microsoftonline.com/<tenant-id>/v2.0
```

The controller rejects the multi-tenant aliases. Request `openid profile email`
and, if you want group mapping, enable the `groups` claim (optional claim or app
manifest `groupMembershipClaims`). Map Entra group **object ids** to app group
names; the controller also accepts `preferred_username` as the account's email
because Entra often omits `email`. Very large group sets can use the
`_claim_names` overage form, which is not expanded; map a smaller claim or use a
custom claim in that case.

## Backup and restore

1. `pg_dump --format=custom "$NB_DATABASE_URL" > netlabor.dump`.
2. Copy the blob store: the NFS image directory, or `NB_STAGING_DIR/blobs/<sha256>/<filename>`,
   plus each compute's `NB_IMAGE_DIR`.
3. Optionally copy `NB_STAGING_DIR/snapshots` and `exports`.

Restore the database and the blobs to the same paths, then start the controller. It re-marks
computes offline and reconciles when agents reconnect; agents re-download missing images on demand.

## Upgrade

Replace both binaries, restart the controller (migrations run at startup), then the agents. The UI
is embedded in the controller binary, so it is upgraded with it. There is no rolling upgrade: the controller compares agent API versions and reports
`AGENT_ERROR` for incompatible agents. Running labs keep forwarding while the controller is down.

## Troubleshooting

| Symptom                                              | Check                                                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz` returns 503                           | Database unreachable; check `NB_DATABASE_URL`.                                                                               |
| Compute stays offline                                | Agent `/healthz`, the token, controller→agent reachability (`NB_ALLOW_INSECURE_AGENT=1` for http).                           |
| Project open → `AGENT_UNAVAILABLE`                   | Every compute hosting nodes must be online.                                                                                  |
| Links stay `pending`                                 | Start both endpoints; the controller then builds the dataplane.                                                              |
| No console                                           | `consolePort` present, agent listener bound, ticket < 60 s old.                                                              |
| Web Wireshark → `CAPABILITY_UNSUPPORTED`             | `sharkd`/`tshark` missing on the compute.                                                                                    |
| Kernel links unavailable                             | Agent reports `kernelDataplane=false`; relays still work.                                                                    |
| `cross-origin request rejected`                      | `NB_PUBLIC_URL` does not match the browser origin; set it to the proxy origin and send the matching `Origin`.                |
| DynaMips/emulator artifacts in the working directory | The agent's `NB_RUN_DIR`/`NB_STATE_DIR` is not writable or not configured; set both to absolute paths on persistent storage. |

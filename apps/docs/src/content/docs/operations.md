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
3. Register the compute in the UI (**Computes → Add compute**). The dialog prints the agent token
   and environment block once; put them in `/etc/netlabor/agent.env` and start `netlabor-agent`.
4. The compute turns online on the next heartbeat (10 s) and reports capabilities.

## Environment reference

Controller: `NB_DATABASE_URL`, `NB_LISTEN` (default `0.0.0.0:8080`), `NB_PUBLIC_URL`,
`NB_SECRET_KEY`, `NB_WEB_ROOT` (serve the UI from a directory instead of the copy embedded in the
binary), `NB_STAGING_DIR`, `NB_STORAGE_DRIVER` (`local`/`nfs`),
`NB_NFS_IMAGE_DIR`, `NB_SESSION_TTL_HOURS`, `NB_AUTO_CLOSE_IDLE_MINUTES` (default 10),
`NB_ADMIN_USER`, `NB_ADMIN_PASSWORD`, `NB_LOG_LEVEL`, `NB_LOG_PRETTY`, `NB_MAX_UPLOAD_BYTES`,
`NB_MAX_NODES_PER_PROJECT` (default 500), `NB_ALLOW_INSECURE_AGENT`,
`NB_TLS_CERT`/`NB_TLS_KEY`, `NB_DISABLE_RATE_LIMITS` (tests only), `NB_ALLOW_INSECURE_OIDC`
(http issuers outside loopback).

Agent: `NB_AGENT_LISTEN` (default `0.0.0.0:8081`), `NB_AGENT_TOKEN`, `NB_STATE_DIR` (default
`/var/lib/netlabor`), `NB_RUN_DIR`, `NB_UNDERLAY_INDEX`, `NB_UNDERLAY_HOST`, `NB_UNDERLAY_CIDR`,
`NB_UNDERLAY_INTERFACE`, `NB_UBRIDGE_PATH`, `NB_NAT_BRIDGE`, `NB_CLOUD_INTERFACES`,
`NB_EMULATOR_UID`/`NB_EMULATOR_GID`, `NB_DOCKER_SOCKET`, `NB_DOCKER_AUTO_PULL`,
`NB_STORAGE_DRIVER`, `NB_IMAGE_DIR`, `NB_NFS_IMAGE_DIR`, `NB_MAX_SHARKD_SESSIONS`,
`NB_TLS_CERT`/`NB_TLS_KEY`.

## Computes and agents

The controller marks a compute offline when heartbeats stop and re-reconciles on reconnect. Agent
capabilities drive what the UI offers: emulator binaries, `sharkd`, kernel dataplane support. An
agent restart terminates its emulators and ubridge processes (`KillMode=control-group`) and cleans
stale namespaces at startup; a controller restart does not stop a running lab.

## NAT bridge

Netlabor does not run DHCP or NAT. Provision a bridge once:

```bash
sudo NB_NAT_BRIDGE=nb-nat NB_NAT_ADDRESS=10.10.99.1/24 scripts/provision-nat-bridge.sh
```

The script creates the bridge, enables forwarding, starts dnsmasq (`10.10.99.100–199`, DNS
`1.1.1.1`/`9.9.9.9`), adds masquerade rules on the default uplink, and allows `nt*` NAT veth traffic
through the isolation table. A NAT node has one port: connect it to the segment that should reach
the internet.

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

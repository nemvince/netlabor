---
title: 4-node cluster install
description: A complete head-node plus three-worker install covering NFS image sharing, local node disks, the WireGuard underlay, agent registration, TLS, and verification.
---

This is the concrete runbook for one controller head node and three compute workers. The head node
owns PostgreSQL, the UI/API, and the shared template-image export. The workers run the agents and
keep their VM disks, logs, and captures on local storage.

```
students ── https ── head (controller, PostgreSQL, NFS export)
                         │  management network only
             ┌───────────┼───────────┐
          worker1      worker2      worker3
          agent        agent        agent
          local disks  local disks  local disks
                └── WireGuard 10.100.0.0/24 ──┘
                    project underlay 10.99.0.0/16
```

## Address plan

Replace the example addresses with your own. Keep the management network separate from the student
network and from the WireGuard network.

| Host    | Management IP | WireGuard IP | Underlay index | Role                        |
| ------- | ------------- | ------------ | -------------- | --------------------------- |
| head    | 10.0.10.11    | 10.100.0.10  | —              | controller, PostgreSQL, NFS |
| worker1 | 10.0.10.12    | 10.100.0.11  | 1              | agent                       |
| worker2 | 10.0.10.13    | 10.100.0.12  | 2              | agent                       |
| worker3 | 10.0.10.14    | 10.100.0.13  | 3              | agent                       |

The controller assigns underlay indexes when you register a compute. The commands below assume the
head node does not run an agent; if it should also host labs, install it with `--agent` after the
controller. It becomes the next underlay index and needs a WireGuard address and peers too.

## Before you install

On all four hosts:

```bash
sudo apt update
sudo apt install -y curl ca-certificates chrony
sudo systemctl enable --now chrony
```

Create the public DNS record `lab.example.edu` for the head node, and decide how TLS terminates.
The simplest option is Caddy on the head node; direct TLS (`NB_TLS_CERT`/`NB_TLS_KEY`) also works.
The controller must be reached over HTTPS; the browser origin is `NB_PUBLIC_URL`.

Download the installer once and copy it to each host:

```bash
curl -fsSL https://raw.githubusercontent.com/nemvince/netlabor/main/scripts/install.sh \
  -o /tmp/netlabor-install.sh
```

## 1. WireGuard underlay on the workers

Workers must be able to reach each other's `10.99.<index>.0/24` project networks. A full-mesh
WireGuard network on a separate subnet is the least surprising option and keeps project traffic off
the student LAN. The head node does not need WireGuard unless it also runs an agent.

```bash
sudo apt install -y wireguard
sudo install -d -m 0700 /etc/wireguard
umask 077
wg genkey | sudo tee /etc/wireguard/private.key | wg pubkey | sudo tee /etc/wireguard/public.key
```

On worker1 (`/etc/wireguard/wg0.conf`), replace the keys and peer addresses:

```ini
[Interface]
Address = 10.100.0.11/32
ListenPort = 51820
PrivateKey = <worker1 private key>
PostUp = sysctl -w net.ipv4.ip_forward=1

[Peer]
# worker2
PublicKey = <worker2 public key>
AllowedIPs = 10.100.0.12/32, 10.99.2.0/24

[Peer]
# worker3
PublicKey = <worker3 public key>
AllowedIPs = 10.100.0.13/32, 10.99.3.0/24
```

worker2 uses `Address = 10.100.0.12/32` and allows `10.100.0.11/32, 10.99.1.0/24` plus
`10.100.0.13/32, 10.99.3.0/24`. worker3 mirrors it with `.13` and the other two indexes. Each
worker lists only the _other_ workers; its own `10.99.<index>/24` stays local.

```bash
sudo systemctl enable --now wg-quick@wg0
sudo wg show
ping -c1 10.100.0.12          # from worker1 to worker2
ip route | grep '10.99.2.0'
```

The agent's nftables isolation accepts relay UDP only on `NB_UNDERLAY_INTERFACE`; use `wg0` there.
The interface must be up before `netlabor-agent` starts.

## 2. Head node: controller and NFS export

Install the controller. This command also creates the export directory owner, writes the systemd
unit overrides for the shared path, and creates the first administrator on first start.

```bash
sudo bash /tmp/netlabor-install.sh --controller --yes \
  --public-url https://lab.example.edu \
  --listen 127.0.0.1:8080 \
  --admin-user admin \
  --admin-password 'replace-with-a-long-password' \
  --storage-driver nfs \
  --nfs-image-dir /srv/netlabor/images \
  --template-dir /srv/netlabor/templates
```

`--listen 127.0.0.1:8080` assumes a reverse proxy on the head node. If the controller terminates
TLS itself, use `--listen 0.0.0.0:8080` and add `NB_TLS_CERT`/`NB_TLS_KEY` to
`/etc/netlabor/controller.env` instead.

Create the appliance input directory now; the installer records the path but does not populate it:

```bash
sudo install -d -m 0755 /srv/netlabor/templates
```

Because the browser reaches the controller through the proxy, tell it to trust the proxy's client
address header:

```bash
echo 'NB_TRUST_PROXY=1' | sudo tee -a /etc/netlabor/controller.env
```

Example Caddy site (`/etc/caddy/Caddyfile`):

```
lab.example.edu {
  reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo apt install -y caddy
sudo systemctl reload caddy
```

Caddy forwards WebSocket upgrades and streams large uploads. With nginx, set
`client_max_body_size 0`, `proxy_request_buffering off`, a long `proxy_read_timeout`, and the
`Upgrade`/`Connection` headers; otherwise uploads and consoles fail.

Start the controller and check it:

```bash
sudo systemctl enable --now netlabor-controller
curl -fsS https://lab.example.edu/healthz
```

The installer keeps `NB_ADMIN_PASSWORD` in `/etc/netlabor/controller.env` so it can create the
first administrator. After the first sign-in, remove that line and restart the controller; otherwise
the bootstrap password stays in a readable environment file.

### NFS export

```bash
sudo apt install -y nfs-kernel-server
sudo mkdir -p /srv/netlabor/images
sudo chown netlabor-controller:netlabor-controller /srv/netlabor/images
sudo chmod 0755 /srv/netlabor/images
```

`/etc/exports` — list the three worker management IPs explicitly, not the whole student subnet:

```ini
/srv/netlabor/images 10.0.10.12(rw,sync,no_subtree_check,root_squash) 10.0.10.13(rw,sync,no_subtree_check,root_squash) 10.0.10.14(rw,sync,no_subtree_check,root_squash)
```

```bash
sudo exportfs -ra
sudo systemctl enable --now nfs-server
sudo exportfs -v
```

Only the controller writes the image store. Workers mount it read-only; the agent verifies every
image by sha256 and the controller deletes shared copies during image prune.

If you also run an agent on the head node, install it after the controller with
`--agent --storage-driver nfs --nfs-image-dir /srv/netlabor/images --project-dir ...` and a local
`NB_PROJECT_DIR`; do not put node disks on the export.

## 3. Workers: mounts, agent install, registration

On each worker, mount the export at the same path the controller uses:

```bash
sudo mkdir -p /srv/netlabor/images /mnt/local/netlabor/projects
sudo mount -t nfs -o ro,nosuid,nodev,vers=4.2 10.0.10.11:/srv/netlabor/images /srv/netlabor/images
findmnt /srv/netlabor/images
```

Persist it in `/etc/fstab`:

```ini
10.0.10.11:/srv/netlabor/images /srv/netlabor/images nfs ro,nosuid,nodev,_netdev,vers=4.2 0 0
```

Do **not** use `nofail`: the agent must not start when the shared image store is missing.

Register the compute first, from the UI: **Computes → Add compute**. Use the worker's management URL
(`http://10.0.10.12:8081`), the WireGuard address as **Underlay host** (`10.100.0.11`), and keep the
token and underlay index the panel shows. Then install the agent with that token (no admin password
on the workers):

```bash
sudo bash /tmp/netlabor-install.sh --agent --yes \
  --controller-url https://lab.example.edu \
  --token '<compute token>' \
  --underlay-index 1 \
  --agent-url http://10.0.10.12:8081 \
  --underlay-host 10.100.0.11 \
  --underlay-interface wg0 \
  --storage-driver nfs \
  --nfs-image-dir /srv/netlabor/images \
  --project-dir /mnt/local/netlabor/projects
```

Add `--with-docker` if workers run container nodes and `--with-nat` on the worker(s) that should
host NAT nodes. The installer writes `/etc/netlabor/agent.env`; the systemd unit waits for both
`/srv/netlabor/images` and `/mnt/local/netlabor/projects`.

Plain-HTTP agent URLs need one controller setting. Add it once on the head node, then restart the
controller:

```bash
echo 'NB_ALLOW_INSECURE_AGENT=1' | sudo tee -a /etc/netlabor/controller.env
sudo systemctl restart netlabor-controller
```

This is acceptable only when the management network is firewalled from students. With publicly
reachable agents, terminate TLS on the agents and use `https://` agent URLs instead.

Start each agent and repeat with index 2 on worker2 and index 3 on worker3:

```bash
sudo systemctl enable --now netlabor-agent
sudo systemctl status netlabor-agent --no-pager
```

Alternatively, let the installer register the worker itself: pass `--admin-password` instead of
`--token` and omit `--underlay-index`. It contacts the controller, allocates the index, writes the
token, and starts the agent. The token route is preferred because the admin password never appears
on a worker.

## 4. Firewall

| Host    | Allow                                                                                        |
| ------- | -------------------------------------------------------------------------------------------- |
| head    | 443 from campus; 2049 from `10.0.10.12–14`; 8081 from workers only if the head runs an agent |
| workers | 8081 from `10.0.10.11` only; 51820/udp from the other workers; SSH from administrators       |
| all     | outbound DNS, NTP, and package repositories                                                  |

Never expose agent port 8081 to students. NFS should also be management-only.

## 5. Verify the cluster

1. **Computes** shows head (if installed) and all three workers online, with their capabilities.
2. Library → Images: upload one small image. It should report one shared replica and be readable on
   every worker:
   ```bash
   ls -l /srv/netlabor/images/<sha256>/
   ```
3. Create a project, put a QEMU node on worker1 and a VPCS node on worker2, start both, and connect
   them. The link must become `active`, and the console must open from the browser.
4. From worker1, confirm the peer project network is routed over WireGuard:
   ```bash
   ip route get 10.99.2.1
   ```
5. Restart one agent and confirm the compute returns online and existing labs on the other computes
   keep forwarding.

## 6. Templates and images

Put appliance bundles in `NB_TEMPLATE_DIR` (`/srv/netlabor/templates` above). The importer writes
library images into the shared image directory, so run it on the head node with the controller's
database URL. It is a checkout script, not part of the release binary:

```bash
git clone https://github.com/nemvince/netlabor.git /opt/netlabor-src
cd /opt/netlabor-src
bun install
sudo -u netlabor-controller env \
  NB_DATABASE_URL='<from /etc/netlabor/controller.env>' \
  NB_STORAGE_DRIVER=nfs \
  NB_NFS_IMAGE_DIR=/srv/netlabor/images \
  NB_TEMPLATE_DIR=/srv/netlabor/templates \
  /path/to/bun run import:appliances --dry-run
```

Remove `--dry-run` after checking the mapping. Images not understood by the importer can be uploaded
through **Library → Images** and selected in a template.

Online appliance builds write into the same image directory. The workers mount the export
read-only, so build on the head node (or give the builder a writable mount and export it with
`all_squash` mapped to the controller uid). Otherwise the build job fails with a permission error
and leaves the shared store untouched.

## 7. Single sign-on

For Microsoft Entra, register the app, add
`https://lab.example.edu/auth/oidc/<provider-id>/callback`, and use the tenant issuer
`https://login.microsoftonline.com/<tenant-id>/v2.0`. Leave the provider default role empty so new
students land in the `pending` role; approve them from **Settings → Users** by assigning a real
role. See [Operations](/operations#microsoft-entra-id) for claim and group details.

## Day two

- Back up PostgreSQL and `/srv/netlabor/images` from the head node, and back up
  `/etc/netlabor/*.env`.
- Monitor `/healthz`, the NFS mount, disk space under `/srv/netlabor/images`, and each worker's
  `NB_PROJECT_DIR`.
- Upgrades replace the binaries and restart the controller, then the agents. There is no rolling
  upgrade; schedule a window.
- Student disks live only on the workers. Snapshots and exports are the portable copies, and both
  consume head-node staging space.

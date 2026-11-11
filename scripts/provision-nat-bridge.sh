#!/usr/bin/env bash
# Provision the host NAT bridge used by Netlabor NAT nodes.
# Netlabor does not run DHCP or NAT itself; this script creates a small
# DHCP+NAT segment for labs on a single host.
set -euo pipefail

BRIDGE="${NB_NAT_BRIDGE:-nb-nat}"
ADDRESS="${NB_NAT_ADDRESS:-10.10.99.1/24}"
PREFIX="${ADDRESS#*/}"
NETWORK="${ADDRESS%/*}"
RANGE="${NB_NAT_DHCP_RANGE:-10.10.99.100,10.10.99.199,12h}"
UPLINK="${NB_NAT_UPLINK:-$(ip route show default | awk '{print $5; exit}')}"
DNS="${NB_NAT_DNS:-1.1.1.1,9.9.9.9}"

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi
if [ -z "$UPLINK" ]; then
  echo "no default uplink found; set NB_NAT_UPLINK" >&2
  exit 1
fi

if ! ip link show "$BRIDGE" >/dev/null 2>&1; then
  ip link add "$BRIDGE" type bridge
fi
ip addr replace "$ADDRESS" dev "$BRIDGE"
ip link set "$BRIDGE" up
sysctl -w net.ipv4.ip_forward=1 >/dev/null

# Allow NAT-node veth traffic through Netlabor's isolation table. NAT nodes use
# host veths named nt<hash>h; the rule is repeated by the agent on startup.
if nft list table inet netlabor >/dev/null 2>&1; then
  if ! nft list chain inet netlabor forward 2>/dev/null | grep -q 'nt\*'; then
    nft add rule inet netlabor forward iifname 'nt*' accept
  fi
  # Forwarded guest traffic leaves the bridge itself, not the nt* veths.
  if ! nft list chain inet netlabor forward 2>/dev/null | grep -q "iifname \"$BRIDGE\""; then
    nft add rule inet netlabor forward iifname "$BRIDGE" accept
  fi
fi

UPLINK_ACCEPT="-i $BRIDGE -o $UPLINK"
REPLY_ACCEPT="-i $UPLINK -o $BRIDGE"
iptables -C FORWARD $UPLINK_ACCEPT -j ACCEPT 2>/dev/null || iptables -A FORWARD $UPLINK_ACCEPT -j ACCEPT
iptables -C FORWARD $REPLY_ACCEPT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD $REPLY_ACCEPT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -t nat -C POSTROUTING -s "$NETWORK/$PREFIX" -o "$UPLINK" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -s "$NETWORK/$PREFIX" -o "$UPLINK" -j MASQUERADE

if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --zone=trusted --add-interface="$BRIDGE" >/dev/null 2>&1 || true
  firewall-cmd --permanent --zone=trusted --add-interface="$BRIDGE" >/dev/null 2>&1 || true
fi

mkdir -p /run/netlabor
if [ -f /run/netlabor/nat-dnsmasq.pid ]; then
  kill "$(cat /run/netlabor/nat-dnsmasq.pid)" 2>/dev/null || true
  rm -f /run/netlabor/nat-dnsmasq.pid
fi
DNS_ARGS=""
IFS=',' read -ra DNS_SERVERS <<< "$DNS"
for server in "${DNS_SERVERS[@]}"; do DNS_ARGS="$DNS_ARGS --server=$server"; done
# shellcheck disable=SC2086
dnsmasq --conf-file=/dev/null \
  --interface="$BRIDGE" --bind-interfaces \
  --dhcp-authoritative \
  --dhcp-range="$RANGE" \
  --dhcp-option=3,"$NETWORK" \
  --dhcp-option=6,"$DNS" \
  --no-resolv $DNS_ARGS \
  --pid-file=/run/netlabor/nat-dnsmasq.pid

echo "NAT bridge $BRIDGE ready: $ADDRESS via $UPLINK, DHCP $RANGE"

/** Deterministic interface names for node port anchors (<= 15 characters). */

import type { NodeType } from '@netlabor/contract';
import { shortHex } from '@netlabor/shared';

/** sha256(ownerId:adapter:port) first 10 hex characters. */
export function anchorHash(ownerId: string, adapter: number, port: number): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(`${ownerId}:${adapter}:${port}`);
  return shortHex(Buffer.from(hasher.digest()).toString('hex'), 10);
}

export interface AnchorNames {
  /** Kernel interface inside the project namespace, if the port has one. */
  interfaceName: string | null;
  /** TAP owned by the emulator, created through ubridge. */
  tapName: string | null;
  /** Host-side veth endpoint (Docker, Cloud). */
  hostEnd: string | null;
  /** Namespace-side veth endpoint (Docker, Cloud). */
  peerEnd: string | null;
  /** Node-level bridge (switch/hub) the anchor is enslaved to. */
  bridgeName: string | null;
}

export function anchorNames(
  nodeType: NodeType,
  ownerId: string,
  adapter: number,
  port: number,
): AnchorNames {
  const hash = anchorHash(ownerId, adapter, port);
  switch (nodeType) {
    case 'qemu':
    case 'iou':
      return {
        interfaceName: `t${hash}`,
        tapName: `t${hash}`,
        hostEnd: null,
        peerEnd: null,
        bridgeName: null,
      };
    case 'dynamips':
    case 'vpcs':
      return { interfaceName: null, tapName: null, hostEnd: null, peerEnd: null, bridgeName: null };
    case 'docker':
      return {
        interfaceName: `v${hash}h`,
        tapName: null,
        hostEnd: `v${hash}h`,
        peerEnd: `v${hash}p`,
        bridgeName: null,
      };
    case 'cloud':
      return {
        interfaceName: `c${hash}`,
        tapName: null,
        hostEnd: null,
        peerEnd: null,
        bridgeName: null,
      };
    case 'nat':
      return {
        interfaceName: `c${hash}`,
        tapName: null,
        hostEnd: null,
        peerEnd: null,
        bridgeName: null,
      };
    case 'ethernet_switch':
      return {
        interfaceName: `sp${hash}l`,
        tapName: null,
        hostEnd: `sp${hash}p`,
        peerEnd: `sp${hash}l`,
        bridgeName: `sw${shortHex(ownerId, 10)}`,
      };
    case 'ethernet_hub':
      return {
        interfaceName: `sp${hash}l`,
        tapName: null,
        hostEnd: `sp${hash}p`,
        peerEnd: `sp${hash}l`,
        bridgeName: `hb${shortHex(ownerId, 10)}`,
      };
    case 'atm_switch':
    case 'frame_relay_switch':
      return { interfaceName: null, tapName: null, hostEnd: null, peerEnd: null, bridgeName: null };
  }
}

/** Names of link dataplane objects. */
export function linkBridgeName(linkId: string): string {
  return `lk${shortHex(linkId, 10)}`;
}

export function linkRelayTapName(linkId: string): string {
  return `tr${shortHex(linkId, 10)}`;
}

export function linkKernelBridgeName(linkId: string): string {
  return `lk${shortHex(linkId, 10)}k`;
}

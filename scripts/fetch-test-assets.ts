/**
 * Fetch optional test assets into e2e/assets (never committed).
 * Usage: bun run scripts/fetch-test-assets.ts [--force]
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const assetsDir = path.join(root, 'e2e/assets');
const force = process.argv.includes('--force');

interface Asset {
  name: string;
  url: string;
  minBytes: number;
  note?: string;
}

const ASSETS: Asset[] = [
  {
    name: 'alpine.qcow2',
    url: 'https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/cloud/nocloud_alpine-3.21.0-x86_64-bios-cloudinit-r0.qcow2',
    minBytes: 20 * 1024 * 1024,
    note: 'Alpine cloud image used by QEMU and Docker-adjacent tests',
  },
];

await mkdir(assetsDir, { recursive: true });

for (const asset of ASSETS) {
  const target = path.join(assetsDir, asset.name);
  const existing = Bun.file(target);
  if (!force && (await existing.exists()) && existing.size > asset.minBytes) {
    console.log(`skip ${asset.name} (${Math.round(existing.size / 1e6)} MB)`);
    continue;
  }
  console.log(`fetching ${asset.name} …`);
  const response = await fetch(asset.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${asset.url} → HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < asset.minBytes) {
    throw new Error(`${asset.name} is suspiciously small (${buffer.byteLength} bytes)`);
  }
  await Bun.write(target, buffer);
  console.log(`wrote ${asset.name} (${Math.round(buffer.byteLength / 1e6)} MB)`);
}

const iou = process.env.NB_TEST_IOU_IMAGE;
const ios = process.env.NB_TEST_IOS_IMAGE;
if (!iou) console.log('note: set NB_TEST_IOU_IMAGE to run IOU adapter tests');
if (!ios) console.log('note: set NB_TEST_IOS_IMAGE to run Dynamips adapter tests');

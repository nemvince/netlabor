#!/usr/bin/env bun
/**
 * Import GNS3 appliance bundles (.gns3a + image files) into Netlabor.
 *
 * Usage: bun run import:appliances [--dir <path>] [--dry-run]
 *
 * Reads every *.gns3a under the directory, registers its images in the image
 * library (hard-linked or converted to qcow2) and creates system templates.
 * Requires write access to the compute image root (run with sudo).
 */

import { createHash } from 'node:crypto';
import { copyFile, link, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { SQL } from 'bun';

interface Gns3Image {
  filename: string;
  version: string;
  md5sum?: string;
  filesize?: number;
}

interface Gns3Appliance {
  appliance_id: string;
  name: string;
  category?: string;
  description?: string;
  symbol?: string;
  images?: Gns3Image[];
  qemu?: Record<string, unknown>;
  iou?: Record<string, unknown>;
  docker?: Record<string, unknown>;
}

interface ImportOptions {
  dir: string;
  dryRun: boolean;
}

interface ImportedImage {
  id: string;
  name: string;
  sha256: string;
  filename: string;
  kind: 'qemu' | 'iou';
}

const CATEGORY_MAP: Record<string, string> = {
  router: 'Routers',
  multilayer_switch: 'Switches',
  switch: 'Switches',
  firewall: 'Firewalls',
  guest: 'End devices',
};

const LOCAL_DB = process.env.NB_DATABASE_URL ?? 'postgres://nya@127.0.0.1:5432/netlabor';
// Write where the agents read: the shared NFS directory in a clustered install.
const IMAGE_ROOT =
  process.env.NB_STORAGE_DRIVER === 'nfs'
    ? (process.env.NB_NFS_IMAGE_DIR ?? '/srv/netlabor/images')
    : (process.env.NB_IMAGE_DIR ?? '/var/lib/netlabor/images');
const CACHE_PATH = path.join(IMAGE_ROOT, '.gns3a-import-cache.json');

function parseArgs(argv: string[]): ImportOptions {
  let dir = process.env.NB_TEMPLATE_DIR ?? 'appliances';
  let dryRun = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dir') dir = argv[++index] ?? dir;
    else if (arg === '--dry-run') dryRun = true;
    else if (!arg.startsWith('-')) dir = arg;
  }
  return { dir: path.resolve(dir), dryRun };
}

function applianceFiles(dir: string): Promise<string[]> {
  const glob = new Bun.Glob('**/*.gns3a');
  return Array.fromAsync(glob.scan({ cwd: dir, absolute: true }));
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of Bun.file(filePath).stream()) hash.update(chunk);
  return hash.digest('hex');
}

async function run(cmd: string[]): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: 'ignore', stderr: 'pipe' });
  const stderr = await new Response(proc.stderr).text();
  return { code: await proc.exited, stderr };
}

async function detectFormat(filePath: string): Promise<string> {
  const result = Bun.spawnSync(['qemu-img', 'info', '--output=json', filePath]);
  if (result.exitCode !== 0) return 'unknown';
  try {
    const info = JSON.parse(result.stdout.toString()) as { format?: string };
    return info.format ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function optionsFromQemu(qemu: Record<string, unknown>): {
  machineType?: string;
  cpuModel?: string;
  options: string[];
  consoleType: 'telnet' | 'vnc';
} {
  const raw = typeof qemu.options === 'string' ? qemu.options : '';
  const tokens = raw.match(/"[^"]*"|\S+/g)?.map((token) => token.replace(/^"|"$/g, '')) ?? [];
  const options: string[] = [];
  let machineType: string | undefined;
  let cpuModel: string | undefined;
  const dropped = new Set([
    '-name',
    '-m',
    '-smp',
    '-machine',
    '-cpu',
    '-nographic',
    '-display',
    '-vga',
    '-serial',
    '-monitor',
    '-enable-kvm',
  ]);
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (token === '-machine') {
      const value = tokens[++index] ?? '';
      const type = /type=([^,]+)/.exec(value)?.[1];
      if (type) machineType = type;
      continue;
    }
    if (token === '-cpu') {
      cpuModel = tokens[++index] ?? undefined;
      continue;
    }
    if (token === '-device') {
      const device = tokens[++index] ?? '';
      if (device === 'qemu-xhci' || device === 'usb-tablet') options.push('-device', device);
      continue;
    }
    if (dropped.has(token)) {
      if (token !== '-nographic' && token !== '-enable-kvm') index++;
      continue;
    }
    options.push(token);
  }
  const rawConsole = typeof qemu.console_type === 'string' ? qemu.console_type : 'telnet';
  return {
    machineType,
    cpuModel,
    options,
    consoleType: rawConsole === 'telnet' ? 'telnet' : 'vnc',
  };
}

function symbolFor(appliance: Gns3Appliance, nodeType: string): string {
  if (typeof appliance.symbol === 'string' && appliance.symbol.length > 0) {
    const known = ['router', 'switch', 'firewall', 'server', 'pc', 'docker', 'cloud', 'generic'];
    if (known.includes(appliance.symbol)) return appliance.symbol;
  }
  if (appliance.category === 'firewall') return 'firewall';
  if (appliance.category === 'multilayer_switch') return 'switch';
  if (appliance.category === 'guest') {
    return /server/i.test(appliance.name) ? 'server' : 'pc';
  }
  if (nodeType === 'docker') return 'docker';
  if (nodeType === 'iou') return appliance.category === 'multilayer_switch' ? 'switch' : 'router';
  return 'router';
}

async function ensureImage(
  appliance: Gns3Appliance,
  source: string,
  filename: string,
  version: string,
  kind: 'qemu' | 'iou',
  cache: Record<string, { size: number; mtimeMs: number; sha256: string; filename: string }>,
  dryRun: boolean,
): Promise<ImportedImage> {
  const real = await stat(source);
  const cached = cache[source];
  let sha256: string;
  let storedFilename = filename;
  if (cached && cached.size === real.size && cached.mtimeMs === real.mtimeMs) {
    sha256 = cached.sha256;
    storedFilename = cached.filename;
  } else {
    sha256 = await sha256File(source);
    cache[source] = { size: real.size, mtimeMs: real.mtimeMs, sha256, filename: storedFilename };
  }
  const displayName = `${appliance.name} ${version}`.trim();

  if (dryRun) {
    return { id: 'dry-run', name: displayName, sha256, filename: storedFilename, kind };
  }

  const targetDir = path.join(IMAGE_ROOT, sha256);
  let target = path.join(targetDir, storedFilename);
  const existing = await stat(target).catch(() => null);
  if (!existing) {
    await mkdir(targetDir, { recursive: true, mode: 0o755 });
    const format = kind === 'qemu' ? await detectFormat(source) : 'elf';
    if (kind === 'qemu' && format !== 'qcow2') {
      storedFilename = `${path.parse(filename).name}.qcow2`;
      const temp = path.join(IMAGE_ROOT, `.import-${crypto.randomUUID()}.qcow2`);
      const converted = await run(['qemu-img', 'convert', '-O', 'qcow2', source, temp]);
      if (converted.code !== 0) {
        await rm(temp, { force: true });
        throw new Error(`qemu-img convert failed for ${source}: ${converted.stderr.trim()}`);
      }
      sha256 = await sha256File(temp);
      const finalDir = path.join(IMAGE_ROOT, sha256);
      target = path.join(finalDir, storedFilename);
      if (!(await Bun.file(target).exists())) {
        await mkdir(finalDir, { recursive: true, mode: 0o755 });
        await rename(temp, target);
      } else {
        await rm(temp, { force: true });
      }
      await rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
    } else {
      try {
        await link(source, target);
      } catch {
        await copyFile(source, target);
      }
    }
    cache[source] = { size: real.size, mtimeMs: real.mtimeMs, sha256, filename: storedFilename };
  }
  return {
    id: '',
    name: displayName,
    sha256,
    filename: storedFilename,
    kind,
  };
}

const sql = new SQL(LOCAL_DB);

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(IMAGE_ROOT, { recursive: true, mode: 0o755 }).catch(() => undefined);
  const cache = (await Bun.file(CACHE_PATH)
    .json()
    .catch(() => ({}))) as Record<
    string,
    { size: number; mtimeMs: number; sha256: string; filename: string }
  >;

  const computes = await sql`SELECT id FROM computes WHERE status = 'online' ORDER BY name LIMIT 1`;
  const computeId = computes[0]?.id as string | undefined;
  if (!computeId) throw new Error('no online compute; start one before importing appliances');
  const users = await sql`SELECT id FROM users WHERE is_active ORDER BY created_at LIMIT 1`;
  const userId = (users[0]?.id as string | undefined) ?? null;

  const files = await applianceFiles(opts.dir);
  if (files.length === 0) throw new Error(`no .gns3a files found under ${opts.dir}`);

  for (const file of files) {
    const appliance = (await Bun.file(file).json()) as Gns3Appliance;
    const nodeType = appliance.qemu
      ? 'qemu'
      : appliance.iou
        ? 'iou'
        : appliance.docker
          ? 'docker'
          : null;
    if (!nodeType) {
      console.log(`skip ${appliance.name}: unsupported appliance type`);
      continue;
    }
    const category = CATEGORY_MAP[appliance.category ?? ''] ?? 'General';
    const symbol = symbolFor(appliance, nodeType);

    const imported: ImportedImage[] = [];
    const images = appliance.images ?? [];
    if (nodeType === 'qemu' || nodeType === 'iou') {
      for (const image of images) {
        const source = path.join(path.dirname(file), image.filename);
        const exists = await Bun.file(source).exists();
        if (!exists) {
          console.log(`skip ${appliance.name}: missing ${image.filename}`);
          continue;
        }
        const kind = nodeType === 'qemu' ? 'qemu' : 'iou';
        const result = await ensureImage(
          appliance,
          source,
          image.filename,
          image.version,
          kind,
          cache,
          opts.dryRun,
        );
        imported.push(result);
        if (opts.dryRun) {
          console.log(`dry-run ${appliance.name}: ${source} -> ${result.sha256.slice(0, 12)}`);
          continue;
        }
        const metadata = {
          format: 'qcow2',
          validation: kind === 'qemu' ? 'qemu-img' : 'elf',
          source: 'gns3a',
          applianceId: appliance.appliance_id,
          version: image.version,
          originalFilename: image.filename,
          importedAt: new Date().toISOString(),
        };
        const rows = await sql`
          INSERT INTO images (id, name, kind, filename, sha256, size_bytes, metadata, created_by)
          VALUES (${crypto.randomUUID()}, ${result.name}, ${kind}, ${result.filename},
                  ${result.sha256}, ${(await stat(path.join(IMAGE_ROOT, result.sha256, result.filename))).size},
                  ${metadata}::jsonb, ${userId})
          ON CONFLICT (sha256) DO NOTHING
          RETURNING id, name, sha256, filename, kind`;
        let record = rows[0] as ImportedImage | undefined;
        if (!record) {
          const existingRows = await sql`
            SELECT id, name, sha256, filename, kind FROM images WHERE sha256 = ${result.sha256}`;
          record = existingRows[0] as ImportedImage | undefined;
        }
        if (!record) throw new Error(`image insert failed for ${image.filename}`);
        result.id = record.id;
        result.name = record.name;
        result.filename = record.filename;
        result.kind = record.kind;
        const replicaPath = path.join(IMAGE_ROOT, result.sha256, result.filename);
        await sql`
          INSERT INTO image_replicas (image_id, compute_id, state, path, verified_at)
          VALUES (${result.id}, ${computeId}, 'present', ${replicaPath}, now())
          ON CONFLICT (image_id, compute_id) DO UPDATE SET
            state = 'present', path = EXCLUDED.path, verified_at = now()`;
        console.log(`image ${result.name} -> ${result.sha256.slice(0, 12)}`);
      }
    }

    let properties: Record<string, unknown> = {};
    const requiredImages: Record<string, unknown>[] = [];
    if (nodeType === 'qemu') {
      const qemu = appliance.qemu ?? {};
      const parsed = optionsFromQemu(qemu);
      const primaryImage = imported[0];
      properties = {
        platform: typeof qemu.arch === 'string' ? qemu.arch : 'x86_64',
        ram: Number(qemu.ram ?? 1024),
        cpus: Number(qemu.cpus ?? 1),
        adapters: Number(qemu.adapters ?? 1),
        adapterType: typeof qemu.adapter_type === 'string' ? qemu.adapter_type : 'e1000',
        consoleType: parsed.consoleType,
        consoleAutoStart: true,
        bootPriority: typeof qemu.boot_priority === 'string' ? qemu.boot_priority : 'c',
        machineType: parsed.machineType,
        cpuModel: parsed.cpuModel,
        options: parsed.options,
        linkedClone: true,
        disks: primaryImage
          ? {
              hda: {
                imageId: primaryImage.id,
                interface:
                  typeof qemu.hda_disk_interface === 'string' ? qemu.hda_disk_interface : 'ide',
                format: 'qcow2',
              },
            }
          : {},
      };
      if (!primaryImage) console.log(`warning ${appliance.name}: no image imported`);
    } else if (nodeType === 'iou') {
      const iou = appliance.iou ?? {};
      const primaryImage = imported[0];
      properties = {
        imageId: primaryImage?.id ?? null,
        licenseCheck: false,
        ram: Number(iou.ram ?? 256),
        nvram: Number(iou.nvram ?? 128),
        ethernetAdapters: Number(iou.ethernet_adapters ?? 2),
        serialAdapters: Number(iou.serial_adapters ?? 0),
        useDefaultIouValues: true,
        l1Keepalives: false,
        consoleType: 'telnet',
        consoleAutoStart: true,
      };
    } else {
      const docker = appliance.docker ?? {};
      const environment =
        typeof docker.environment === 'string'
          ? docker.environment
              .split(/[,\n]/)
              .map((line) => line.trim())
              .filter(Boolean)
              .join('\n')
          : '';
      properties = {
        imageName: typeof docker.image === 'string' ? docker.image : 'alpine:3.20',
        adapters: Number(docker.adapters ?? 1),
        startCommand: typeof docker.start_command === 'string' ? docker.start_command : null,
        environment,
        consoleType:
          typeof docker.console_type === 'string' && docker.console_type === 'vnc'
            ? 'vnc'
            : 'telnet',
        consoleAutoStart: true,
      };
    }

    for (const image of imported) {
      requiredImages.push({
        kind: image.kind,
        name: image.name,
        filenamePattern: image.filename,
        sha256: image.sha256,
      });
    }

    if (opts.dryRun) {
      console.log(`dry-run template ${appliance.name} (${nodeType}, ${category})`);
      continue;
    }

    const existing = await sql`
      SELECT id, builtin FROM templates WHERE name = ${appliance.name} AND deleted_at IS NULL`;
    if (existing[0] && !existing[0].builtin) {
      console.log(`skip template ${appliance.name}: a user template with that name exists`);
      continue;
    }
    if (existing[0]) {
      await sql`
        UPDATE templates SET
          node_type = ${nodeType},
          category = ${category},
          symbol = ${symbol},
          default_name_format = ${'{name}-{index}'},
          properties = ${properties}::jsonb,
          required_images = ${requiredImages}::jsonb,
          builtin = true,
          updated_at = now()
        WHERE id = ${existing[0].id}`;
      console.log(`template ${appliance.name} updated`);
    } else {
      await sql`
        INSERT INTO templates (id, name, node_type, category, symbol, default_name_format,
                               properties, required_images, faults, builtin, created_by)
        VALUES (${crypto.randomUUID()}, ${appliance.name}, ${nodeType}, ${category}, ${symbol},
                ${'{name}-{index}'}, ${properties}::jsonb, ${requiredImages}::jsonb,
                '[]'::jsonb, true, ${userId})`;
      console.log(`template ${appliance.name} created (${nodeType}, ${category})`);
    }
  }

  if (!opts.dryRun) {
    await Bun.write(CACHE_PATH, JSON.stringify(cache, null, 2));
  }
  await sql.close();
}

await main();

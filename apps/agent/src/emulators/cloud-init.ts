/** Build a NoCloud seed ISO from node cloud-init properties. */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cloudInitDefaultUser } from '@netlabor/catalog';
import { AppError, type OsFamily } from '@netlabor/contract';
import type { NodeContext } from '../dataplane/node.ts';

function quoted(value: string): string {
  return JSON.stringify(value);
}

function customText(properties: Record<string, unknown>, key: string): string | null {
  const value = properties[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function networkConfig(properties: Record<string, unknown>): string {
  const mode = properties.cloudInitNetworkMode === 'static' ? 'static' : 'dhcp';
  if (mode === 'dhcp') {
    return [
      'version: 2',
      'ethernets:',
      '  primary:',
      '    match:',
      '      name: "en*"',
      '    dhcp4: true',
      '',
    ].join('\n');
  }
  const address =
    typeof properties.cloudInitIpAddress === 'string' ? properties.cloudInitIpAddress.trim() : '';
  if (!address) {
    throw new AppError('BAD_REQUEST', 'static cloud-init networking requires an IP address');
  }
  const dns =
    typeof properties.cloudInitDns === 'string'
      ? properties.cloudInitDns
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [];
  const lines = ['version: 2', 'ethernets:', '  primary:', '    match:', '      name: "en*"'];
  lines.push('    addresses:', `      - ${quoted(address)}`);
  const gateway =
    typeof properties.cloudInitGateway === 'string' ? properties.cloudInitGateway.trim() : '';
  if (gateway) {
    lines.push('    routes:', '      - to: default', `        via: ${quoted(gateway)}`);
  }
  if (dns.length > 0) {
    lines.push('    nameservers:', '      addresses:');
    for (const entry of dns) lines.push(`        - ${quoted(entry)}`);
  }
  lines.push('');
  return lines.join('\n');
}

function userData(ctx: NodeContext, properties: Record<string, unknown>): string {
  const user =
    typeof properties.cloudInitUser === 'string' && properties.cloudInitUser.trim()
      ? properties.cloudInitUser.trim()
      : (cloudInitDefaultUser[properties.osFamily as OsFamily] ?? 'debian');
  const password =
    typeof properties.cloudInitPassword === 'string' ? properties.cloudInitPassword : '';
  const hostname =
    typeof properties.cloudInitHostname === 'string' && properties.cloudInitHostname.trim()
      ? properties.cloudInitHostname.trim()
      : ctx.spec.name;
  const sshKey =
    typeof properties.cloudInitSshKey === 'string' ? properties.cloudInitSshKey.trim() : '';
  const desktop = properties.cloudInitVariant === 'desktop';
  const autoLogin = desktop && properties.cloudInitAutoLogin !== false;
  const alpine = properties.osFamily === 'alpine';
  const lines = [
    '#cloud-config',
    `hostname: ${quoted(hostname)}`,
    'manage_etc_hosts: true',
    'ssh_pwauth: true',
    'chpasswd:',
    '  expire: false',
    'users:',
    `  - name: ${quoted(user)}`,
    '    gecos: Netlabor cloud user',
    '    groups: [sudo]',
    '    shell: /bin/bash',
    '    sudo: ALL=(ALL) NOPASSWD:ALL',
  ];
  if (password !== '') {
    lines.push('    lock_passwd: false', `    plain_text_passwd: ${quoted(password)}`);
  } else {
    lines.push('    lock_passwd: true');
  }
  if (sshKey !== '') {
    lines.push('    ssh_authorized_keys:');
    for (const key of sshKey
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean)) {
      lines.push(`      - ${quoted(key)}`);
    }
  }
  if (desktop) {
    lines.push(
      'package_update: true',
      'packages:',
      '  - xfce4',
      '  - xinit',
      '  - xorg',
      '  - lightdm',
      '  - lightdm-gtk-greeter',
      '  - qemu-guest-agent',
    );
  }
  if (desktop) {
    lines.push(
      'write_files:',
      '  - path: /etc/lightdm/lightdm.conf.d/60-logind.conf',
      '    permissions: "0644"',
      '    content: |',
      '      [LightDM]',
      '      logind-check-graphical=false',
    );
    if (autoLogin) {
      lines.push(
        '  - path: /etc/lightdm/lightdm.conf.d/60-netlabor.conf',
        '    permissions: "0644"',
        '    content: |',
        '      [Seat:*]',
        `      autologin-user=${user}`,
        '      autologin-user-timeout=0',
      );
    }
  }
  if (alpine) {
    // OpenRC image: systemd units do not exist; enable the SSH service instead.
    lines.push('runcmd:', '  - [rc-update, add, sshd, default]');
  } else {
    lines.push('runcmd:', '  - [systemctl, enable, --now, serial-getty@ttyS0.service]');
  }
  if (desktop) {
    lines.push(
      '  - [systemctl, enable, --now, qemu-guest-agent]',
      '  - [systemctl, set-default, graphical.target]',
      '  - [systemctl, enable, lightdm]',
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Effective NoCloud files. Custom content is passed through verbatim, so a
 * generated seed (for example railink's per-VM user-data) can be attached
 * without teaching the control plane its YAML schema.
 */
export function cloudInitSeed(
  ctx: NodeContext,
  properties: Record<string, unknown> = ctx.spec.properties,
): { metaData: string; userData: string; networkConfig: string } {
  const userDataText = customText(properties, 'cloudInitUserData') ?? userData(ctx, properties);
  const networkConfigText =
    customText(properties, 'cloudInitNetworkConfig') ?? networkConfig(properties);
  const customMetaData = customText(properties, 'cloudInitMetaData');
  if (customMetaData !== null) {
    return { metaData: customMetaData, userData: userDataText, networkConfig: networkConfigText };
  }
  const seedHash = new Bun.CryptoHasher('sha256')
    .update(`${userDataText}\n${networkConfigText}`)
    .digest('hex')
    .slice(0, 12);
  const hostname =
    typeof properties.cloudInitHostname === 'string' && properties.cloudInitHostname.trim()
      ? properties.cloudInitHostname.trim()
      : ctx.spec.name;
  return {
    metaData: `instance-id: ${ctx.spec.nodeId}-${seedHash}\nlocal-hostname: ${hostname}\n`,
    userData: userDataText,
    networkConfig: networkConfigText,
  };
}

export interface CloudInitSeedFiles {
  userData: string;
  metaData: string;
  /** NoCloud network-config; omitted from the ISO when undefined. */
  networkConfig?: string;
}

/**
 * Write a NoCloud seed directory and pack it into seed.iso. Shared by node
 * provisioning and appliance builds so both produce identical seed images.
 */
export async function writeCloudInitSeed(dir: string, files: CloudInitSeedFiles): Promise<string> {
  const xorriso = Bun.which('xorriso');
  if (!xorriso) {
    throw new AppError('BINARY_MISSING', 'xorriso is required to build cloud-init seed images');
  }
  await mkdir(dir, { recursive: true, mode: 0o755 });
  const names = ['meta-data', 'user-data'];
  await writeFile(path.join(dir, 'meta-data'), files.metaData);
  await writeFile(path.join(dir, 'user-data'), files.userData);
  if (files.networkConfig !== undefined) {
    await writeFile(path.join(dir, 'network-config'), files.networkConfig);
    names.push('network-config');
  }
  const iso = path.join(dir, 'seed.iso');
  const proc = Bun.spawn(
    [
      xorriso,
      '-as',
      'mkisofs',
      '-volid',
      'cidata',
      '-joliet',
      '-rock',
      '-quiet',
      '-output',
      iso,
      ...names,
    ],
    { cwd: dir, stdout: 'pipe', stderr: 'pipe' },
  );
  const stderr = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) {
    throw new AppError('AGENT_ERROR', 'cloud-init seed image failed', {
      details: stderr.trim(),
    });
  }
  return iso;
}

/** Write the node's NoCloud seed files and build seed.iso; returns its path. */
export async function prepareCloudInit(ctx: NodeContext): Promise<string> {
  return writeCloudInitSeed(path.join(ctx.dir, 'cloud-init'), cloudInitSeed(ctx));
}

/**
 * Emulator properties that reach the compute host: arbitrary QEMU arguments,
 * container host mounts, and host interface mapping. Trusted sources (the
 * appliance importer, admin-authored templates) may set them; an untrusted
 * node or template override is stripped first, keeping what it inherited.
 */

const HOST_LEVEL = new Set([
  'qemuPath',
  'options',
  'machineType',
  'cpuModel',
  'kernelCommandLine',
  'privileged',
  'extraVolumes',
  'extraHosts',
  'startCommand',
  'portsMapping',
  'remoteConsoleHost',
  'remoteConsolePort',
  'remoteConsoleType',
  'remoteConsoleHttpPath',
  'consoleHttpPort',
  'consoleHttpPath',
  'consoleUser',
  'consoleResolution',
]);

export function stripHostLevelProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!HOST_LEVEL.has(key)) out[key] = value;
  }
  return out;
}

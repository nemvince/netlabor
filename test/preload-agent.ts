/** Preload for agent integration tests: requires root and Linux dataplane tools. */

if (process.platform !== 'linux') {
  throw new Error('agent integration tests require Linux');
}
if (Bun.which('ip') === null) {
  throw new Error('agent integration tests require the iproute2 `ip` binary');
}
if (process.getuid?.() !== 0) {
  throw new Error(
    'agent integration tests must run as root (sudo --preserve-env bun run test:agent)',
  );
}
process.env.NB_TEST_AGENT = '1';

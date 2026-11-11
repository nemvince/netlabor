/**
 * Development supervisor: controller (watch), agent (watch), and Vite.
 * The agent needs root for namespaces; when not root it still serves the API
 * so the UI can be developed against reported capabilities.
 */

import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');

const processes = [
  { name: 'controller', cmd: ['bun', '--watch', 'apps/controller/src/index.ts'] },
  { name: 'agent', cmd: ['bun', '--watch', 'apps/agent/src/index.ts'] },
  { name: 'web', cmd: ['bunx', 'vite', '--host', '127.0.0.1'], cwd: path.join(root, 'apps/web') },
];

const children = processes.map((entry) => {
  const child = Bun.spawn(entry.cmd, {
    cwd: entry.cwd ?? root,
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });
  return { name: entry.name, child };
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) child.kill(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const codes = await Promise.all(children.map(({ child }) => child.exited));
const failed = codes.filter((code) => code !== 0);
shutdown('SIGTERM');
process.exit(failed.length > 0 ? 1 : 0);

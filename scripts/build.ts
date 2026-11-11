/** Build controller and agent standalone binaries plus the web bundle. */

import { rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const outDir = path.join(root, 'dist');

await rm(outDir, { recursive: true, force: true });
await Bun.$`mkdir -p ${outDir}`.quiet();

async function compile(name: string, entrypoint: string) {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    compile: { outfile: path.join(outDir, name) },
    minify: false,
    target: 'bun',
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`failed to compile ${name}`);
  }
  console.log(`built ${path.relative(root, path.join(outDir, name))}`);
}

const web = Bun.spawn(['bunx', 'vite', 'build'], {
  cwd: path.join(root, 'apps/web'),
  stdout: 'inherit',
  stderr: 'inherit',
});
const webExit = await web.exited;
if (webExit !== 0) throw new Error('web build failed');
console.log('built apps/web/dist');

await compile('netlabor-controller', path.join(root, 'apps/controller/src/index.ts'));
await compile('netlabor-agent', path.join(root, 'apps/agent/src/index.ts'));

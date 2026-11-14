/** Build controller and agent standalone binaries plus the web bundle. */

import { rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const outDir = path.join(root, 'dist');

await rm(outDir, { recursive: true, force: true });
await Bun.$`mkdir -p ${outDir}`.quiet();

async function compile(name: string, entrypoint: string, assets: string[] = []) {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    compile: { outfile: path.join(outDir, name), assets },
    define: {
      NB_BUILD_VERSION: JSON.stringify(buildVersion),
      NB_WEB_EMBED_DIR: JSON.stringify(path.relative(process.cwd(), webDist)),
    },
    minify: false,
    target: 'bun',
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`failed to compile ${name}`);
  }
  console.log(`built ${path.relative(root, path.join(outDir, name))}`);
}

const webDist = path.join(root, 'apps/web/dist');
const web = Bun.spawn(['bunx', 'vite', 'build'], {
  cwd: path.join(root, 'apps/web'),
  stdout: 'inherit',
  stderr: 'inherit',
});
const webExit = await web.exited;
if (webExit !== 0) throw new Error('web build failed');
console.log('built apps/web/dist');

/** Release tag when building a tagged commit, otherwise the short commit. */
function git(args: string[]): string | null {
  try {
    const proc = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'ignore' });
    const output = proc.stdout.toString().trim();
    return proc.exitCode === 0 && output ? output : null;
  } catch {
    return null;
  }
}

const buildVersion =
  process.env.NB_VERSION ??
  git(['describe', '--tags', '--exact-match'])?.replace(/^v/, '') ??
  git(['rev-parse', '--short=7', 'HEAD']) ??
  'unknown';

await compile('netlabor-controller', path.join(root, 'apps/controller/src/index.ts'), [
  path.relative(process.cwd(), webDist),
]);
await compile('netlabor-agent', path.join(root, 'apps/agent/src/index.ts'));

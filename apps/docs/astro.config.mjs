import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * A page that moves without its navigation entry (or a build that runs while
 * pages are being renamed) leaves a link that 404s. Fail the build instead.
 */
function navIntegrity() {
  return {
    name: 'docs-nav-integrity',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const { flatNav } = await import('./src/lib/nav.ts');
        const root = fileURLToPath(dir);
        const missing = flatNav
          .map((item) => item.href)
          .filter((href) => {
            const file =
              href === '/' ? 'index.html' : path.join(href.replace(/^\//, ''), 'index.html');
            return !existsSync(path.join(root, file));
          });
        if (missing.length > 0) {
          throw new Error(`navigation links without a built page: ${missing.join(', ')}`);
        }
        logger.info(`nav integrity: ${flatNav.length} links resolve to built pages`);
      },
    },
  };
}
const webSrc = fileURLToPath(new URL('../web/src', import.meta.url));
const docsSrc = fileURLToPath(new URL('./src', import.meta.url));

// Static documentation site. The global stylesheet is the web app's own
// styles.css, imported through @web, so the design tokens cannot drift.
export default defineConfig({
  site: 'https://netlabor.invalid',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [react(), mdx(), navIntegrity()],
  markdown: {
    shikiConfig: { theme: 'css-variables', wrap: false },
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: [
        { find: '@web', replacement: webSrc },
        { find: '@docs', replacement: docsSrc },
      ],
    },
    server: {
      fs: { allow: [repoRoot] },
    },
    // Workspace packages export TypeScript source; bundle them for prerender
    // instead of handing Node an unloadable .ts file.
    ssr: {
      noExternal: ['@netlabor/contract', '@netlabor/shared'],
    },
  },
});

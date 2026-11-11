/**
 * Build-time reference extraction. Runs in Bun before `astro dev` / `astro
 * build`; the site itself is static and never fetches these at runtime.
 *
 * Sources, all read-only:
 *   packages/contract/src/router.ts    procedure paths, summaries, authz
 *   packages/contract/src/authz.ts     privileges and built-in roles
 *   packages/contract/src/errors.ts    error codes and HTTP status mapping
 *   apps/controller/src/mcp/tools.ts   MCP tool catalogue
 *   packages/catalog/src/os-images.ts  seeded OS images and desktop recipes
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogOsImages, desktopRecipes } from '@netlabor/catalog';
import {
  APP_ERROR_CODES,
  BUILTIN_ROLES,
  ERROR_STATUS,
  GLOBAL_ROLE_NAMES,
  PRIVILEGES,
  PROJECT_ROLE_NAMES,
  type ProcedureMeta,
  procedurePaths,
  ROLE_NAMES,
  router,
} from '@netlabor/contract';
import { mcpTools } from '../../controller/src/mcp/tools.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'src', 'data');

interface ProcedureDefinition {
  meta?: ProcedureMeta;
}

/** Router nodes are plain records; the key comes from a known procedure path. */
function childOf(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !(key in value)) return null;
  const child: unknown = Reflect.get(value, key);
  return child;
}

function definitionAt(path: string): ProcedureDefinition | null {
  let current: unknown = router;
  for (const segment of path.split('.')) {
    current = childOf(current, segment);
    if (current === null) return null;
  }
  const definition = childOf(current, '~orpc');
  if (typeof definition !== 'object' || definition === null) return null;
  return definition as ProcedureDefinition;
}

const NAMESPACE_LABELS: Record<string, string> = {
  health: 'Health',
  auth: 'Authentication',
  preferences: 'Preferences',
  users: 'Users',
  groups: 'Groups',
  roles: 'Roles',
  grants: 'Project grants',
  audit: 'Audit log',
  computes: 'Computes',
  pools: 'Underlay pools',
  images: 'Image library',
  uploads: 'Uploads',
  templates: 'Templates',
  symbols: 'Symbols',
  projects: 'Projects',
  nodes: 'Nodes',
  links: 'Links',
  drawings: 'Drawings',
  snapshots: 'Snapshots',
  settings: 'Settings',
  secrets: 'Secrets',
  events: 'Events',
  faults: 'Faults',
  packet: 'Packet analysis',
  jobs: 'Jobs',
  appliances: 'Appliance images',
};

const toolByPath = new Map(mcpTools().map((tool) => [tool.procedurePath, tool.name]));

const procedures = procedurePaths()
  .map((path) => {
    const definition = definitionAt(path);
    const meta = definition?.meta;
    const [namespace = path] = path.split('.');
    return {
      path,
      namespace,
      summary: meta?.openapi?.summarize ?? 'Unspecified procedure',
      tags: meta?.openapi?.tags ?? [],
      mode: meta?.authz.mode ?? 'any',
      privilege: meta?.authz.privilege ?? null,
      also: meta?.authz.also ?? [],
      project: meta?.authz.project ?? null,
      sessionOnly: meta?.authz.sessionOnly ?? false,
      mcp: toolByPath.get(path) ?? null,
    };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

const namespaces = [...new Set(procedures.map((procedure) => procedure.namespace))].map(
  (namespace) => ({
    namespace,
    label: NAMESPACE_LABELS[namespace] ?? namespace,
    count: procedures.filter((procedure) => procedure.namespace === namespace).length,
    procedures: procedures.filter((procedure) => procedure.namespace === namespace),
  }),
);

const api = {
  source: 'packages/contract/src/router.ts',
  total: procedures.length,
  namespaces,
};

const authz = {
  source: 'packages/contract/src/authz.ts',
  privileges: PRIVILEGES,
  roles: ROLE_NAMES.map((name) => ({ name, privileges: BUILTIN_ROLES[name] })),
  globalRoles: GLOBAL_ROLE_NAMES,
  projectRoles: PROJECT_ROLE_NAMES,
};

const errors = {
  source: 'packages/contract/src/errors.ts',
  codes: APP_ERROR_CODES.map((code) => ({ code, status: ERROR_STATUS[code] })),
};

const mcp = {
  source: 'apps/controller/src/mcp/tools.ts',
  tools: mcpTools().map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    procedurePath: tool.procedurePath,
    readOnly: tool.readOnly,
    destructive: tool.destructive,
  })),
};

const appliances = {
  source: 'packages/catalog/src/os-images.ts',
  osImages: catalogOsImages,
  desktops: Object.entries(desktopRecipes).map(([desktop, recipe]) => ({
    desktop,
    packages: recipe.packages,
    displayManager: recipe.displayManager,
  })),
};

async function writeJson(name: string, value: unknown) {
  await writeFile(join(dataDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return name;
}

await mkdir(dataDir, { recursive: true });
const written = await Promise.all([
  writeJson('procedures.json', api),
  writeJson('authz.json', authz),
  writeJson('errors.json', errors),
  writeJson('mcp-tools.json', mcp),
  writeJson('appliances.json', appliances),
]);

console.log(
  `docs: ${api.total} procedures in ${namespaces.length} namespaces, ${mcp.tools.length} MCP tools → ${written.join(', ')}`,
);

/* ------------------------------------------------------------- search --- */

interface SearchPage {
  href: string;
  title: string;
  description: string;
  headings: string[];
  body: string;
}

const contentDir = join(here, '..', 'src', 'content', 'docs');

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^(?:import|export)\s.*$/gm, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const pages: SearchPage[] = [];
for (const file of new Bun.Glob('**/*.{md,mdx}').scanSync({ cwd: contentDir })) {
  const raw = await Bun.file(join(contentDir, file)).text();
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/);
  const title = frontmatter?.[1]?.match(/^title:\s*(.+)$/m)?.[1]?.replace(/^"|"$/g, '') ?? file;
  const description =
    frontmatter?.[1]?.match(/^description:\s*(.+)$/m)?.[1]?.replace(/^"|"$/g, '') ?? '';
  const body = raw.replace(/^---\n[\s\S]*?\n---/, '');
  const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1] ?? '');
  const base = file.replace(/\.(md|mdx)$/, '');
  const href = base === 'index' ? '/' : `/${base}`;
  pages.push({
    href,
    title,
    description,
    headings,
    body: stripMarkdown(body).slice(0, 1600),
  });
}

pages.sort((a, b) => a.href.localeCompare(b.href));

// Hand-written pages have no markdown source; index them so search reaches the
// gallery and reference pages too.
const manualPages: SearchPage[] = [
  {
    href: '/components',
    title: 'Components',
    description: 'Live gallery of the app components, rendered from the same code the UI ships.',
    headings: ['Buttons', 'Badges', 'Notices', 'Tables', 'Fields', 'Dialogs', 'Toasts', 'Tabs'],
    body: 'button badge notice table field input select textarea dialog confirm dialog toast copy button empty state page header section sparkline privilege grid symbol glyph key value editor image picker tabs live demo props snippet',
  },
  {
    href: '/theme',
    title: 'Theme',
    description: 'Colour tokens, typography, radii, and control specimens.',
    headings: ['Colour', 'Type', 'Spacing and radius', 'Controls'],
    body: 'theme tokens palette colours copper graphite panel rule ink signal typography instrument sans ibm plex mono radius controls nb-button nb-field nb-rule-label',
  },
  {
    href: '/ui',
    title: 'Workspace UI',
    description:
      'Index of the workspace surfaces embedded on the concept pages: node cards, link edge, palette, port picker, event log, console panel, drawings, snapshots, appliance build, templates, and the privilege grid.',
    headings: ['Surface index', 'Why the demos live on the concept pages'],
    body: 'workspace ui surface index node card status lamp port lamps symbol link edge orthogonal palette templates search favourites port picker connectportmenu search ports event log sse clear inspector stats counters compute slots node row link row template row console drawing annotation snapshot job appliance build dialog privilege grid live demo',
  },
  {
    href: '/api',
    title: 'API reference',
    description: 'Every controller procedure with its privilege, grouped by namespace.',
    headings: ['Namespaces', 'Errors', 'Authentication'],
    body: 'api reference procedures rpc orpc authz privilege project.read project.write node.create link.write image.write templates appliances errors unauthorized forbidden conflict bad request',
  },
];
pages.push(...manualPages);
pages.sort((a, b) => a.href.localeCompare(b.href));

await writeJson('search-index.json', { source: 'src/content/docs', pages });
const publicDir = join(here, '..', 'public');
await mkdir(publicDir, { recursive: true });
await writeFile(join(publicDir, 'search-index.json'), `${JSON.stringify({ pages })}\n`, 'utf8');
console.log(`docs: search index ${pages.length} pages`);

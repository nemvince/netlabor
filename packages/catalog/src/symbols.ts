/**
 * Built-in node symbols. Every icon is a small, monochrome SVG drawn with
 * `currentColor` so the browser UI can theme it. The element and attribute
 * vocabulary stays inside the server-side sanitizer allowlist.
 */

export interface CatalogSymbol {
  id: string;
  name: string;
  svg: string;
  builtin: boolean;
}

function icon(body: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"',
    ' fill="none" stroke="currentColor" stroke-width="3"',
    ' stroke-linecap="round" stroke-linejoin="round">',
    body,
    '</svg>',
  ].join('');
}

export const catalogSymbols: CatalogSymbol[] = [
  {
    id: 'router',
    name: 'router',
    builtin: true,
    svg: icon(
      '<circle cx="32" cy="32" r="20"/><path d="M32 12v8M32 44v8M12 32h8M44 32h8"/>' +
        '<path d="M23 23l5 5M41 23l-5 5M23 41l5-5M41 41l-5-5"/>',
    ),
  },
  {
    id: 'switch',
    name: 'switch',
    builtin: true,
    svg: icon(
      '<rect x="8" y="22" width="48" height="20" rx="3"/>' +
        '<path d="M20 32h24M36 26l8 6-8 6M28 26l-8 6 8 6"/>' +
        '<path d="M18 42v6M32 42v6M46 42v6"/>',
    ),
  },
  {
    id: 'hub',
    name: 'hub',
    builtin: true,
    svg: icon(
      '<rect x="14" y="18" width="36" height="28" rx="4"/>' +
        '<circle cx="24" cy="32" r="3"/><circle cx="32" cy="32" r="3"/><circle cx="40" cy="32" r="3"/>' +
        '<path d="M24 18V10M32 18V10M40 18V10M24 46v8M32 46v8M40 46v8"/>',
    ),
  },
  {
    id: 'cloud',
    name: 'cloud',
    builtin: true,
    svg: icon(
      '<path d="M18 46a10 10 0 0 1-1-20 13 13 0 0 1 25-4 10 10 0 0 1 3 20z"/>' +
        '<path d="M24 46v8M40 46v8"/>',
    ),
  },
  {
    id: 'nat',
    name: 'nat',
    builtin: true,
    svg: icon(
      '<rect x="10" y="12" width="44" height="40" rx="4"/>' + '<path d="M22 42V22l20 20V22"/>',
    ),
  },
  {
    id: 'pc',
    name: 'pc',
    builtin: true,
    svg: icon(
      '<rect x="10" y="12" width="44" height="30" rx="3"/>' +
        '<path d="M32 42v10M22 52h20M18 22h16M18 29h10"/>',
    ),
  },
  {
    id: 'server',
    name: 'server',
    builtin: true,
    svg: icon(
      '<rect x="16" y="8" width="32" height="48" rx="3"/>' +
        '<path d="M16 20h32M16 32h32M16 44h32"/>' +
        '<circle cx="24" cy="14" r="1.5"/><circle cx="24" cy="26" r="1.5"/><circle cx="24" cy="38" r="1.5"/>',
    ),
  },
  {
    id: 'firewall',
    name: 'firewall',
    builtin: true,
    svg: icon(
      '<rect x="8" y="14" width="48" height="36" rx="2"/>' +
        '<path d="M8 26h48M8 38h48M22 14v12M38 14v12M22 26v12M38 26v12M22 38v12M38 38v12"/>',
    ),
  },
  {
    id: 'atm-switch',
    name: 'atm-switch',
    builtin: true,
    svg: icon(
      '<circle cx="32" cy="32" r="20"/>' +
        '<path d="M20 40l24-16M28 22h16v16"/>' +
        '<path d="M16 16l6 6M48 16l-6 6M16 48l6-6M48 48l-6-6"/>',
    ),
  },
  {
    id: 'frame-relay-switch',
    name: 'frame-relay-switch',
    builtin: true,
    svg: icon(
      '<rect x="6" y="18" width="22" height="28" rx="2"/>' +
        '<rect x="36" y="18" width="22" height="28" rx="2"/>' +
        '<path d="M28 32h8M12 26h10M12 32h10M12 38h10M42 26h10M42 32h10M42 38h10"/>',
    ),
  },
  {
    id: 'docker',
    name: 'docker',
    builtin: true,
    svg: icon(
      '<rect x="8" y="26" width="48" height="22" rx="3"/>' +
        '<path d="M16 26v-8h8v8M26 26v-8h8v8M36 26v-8h8v8"/>' +
        '<path d="M8 36h48"/>',
    ),
  },
  {
    id: 'generic',
    name: 'generic',
    builtin: true,
    svg: icon(
      '<rect x="10" y="10" width="44" height="44" rx="5"/>' + '<path d="M10 28h44M28 10v44"/>',
    ),
  },
];

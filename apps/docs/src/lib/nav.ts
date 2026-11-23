/** Single source of truth for the documentation sidebar, crumbs, and pager. */

export interface NavItem {
  href: string;
  label: string;
  /** Short description used on the landing cards and the pager. */
  summary: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const nav: NavGroup[] = [
  {
    label: 'Start',
    items: [
      {
        href: '/',
        label: 'Overview',
        summary: 'What Netlabor is and how the documentation is organised.',
      },
      {
        href: '/getting-started',
        label: 'Getting started',
        summary: 'First project, first node, first console, first link.',
      },
    ],
  },
  {
    label: 'Concepts',
    items: [
      {
        href: '/concepts/projects',
        label: 'Projects',
        summary: 'The unit of isolation: a topology, its dataplane, and its members.',
      },
      {
        href: '/concepts/nodes',
        label: 'Nodes & ports',
        summary: 'Emulators, templates, port derivation, and node files.',
      },
      {
        href: '/concepts/links',
        label: 'Links, filters & capture',
        summary: 'Anchors, relays, link filters, pcap capture, and markers.',
      },
      {
        href: '/concepts/consoles',
        label: 'Consoles',
        summary: 'Telnet, VNC, and HTTP consoles proxied through the controller.',
      },
      {
        href: '/concepts/drawings',
        label: 'Drawings',
        summary: 'Annotations, shapes, text, and symbols on the canvas.',
      },
      {
        href: '/concepts/snapshots',
        label: 'Snapshots & archives',
        summary: 'Project snapshots, export, import, and what travels with them.',
      },
      {
        href: '/concepts/collaboration',
        label: 'Collaboration',
        summary: 'Presence, cursors, selections, locking, and last-write-wins.',
      },
    ],
  },
  {
    label: 'Library',
    items: [
      {
        href: '/appliances',
        label: 'Appliance images',
        summary: 'OS repository, online builds, offline attachments, and templates.',
      },
      {
        href: '/templates',
        label: 'Templates',
        summary: 'Global and project templates, image coverage, faults, base configs.',
      },
    ],
  },
  {
    label: 'Automate',
    items: [
      {
        href: '/apply',
        label: 'Declarative apply',
        summary: 'projects.apply: one manifest for nodes, files, links, and drawings.',
      },
      {
        href: '/mcp',
        label: 'MCP & agents',
        summary: 'The /mcp endpoint, tool catalogue, and API-key scoping.',
      },
      {
        href: '/api',
        label: 'API reference',
        summary: 'Every procedure, its summary, and its authorization metadata.',
      },
    ],
  },
  {
    label: 'Operate',
    items: [
      {
        href: '/administration',
        label: 'Administration',
        summary: 'Users, groups, roles, grants, audit, OIDC, settings, API keys.',
      },
      {
        href: '/deployment',
        label: '4-node cluster install',
        summary: 'Head node, three workers, NFS images, local disks, and the underlay.',
      },
      {
        href: '/operations',
        label: 'Operations',
        summary: 'Environment, computes, NAT, backups, upgrades, troubleshooting.',
      },
      {
        href: '/architecture',
        label: 'Architecture',
        summary: 'Processes, dataplane, storage, replication, and the job model.',
      },
    ],
  },
  {
    label: 'Reference',
    items: [
      {
        href: '/components',
        label: 'Components',
        summary: 'The live component gallery rendered from the app source.',
      },
      {
        href: '/ui',
        label: 'Workspace UI',
        summary: 'Index of the workspace surfaces embedded on the concept pages.',
      },
      {
        href: '/theme',
        label: 'Theme',
        summary: 'Tokens, type scale, radii, and the primitive specimens.',
      },
    ],
  },
];

export const flatNav: NavItem[] = nav.flatMap((group) => group.items);

export function normalisePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function findNavItem(pathname: string): NavItem | undefined {
  const path = normalisePath(pathname);
  return flatNav.find((item) => item.href === path);
}

export function groupOf(item: NavItem): NavGroup | undefined {
  return nav.find((group) => group.items.includes(item));
}

export function neighbours(pathname: string): {
  previous: NavItem | undefined;
  next: NavItem | undefined;
} {
  const index = flatNav.findIndex((item) => item.href === normalisePath(pathname));
  if (index === -1) return { previous: undefined, next: undefined };
  return { previous: flatNav[index - 1], next: flatNav[index + 1] };
}

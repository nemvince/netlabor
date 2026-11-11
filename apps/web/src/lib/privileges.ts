/** Contract privileges grouped by resource prefix for checkbox grids. */

import { PRIVILEGES, type Privilege } from '@netlabor/contract';

export interface PrivilegeGroup {
  prefix: string;
  label: string;
  privileges: Privilege[];
}

const GROUP_LABELS: Record<string, string> = {
  project: 'Project',
  node: 'Node',
  link: 'Link',
  drawing: 'Drawing',
  template: 'Template',
  image: 'Image',
  compute: 'Compute',
  snapshot: 'Snapshot',
  fault: 'Fault',
  settings: 'Settings',
  user: 'Users and groups',
  audit: 'Audit',
  mcp: 'MCP',
};

export const PRIVILEGE_GROUPS: PrivilegeGroup[] = (() => {
  const order: string[] = [];
  const byPrefix = new Map<string, Privilege[]>();
  for (const privilege of PRIVILEGES) {
    const prefix = privilege.split('.')[0] ?? privilege;
    let bucket = byPrefix.get(prefix);
    if (!bucket) {
      bucket = [];
      byPrefix.set(prefix, bucket);
      order.push(prefix);
    }
    bucket.push(privilege);
  }
  return order.map((prefix) => ({
    prefix,
    label: GROUP_LABELS[prefix] ?? prefix,
    privileges: byPrefix.get(prefix) ?? [],
  }));
})();

export const ALL_PRIVILEGES: readonly Privilege[] = PRIVILEGES;

/** Read-only subset, for the API-key "read-only scopes" shortcut. */
export const READ_PRIVILEGES: readonly Privilege[] = PRIVILEGES.filter((privilege) =>
  privilege.endsWith('.read'),
);

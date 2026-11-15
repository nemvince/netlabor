import type { Privilege } from '@netlabor/contract';
import { PrivilegeGrid } from '@web/components/privilege-grid.tsx';
import { useState } from 'react';
import { Button } from '@netlabor/ui/components/button';

export interface RolePrivileges {
  name: string;
  privileges: string[];
}

export interface PrivilegeRolesProps {
  roles: RolePrivileges[];
}

/**
 * The real privilege grid, read-only, switched between the built-in roles.
 * The role buttons are docs chrome; the checkboxes and grouping are the
 * component the role editor and API-key scope screen ship.
 */
export default function PrivilegeRoles({ roles }: PrivilegeRolesProps) {
  const [active, setActive] = useState(roles[0]?.name ?? '');
  const role = roles.find((entry) => entry.name === active) ?? roles[0];

  if (!role) return null;

  const selected = role.privileges as Privilege[];

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="docs-stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="sr-only">Built-in role</legend>
        {roles.map((entry) => (
          <Button
            key={entry.name}
            type="button"
            aria-pressed={entry.name === role.name}
            onClick={() => setActive(entry.name)}
            variant="outline"
            size="xs"
          >
            {entry.name}
          </Button>
        ))}
      </fieldset>
      <p className="docs-ui-status" style={{ maxWidth: 'none' }}>
        <span className="docs-ui-status__value">{role.name}</span> holds {selected.length} of{' '}
        {new Set(roles.flatMap((entry) => entry.privileges)).size} privileges.
      </p>
      <PrivilegeGrid selected={selected} disabled />
    </div>
  );
}

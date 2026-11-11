import type { Privilege } from '@netlabor/contract';
import { PRIVILEGE_GROUPS } from '../lib/privileges.ts';

/**
 * Privilege checkbox grid grouped by resource prefix. Used read-only for
 * built-in roles and editable for custom roles and API-key scopes.
 */
export function PrivilegeGrid({
  selected,
  onToggle,
  disabled = false,
  available,
}: {
  selected: readonly Privilege[];
  onToggle?: (privilege: Privilege) => void;
  disabled?: boolean;
  available?: readonly Privilege[];
}) {
  const availableSet = available ? new Set<Privilege>(available) : null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {PRIVILEGE_GROUPS.map((group) => {
        const privileges = availableSet
          ? group.privileges.filter((privilege) => availableSet.has(privilege))
          : group.privileges;
        if (privileges.length === 0) return null;
        return (
          <fieldset
            key={group.prefix}
            className="rounded-[3px] border px-2.5 py-1.5"
            style={{ borderColor: 'var(--color-rule)' }}
          >
            <legend className="nb-rule-label px-1">{group.label}</legend>
            <div className="mt-1 flex flex-col gap-0.5">
              {privileges.map((privilege) => (
                <label
                  key={privilege}
                  className="flex cursor-pointer items-center gap-2 text-[12px]"
                >
                  <input
                    type="checkbox"
                    className="size-3.5"
                    style={{ accentColor: 'var(--color-copper)' }}
                    checked={selected.includes(privilege)}
                    disabled={disabled || !onToggle}
                    onChange={onToggle ? () => onToggle(privilege) : undefined}
                  />
                  <span className="tabular" style={{ color: 'var(--color-ink-dim)' }}>
                    {privilege}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

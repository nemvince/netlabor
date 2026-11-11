import { Link, useRouterState } from '@tanstack/react-router';
import {
  Globe,
  KeyRound,
  type LucideIcon,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Users,
} from 'lucide-react';
import { useMe } from '../auth/use-me.ts';

type SettingsPath =
  | '/profile'
  | '/admin/api-keys'
  | '/admin/users'
  | '/admin/roles'
  | '/admin/oidc'
  | '/admin/audit'
  | '/admin/settings';

interface SettingsEntry {
  to: SettingsPath;
  label: string;
  purpose: string;
  icon: LucideIcon;
  /** Any one of these privileges reveals the entry, matching the rail. */
  requires?: string[];
}

/** The settings taxonomy: You · Access · Controller. */
const GROUPS: { label: string; entries: SettingsEntry[] }[] = [
  {
    label: 'You',
    entries: [
      {
        to: '/profile',
        label: 'Profile & preferences',
        purpose: 'Your account, password, sessions, and defaults',
        icon: UserRound,
      },
      {
        to: '/admin/api-keys',
        label: 'API keys',
        purpose: 'Bearer keys for scripts and MCP clients',
        icon: KeyRound,
      },
    ],
  },
  {
    label: 'Access',
    entries: [
      {
        to: '/admin/users',
        label: 'Users',
        purpose: 'Local accounts, their roles, and group grants',
        icon: Users,
        requires: ['user.read', 'user.write'],
      },
      {
        to: '/admin/roles',
        label: 'Roles',
        purpose: 'Built-in and custom privilege bundles',
        icon: ShieldCheck,
        requires: ['user.read', 'user.write'],
      },
      {
        to: '/admin/oidc',
        label: 'Single sign-on',
        purpose: 'Let people sign in with your identity provider',
        icon: Globe,
        requires: ['settings.write'],
      },
    ],
  },
  {
    label: 'Controller',
    entries: [
      {
        to: '/admin/audit',
        label: 'Audit',
        purpose: 'Every mutation, with actor, resource, and IP',
        icon: ScrollText,
        requires: ['audit.read'],
      },
      {
        to: '/admin/settings',
        label: 'Controller',
        purpose: 'Console defaults, project lifecycle, and secrets',
        icon: SlidersHorizontal,
        requires: ['settings.read', 'settings.write'],
      },
    ],
  },
];

/**
 * Section navigator shared by every settings-shaped route. It answers "where
 * am I" and "what else is here" without repeating the rail, and it wraps
 * instead of scrolling sideways on narrow viewports.
 */
export function SettingsNav() {
  const { me, can } = useMe();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (!me) return null;

  const groups = GROUPS.map((group) => ({
    label: group.label,
    entries: group.entries.filter((entry) => entry.requires?.some(can) ?? true),
  })).filter((group) => group.entries.length > 0);
  if (groups.length === 0) return null;

  return (
    <nav aria-label="Settings sections" className="mt-3">
      <div className="flex flex-wrap gap-x-6 gap-y-2.5">
        {groups.map((group) => (
          <div key={group.label} className="min-w-0">
            <span className="nb-rule-label">{group.label}</span>
            <ul className="mt-1 flex flex-wrap gap-1">
              {group.entries.map((entry) => {
                const active = pathname === entry.to || pathname.startsWith(`${entry.to}/`);
                return (
                  <li key={entry.to} className="min-w-0 max-w-full">
                    <Link
                      to={entry.to}
                      aria-current={active ? 'page' : undefined}
                      className="flex max-w-[250px] min-w-0 items-start gap-2 rounded-[2px] border px-2 py-1.5 transition-colors hover:bg-[var(--color-panel-raised)]"
                      style={
                        active
                          ? {
                              borderColor:
                                'color-mix(in oklab, var(--color-copper) 50%, transparent)',
                              background: 'color-mix(in oklab, var(--color-copper) 9%, transparent)',
                              color: 'var(--color-ink)',
                            }
                          : {
                              borderColor: 'transparent',
                              color: 'var(--color-ink-dim)',
                            }
                      }
                    >
                      <entry.icon
                        size={13}
                        strokeWidth={1.75}
                        aria-hidden
                        className="mt-0.5 shrink-0"
                        style={{
                          color: active ? 'var(--color-copper)' : 'var(--color-ink-faint)',
                        }}
                      />
                      <span className="min-w-0">
                        <span className="block text-[12px] leading-[1.4] font-medium">
                          {entry.label}
                        </span>
                        <span
                          className="block text-[11px] leading-[1.4]"
                          style={{ color: 'var(--color-ink-faint)' }}
                        >
                          {entry.purpose}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

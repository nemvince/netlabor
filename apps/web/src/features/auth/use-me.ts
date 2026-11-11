import type { MeOutput } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { orpc } from '../../lib/api.ts';

export interface MeState {
  me: MeOutput | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  can: (privilege: string) => boolean;
}

/**
 * The signed-in principal. `auth.me` is the single source for roles and
 * effective privileges; `can` treats the admin role as holding everything.
 */
export function useMe(): MeState {
  const query = useQuery({ ...orpc.auth.me.queryOptions({ input: {} }), retry: false });
  const me = query.data ?? null;

  const can = useCallback(
    (privilege: string) => {
      if (!me) return false;
      if (me.roles.includes('admin')) return true;
      return (me.privileges as string[]).includes(privilege);
    },
    [me],
  );

  return {
    me,
    isLoading: query.isPending,
    isAuthenticated: me !== null,
    can,
  };
}

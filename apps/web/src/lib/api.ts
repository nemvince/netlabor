import type { AppRouter } from '@netlabor/contract';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';

const link = new RPCLink({
  url: `${window.location.origin}/rpc`,
  headers: () => ({}),
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, credentials: 'include' }),
});

/** Typed controller client; every call is a procedure in the shared contract. */
export const client: ContractRouterClient<AppRouter> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);

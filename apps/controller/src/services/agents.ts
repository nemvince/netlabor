/** Controller → agent RPC clients: cached per compute, token-authenticated. */

import type { AgentRouter } from '@netlabor/contract';
import { APP_ERROR_CODES, AppError, type AppErrorCode } from '@netlabor/contract';
import { decryptSecret, type Logger } from '@netlabor/shared';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { SQL } from 'bun';
import type { ControllerConfig } from '../config.ts';

export type AgentClient = ContractRouterClient<AgentRouter>;

interface CachedAgent {
  url: string;
  token: string;
  client: AgentClient;
}

const REQUEST_TIMEOUT_MS = 30_000;
/** Calls that only answer after a multi-gigabyte image transfer finishes. */
const LONG_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;

/** Agent AppErrors arrive as oRPC errors carrying `data.appCode`. */
function agentAppError(error: unknown): AppError | null {
  if (typeof error !== 'object' || error === null || !('data' in error)) return null;
  const data = error.data;
  if (typeof data !== 'object' || data === null || !('appCode' in data)) return null;
  const appCode = data.appCode;
  if (typeof appCode !== 'string' || !(APP_ERROR_CODES as readonly string[]).includes(appCode))
    return null;
  const message =
    'message' in error && typeof error.message === 'string' ? error.message : 'agent error';
  const details = 'details' in data ? data.details : undefined;
  const retryable = 'retryable' in data && data.retryable === true;
  return new AppError(appCode as AppErrorCode, message, { details, retryable });
}

export class AgentRegistry {
  private readonly cache = new Map<string, CachedAgent>();

  constructor(
    private readonly db: SQL,
    private readonly config: ControllerConfig,
    private readonly logger: Logger,
  ) {}

  /** Load a compute's URL and decrypted token, then build a client. */
  async client(computeId: string): Promise<AgentClient> {
    return (await this.cachedClient(computeId, REQUEST_TIMEOUT_MS)).client;
  }

  private async cachedClient(computeId: string, timeoutMs: number): Promise<CachedAgent> {
    const key = `${computeId}:${timeoutMs}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const rows = await this.db.unsafe<{ url: string }[]>('SELECT url FROM computes WHERE id = $1', [
      computeId,
    ]);
    const compute = rows[0];
    if (!compute) throw new AppError('NOT_FOUND', `compute ${computeId} not found`);
    const token = await this.token(computeId);
    if (!token) throw new AppError('AGENT_UNAVAILABLE', `compute ${computeId} has no agent token`);

    const client = this.buildClient(compute.url, token, timeoutMs);
    const entry = { url: compute.url, token, client };
    this.cache.set(key, entry);
    return entry;
  }

  /** Decrypted agent token for a compute; used to build blob fetch sources. */
  async agentToken(computeId: string): Promise<string | null> {
    return this.token(computeId);
  }

  private async token(computeId: string): Promise<string | null> {
    const rows = await this.db.unsafe<{ ciphertext: Uint8Array; nonce: Uint8Array }[]>(
      'SELECT ciphertext, nonce FROM secrets WHERE name = $1',
      [`compute-token:${computeId}`],
    );
    const row = rows[0];
    if (!row) return null;
    try {
      return decryptSecret(
        { ciphertext: new Uint8Array(row.ciphertext), nonce: new Uint8Array(row.nonce) },
        this.config.secretKey,
      );
    } catch (err) {
      this.logger.error('failed to decrypt agent token', { computeId, err });
      return null;
    }
  }

  private buildClient(baseUrl: string, token: string, timeoutMs: number): AgentClient {
    const link = new RPCLink({
      url: `${baseUrl.replace(/\/$/, '')}/agent/rpc`,
      headers: { authorization: `Bearer ${token}` },
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const signal = init?.signal
          ? AbortSignal.any([init.signal, controller.signal])
          : controller.signal;
        try {
          return await fetch(input, { ...init, signal });
        } finally {
          clearTimeout(timer);
        }
      },
    });
    return createORPCClient<AgentClient>(link);
  }

  invalidate(computeId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${computeId}:`)) this.cache.delete(key);
    }
  }

  /** Wrap a call so transport failures surface as AGENT_UNAVAILABLE. */
  async call<T>(computeId: string, fn: (client: AgentClient) => Promise<T>): Promise<T> {
    return this.callWithTimeout(computeId, fn, REQUEST_TIMEOUT_MS);
  }

  /** Image replication blocks until the bytes are on disk; allow that to take a while. */
  async callLong<T>(computeId: string, fn: (client: AgentClient) => Promise<T>): Promise<T> {
    return this.callWithTimeout(computeId, fn, LONG_REQUEST_TIMEOUT_MS);
  }

  private async callWithTimeout<T>(
    computeId: string,
    fn: (client: AgentClient) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let client: AgentClient;
    try {
      client = (await this.cachedClient(computeId, timeoutMs)).client;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('AGENT_UNAVAILABLE', `compute ${computeId} is unreachable`, {
        retryable: true,
      });
    }
    try {
      return await fn(client);
    } catch (err) {
      if (err instanceof AppError) throw err;
      const agentError = agentAppError(err);
      if (agentError) throw agentError;
      this.logger.warn('agent call failed', { computeId, err });
      throw new AppError('AGENT_UNAVAILABLE', `compute ${computeId} is unreachable`, {
        retryable: true,
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

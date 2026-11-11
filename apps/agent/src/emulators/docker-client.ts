/** Docker Engine API client over the local socket (unix or podman path). */

import { AppError } from '@netlabor/contract';

export interface DockerContainer {
  Id: string;
  State: { Status: string; Running: boolean; Pid: number };
  Config: { Image: string };
}

export interface DockerImage {
  Id: string;
  RepoTags: string[] | null;
  Size: number;
  Created: number;
}

export class DockerClient {
  constructor(
    private readonly socketPath: string,
    private readonly apiVersion = 'v1.43',
  ) {}

  private async request(
    method: string,
    endpoint: string,
    options: { body?: unknown; query?: Record<string, string>; hijack?: boolean } = {},
  ): Promise<Response> {
    const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : '';
    const url = `http://localhost/${this.apiVersion}${endpoint}${query}`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.hijack) {
      headers.connection = 'upgrade';
      headers.upgrade = 'tcp';
    }
    try {
      return await fetch(url, {
        method,
        unix: this.socketPath,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new AppError('AGENT_UNAVAILABLE', 'Docker daemon is not reachable', {
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async version(): Promise<string> {
    const response = await this.request('GET', '/version');
    if (!response.ok) throw new AppError('AGENT_UNAVAILABLE', 'Docker daemon unreachable');
    const body = (await response.json()) as { Version?: string };
    return body.Version ?? 'unknown';
  }

  async listImages(): Promise<DockerImage[]> {
    const response = await this.request('GET', '/images/json');
    if (!response.ok) throw new AppError('AGENT_ERROR', 'failed to list Docker images');
    return (await response.json()) as DockerImage[];
  }

  async pullImage(image: string, onProgress?: (message: string) => void): Promise<void> {
    const [name, tag] = image.includes(':') ? image.split(':') : [image, 'latest'];
    const response = await fetch(
      `http://localhost/${this.apiVersion}/images/create?fromImage=${encodeURIComponent(name ?? image)}&tag=${encodeURIComponent(tag ?? 'latest')}`,
      { method: 'POST', unix: this.socketPath, headers: { 'content-type': 'application/json' } },
    );
    if (!response.ok || !response.body) {
      throw new AppError('AGENT_ERROR', `failed to pull Docker image ${image}`, {
        details: await response.text().catch(() => ''),
      });
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line) continue;
        try {
          const event = JSON.parse(line) as { status?: string; error?: string };
          if (event.error) throw new AppError('AGENT_ERROR', `pull failed: ${event.error}`);
          if (event.status && onProgress) onProgress(event.status);
        } catch {
          // ignore non-JSON progress lines
        }
      }
    }
  }

  async createContainer(input: {
    image: string;
    name: string;
    labels: Record<string, string>;
    command?: string | null;
    env?: string[] | null;
    extraHosts?: string[] | null;
    binds?: string[] | null;
    privileged?: boolean;
  }): Promise<string> {
    // NetworkMode belongs in HostConfig; a top-level key is ignored by the
    // daemon and would leave the container on Docker's default bridge network.
    // Routing images such as FRR need the same privileged mode GNS3 gives
    // Docker nodes, otherwise their daemons cannot retain CAP_SYS_ADMIN.
    const hostConfig: Record<string, unknown> = {
      NetworkMode: 'none',
      CapAdd: ['NET_ADMIN'],
      Privileged: input.privileged !== false,
    };
    if (input.extraHosts) hostConfig.ExtraHosts = input.extraHosts;
    if (input.binds) hostConfig.Binds = input.binds;
    const body: Record<string, unknown> = {
      Image: input.image,
      Tty: true,
      OpenStdin: true,
      Labels: input.labels,
      ...(input.command ? { Cmd: ['/bin/sh', '-lc', input.command] } : {}),
      ...(input.env ? { Env: input.env } : {}),
      HostConfig: hostConfig,
    };
    const response = await this.request('POST', '/containers/create', {
      body,
      query: { name: input.name },
    });
    if (!response.ok) {
      throw new AppError('AGENT_ERROR', `failed to create container ${input.name}`, {
        details: await response.text().catch(() => ''),
      });
    }
    const created = (await response.json()) as { Id: string };
    return created.Id;
  }

  async startContainer(id: string): Promise<void> {
    const response = await this.request('POST', `/containers/${id}/start`);
    if (!response.ok && response.status !== 304) {
      throw new AppError('AGENT_ERROR', 'failed to start container', {
        details: await response.text().catch(() => ''),
      });
    }
  }

  async inspectContainer(id: string): Promise<DockerContainer> {
    const response = await this.request('GET', `/containers/${id}/json`);
    if (!response.ok) throw new AppError('NOT_FOUND', 'container not found');
    return (await response.json()) as DockerContainer;
  }

  async stopContainer(id: string, timeoutSeconds = 5): Promise<void> {
    await this.request('POST', `/containers/${id}/stop`, {
      query: { t: String(timeoutSeconds) },
    }).catch(() => undefined);
  }

  async removeContainerByName(name: string, force = true): Promise<void> {
    await this.request('DELETE', `/containers/${encodeURIComponent(name)}`, {
      query: { force: String(force) },
    }).catch(() => undefined);
  }

  async removeContainer(id: string, force = true): Promise<void> {
    await this.request('DELETE', `/containers/${id}`, { query: { force: String(force) } }).catch(
      () => undefined,
    );
  }

  /**
   * Start an attached TTY exec and return the raw upgraded socket. node:http
   * is used because a hijacked connection is a duplex byte stream, which
   * fetch() cannot expose.
   */
  async execDuplex(
    containerId: string,
    command: string[],
    handlers: { onData: (data: Uint8Array) => void; onClose: () => void },
    options: { user?: string | null } = {},
  ): Promise<{ write(data: Uint8Array): void; close(): void }> {
    const create = await this.request('POST', `/containers/${containerId}/exec`, {
      body: {
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Cmd: command,
        ...(options.user ? { User: options.user } : {}),
      },
    });
    if (!create.ok) {
      throw new AppError('AGENT_ERROR', 'failed to create exec session', {
        details: await create.text().catch(() => ''),
      });
    }
    const { Id } = (await create.json()) as { Id: string };

    const { default: http } = await import('node:http');
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.socketPath,
          path: `/${this.apiVersion}/exec/${Id}/start`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Connection: 'Upgrade',
            Upgrade: 'tcp',
          },
        },
        (response) => {
          reject(
            new AppError('AGENT_ERROR', 'docker exec did not upgrade', {
              details: `status ${response.statusCode ?? 0}`,
            }),
          );
        },
      );
      request.on('upgrade', (_response, socket: import('node:net').Socket) => {
        socket.on('data', (chunk: Buffer) => handlers.onData(new Uint8Array(chunk)));
        socket.on('close', () => handlers.onClose());
        socket.on('error', () => handlers.onClose());
        resolve({
          write(data: Uint8Array) {
            socket.write(data);
          },
          close() {
            socket.end();
          },
        });
      });
      request.on('error', (error) => reject(error));
      request.end(JSON.stringify({ Detach: false, Tty: true }));
    });
  }

  /** Create and start an attached TTY exec; the response is the duplex stream. */
  async execAttached(
    containerId: string,
    command: string[],
    options: { user?: string | null } = {},
  ): Promise<Response> {
    const create = await this.request('POST', `/containers/${containerId}/exec`, {
      body: {
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Cmd: command,
        ...(options.user ? { User: options.user } : {}),
      },
    });
    if (!create.ok) {
      throw new AppError('AGENT_ERROR', 'failed to create exec session', {
        details: await create.text().catch(() => ''),
      });
    }
    const { Id } = (await create.json()) as { Id: string };
    const start = await this.request('POST', `/exec/${Id}/start`, {
      body: { Detach: false, Tty: true },
      hijack: true,
    });
    if (!start.ok && start.status !== 101) {
      throw new AppError('AGENT_ERROR', 'failed to start exec session', {
        details: await start.text().catch(() => ''),
      });
    }
    return start;
  }
}

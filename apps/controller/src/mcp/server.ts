/**
 * Minimal Streamable HTTP MCP endpoint. Tools are derived from the oRPC
 * contract, filtered per API key, and invoked through the same router so the
 * regular authorization middleware applies.
 */

import { createProcedureClient, ORPCError } from '@orpc/server';
import { z } from 'zod';
import { hasPrivilege } from '../auth/principal.ts';
import type { Context } from '../context.ts';
import { procedurePrivilege } from './privileges.ts';
import { MCP_TOOL_PROCEDURES, type McpTool, mcpTools } from './tools.ts';

const JSONRPC_VERSION = '2.0';
const PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function jsonRpcResult(id: string | number | null | undefined, result: unknown): Response {
  return Response.json({ jsonrpc: JSONRPC_VERSION, id: id ?? null, result });
}

function jsonRpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown,
): Response {
  return Response.json({
    jsonrpc: JSONRPC_VERSION,
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
}

/** Tools visible to this principal: mcp.use plus the underlying privilege. */
function visibleTools(context: Context): McpTool[] {
  if (!context.auth.user) return [];
  if (!hasPrivilege(context.auth, 'mcp.use', null)) return [];
  return mcpTools().filter((tool) => {
    const privilege = procedurePrivilege(tool.procedurePath);
    if (!privilege) return false;
    return hasPrivilege(context.auth, privilege, null);
  });
}

function toolJsonSchema(tool: McpTool): Record<string, unknown> {
  if (!tool.inputSchema) return { type: 'object', properties: {} };
  try {
    const schema = z.toJSONSchema(tool.inputSchema as z.ZodType, {
      io: 'input',
      unrepresentable: 'any',
      target: 'draft-7',
    }) as Record<string, unknown>;
    delete schema.$schema;
    return schema;
  } catch {
    return { type: 'object', properties: {} };
  }
}

function jsonSchemaOf(schema: unknown): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  try {
    const converted = z.toJSONSchema(schema as z.ZodType, {
      io: 'output',
      unrepresentable: 'any',
      target: 'draft-7',
    }) as Record<string, unknown>;
    delete converted.$schema;
    return converted;
  } catch {
    return undefined;
  }
}

function descriptor(tool: McpTool): Record<string, unknown> {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description || tool.title,
    inputSchema: toolJsonSchema(tool),
    ...(jsonSchemaOf(tool.outputSchema) ? { outputSchema: jsonSchemaOf(tool.outputSchema) } : {}),
    annotations: {
      readOnlyHint: tool.readOnly,
      destructiveHint: tool.destructive,
      openWorldHint: false,
    },
  };
}

/**
 * Resolve `a.b.c` on the implemented router and build a procedure client that
 * runs the same middlewares as HTTP calls.
 */
function procedureClient(
  router: unknown,
  path: string,
  context: Context,
): (input: unknown) => Promise<unknown> {
  const segments = path.split('.');
  let current: unknown = router;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') throw new Error(`unknown procedure ${path}`);
    current = (current as Record<string, unknown>)[segment];
  }
  const procedure = current as { '~orpc'?: { handler?: unknown } };
  if (!procedure || typeof procedure !== 'object' || !procedure['~orpc']?.handler) {
    throw new Error(`procedure ${path} is not implemented`);
  }
  const call = createProcedureClient(procedure as never, { context: context as never });
  return (input: unknown) => call(input as never) as Promise<unknown>;
}

export interface McpRequestOptions {
  context: Context;
  router: unknown;
}

export async function handleMcpRequest(
  request: Request,
  options: McpRequestOptions,
): Promise<Response> {
  if (request.method !== 'POST') {
    // Stateless server: no server-initiated stream is offered.
    return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } });
  }
  const { auth } = options.context;
  if (auth.type !== 'apikey' || !auth.user) {
    return new Response(JSON.stringify({ error: 'MCP requires an API key' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!hasPrivilege(auth, 'mcp.use', null)) {
    return new Response(JSON.stringify({ error: 'this API key lacks mcp.use' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  let payload: JsonRpcRequest;
  try {
    payload = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, 'parse error');
  }
  if (payload.jsonrpc !== JSONRPC_VERSION || typeof payload.method !== 'string') {
    return jsonRpcError(payload.id, -32600, 'invalid request');
  }

  switch (payload.method) {
    case 'initialize': {
      const requested =
        typeof payload.params?.protocolVersion === 'string' ? payload.params.protocolVersion : null;
      const supported = ['2025-06-18', '2025-03-26', '2024-11-05'];
      const protocolVersion =
        requested && supported.includes(requested) ? requested : PROTOCOL_VERSION;
      return jsonRpcResult(payload.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'netlabor', version: '1' },
        instructions:
          'Netlabor control-plane tools. Project-scoped tools require a project id and the API key must hold the matching privileges. console_exec accepts commands, a prompt regex, a timeout, and terminalLengthZero for IOS-style consoles; console_reset clears a stuck console proxy. project_apply applies a declarative manifest of nodes (by template name), files, links (by node name with automatic ports), and keyed drawings; prune defaults to false.',
      });
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return new Response(null, { status: 202 });

    case 'ping':
      return jsonRpcResult(payload.id, {});

    case 'tools/list': {
      const tools = visibleTools(options.context);
      return jsonRpcResult(payload.id, { tools: tools.map(descriptor) });
    }

    case 'tools/call': {
      const params = payload.params ?? {};
      const name = typeof params.name === 'string' ? params.name : null;
      if (!name) return jsonRpcError(payload.id, -32602, 'tools/call requires a name');
      const tool = visibleTools(options.context).find((entry) => entry.name === name);
      if (!tool) return jsonRpcError(payload.id, -32601, `unknown tool ${name}`);
      const procedurePath = MCP_TOOL_PROCEDURES[tool.name];
      if (!procedurePath) return jsonRpcError(payload.id, -32601, `unmapped tool ${name}`);

      try {
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        const result = await procedureClient(options.router, procedurePath, options.context)(args);
        return jsonRpcResult(payload.id, {
          content: [{ type: 'text', text: JSON.stringify(result ?? null) }],
          structuredContent: result ?? null,
          isError: false,
        });
      } catch (error) {
        if (error instanceof ORPCError) {
          return jsonRpcResult(payload.id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  code: error.code,
                  message: error.message,
                  data: error.data ?? null,
                }),
              },
            ],
            isError: true,
          });
        }
        return jsonRpcResult(payload.id, {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        });
      }
    }

    default:
      return jsonRpcError(payload.id, -32601, `method not found: ${payload.method}`);
  }
}

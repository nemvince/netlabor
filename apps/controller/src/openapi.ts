/** OpenAPI document generation and a Scalar reference page. */

import { router as contract } from '@netlabor/contract';
import type { JSONSchema } from '@orpc/openapi';
import { type ConditionalSchemaConverter, OpenAPIGenerator } from '@orpc/openapi';
import { z } from 'zod';

function isZodSchema(value: unknown): value is z.ZodType {
  return typeof value === 'object' && value !== null && 'safeParse' in value && '_zod' in value;
}

/**
 * Zod 4 → JSON Schema converter. `required` is inferred from whether the schema
 * accepts `undefined` (optional/default/catch all accept it).
 */
const zodConverter: ConditionalSchemaConverter = {
  condition: (schema) => isZodSchema(schema),
  convert: (schema, options): [boolean, JSONSchema] => {
    const zodSchema = schema as z.ZodType;
    const io = options.strategy === 'input' ? 'input' : 'output';
    const jsonSchema = z.toJSONSchema(zodSchema, {
      io,
      target: 'draft-2020-12',
      unrepresentable: 'any',
      override: (ctx) => {
        if (ctx.zodSchema._zod.def.type === 'date') {
          ctx.jsonSchema.type = 'string';
          ctx.jsonSchema.format = 'date-time';
        }
      },
    }) as JSONSchema;
    const required = !zodSchema.safeParse(undefined).success;
    return [required, jsonSchema];
  },
};

let cached: Record<string, unknown> | null = null;

export async function openApiDocument(version: string): Promise<Record<string, unknown>> {
  if (cached) return cached;
  const generator = new OpenAPIGenerator({
    schemaConverters: [zodConverter],
  });
  const document = await generator.generate(contract, {
    info: {
      title: 'Netlabor controller API',
      version,
      description:
        'Typed oRPC procedures for projects, nodes, links, captures, images, templates, identity, and MCP.',
      license: { name: 'AGPL-3.0-or-later' },
    },
    servers: [{ url: '/rpc', description: 'oRPC endpoint' }],
  });
  cached = document as Record<string, unknown>;
  return cached;
}

export function docsHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Netlabor API</title>
  </head>
  <body>
    <script id="api-reference" data-url="/api/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
}

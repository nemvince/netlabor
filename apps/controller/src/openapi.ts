/** OpenAPI document generation options and a Scalar reference page. */

import type {
  ConditionalSchemaConverter,
  JSONSchema,
  OpenAPIGeneratorGenerateOptions,
} from '@orpc/openapi';
import { z } from 'zod';

function isZodSchema(value: unknown): value is z.ZodType {
  return typeof value === 'object' && value !== null && 'safeParse' in value && '_zod' in value;
}

/**
 * Zod 4 → JSON Schema converter. `required` is inferred from whether the schema
 * accepts `undefined` (optional/default/catch all accept it).
 */
export const zodConverter: ConditionalSchemaConverter = {
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

/** Spec metadata for the OpenAPI reference served at `/api`. */
export function apiSpecInfo(version: string): OpenAPIGeneratorGenerateOptions {
  return {
    info: {
      title: 'Netlabor controller API',
      version,
      description:
        'Typed oRPC procedures for projects, nodes, links, captures, images, templates, identity, and MCP.',
      license: { name: 'AGPL-3.0-or-later' },
    },
  };
}

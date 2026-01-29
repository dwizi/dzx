import type { z } from "zod";
import type { ZodSchema } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";

type SchemaAdapter<T> = {
  parse: (data: unknown) => T;
  toJSONSchema: () => unknown;
};

/**
 * Wrap a Zod schema with parse and JSON Schema helpers.
 */
export function defineSchema<T extends z.ZodTypeAny>(schema: T): SchemaAdapter<z.infer<T>> {
  return {
    parse: (data: unknown) => schema.parse(data),
    toJSONSchema: () => zodToJsonSchema(schema as unknown as ZodSchema),
  };
}

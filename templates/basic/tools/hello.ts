import { defineSchema } from "@dwizi/dzx/schema";
import { z } from "zod";

/**
 * Returns a friendly greeting.
 * @param {object} input
 * @param {string} input.name
 * @returns {{ greeting: string }}
 */
export default async function hello(input: { name: string }) {
  return { greeting: `Hello, ${input.name}!` };
}

export const schema = {
  input: defineSchema(z.object({ name: z.string() })),
  output: defineSchema(z.object({ greeting: z.string() })),
};

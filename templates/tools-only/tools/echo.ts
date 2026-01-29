import { defineSchema } from "@dwizi/dzx/schema";
import { z } from "zod";

/**
 * Returns the input as output.
 * @param {object} input
 * @param {string} input.text
 * @returns {{ text: string }}
 */
export default async function echo(input: { text: string }) {
  return { text: input.text };
}

export const schema = {
  input: defineSchema(z.object({ text: z.string() })),
  output: defineSchema(z.object({ text: z.string() })),
};

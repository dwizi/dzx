import { defineSchema } from "@dwizi/dzx/schema";
import { z } from "zod";

/**
 * Converts text to uppercase.
 * @param {object} input
 * @param {string} input.text
 * @returns {{ upper: string }}
 */
export default async function convertText(input: { text: string }) {
  return { upper: input.text.toUpperCase() };
}

export const schema = {
  input: defineSchema(z.object({ text: z.string() })),
  output: defineSchema(z.object({ upper: z.string() })),
};

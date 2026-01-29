/**
 * Tool that returns undefined despite having an output schema.
 */
export default async function badOutput() {
  return undefined;
}

export const badOutputSchema = {
  output: {
    toJSONSchema: () => ({
      type: "object",
      properties: {
        ok: { type: "boolean" },
      },
      required: ["ok"],
      additionalProperties: false,
    }),
  },
};

/**
 * A smart hello tool that uses context and zod-like validation.
 */
export default async function smartHello(args, context) {
  // context is injected as the second argument
  return {
    message: `Hello ${args.name}`,
    currentUser: context.user,
    authorized: context.role === "admin",
  };
}

// Mocking a Zod schema object to test library-agnostic support
export const smartHelloSchema = {
  // Runtime validation (Duck Typing: looks for .parse)
  input: {
    parse: (data) => {
      if (!data || typeof data.name !== "string") {
        throw new Error("Validation Error: 'name' must be a string");
      }
      return data;
    },
    // Discovery (JSON Schema exposure)
    toJSONSchema: () => ({
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    }),
  },
  output: {
    parse: (data) => data, // Pass-through
    toJSONSchema: () => ({
      type: "object",
      properties: {
        message: { type: "string" },
        currentUser: { type: "string" },
        authorized: { type: "boolean" },
      },
    }),
  },
};

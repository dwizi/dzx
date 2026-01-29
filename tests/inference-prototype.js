function parseTypeString(typeStr) {
  typeStr = typeStr.trim();
  if (typeStr.startsWith("{ ") && typeStr.endsWith("}")) {
    // Object type: { a: string, b: number }
    const content = typeStr.slice(1, -1);
    const props = {};
    const required = [];

    // Split by comma, but careful about nested commas (not handling nested yet for simplicity)
    const parts = content.split(",");

    for (const part of parts) {
      const [key, typeRaw] = part.split(":").map((s) => s.trim());
      if (key && typeRaw) {
        props[key] = { type: typeRaw.toLowerCase() };
        required.push(key); // Assume all fields in { ... } are required by default
      }
    }

    return {
      type: "object",
      properties: props,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    };
  }

  // Simple type
  return { type: typeStr.toLowerCase() };
}

function inferSchemas(docBlock) {
  const lines = docBlock.split("\n").map((l) => l.replace(/^\s*\*\s?/, "").trim());
  const inputProperties = {};
  const inputRequired = [];
  let outputSchema;

  for (const line of lines) {
    if (line.startsWith("@param")) {
      const parts = line.split(/\s+/);
      let typeRaw = parts[1];
      let nameRaw = parts[2];

      if (!typeRaw || !nameRaw) continue;

      if (typeRaw.startsWith("{ ") && typeRaw.endsWith("}")) {
        typeRaw = typeRaw.slice(1, -1).toLowerCase();
      }

      const isOptional = nameRaw.startsWith("[") && nameRaw.endsWith("]");
      if (isOptional) nameRaw = nameRaw.slice(1, -1);

      const nameParts = nameRaw.split(".");
      if (nameParts[0] === "input" && nameParts.length === 2) {
        const propName = nameParts[1];
        inputProperties[propName] = { type: typeRaw };
        if (!isOptional) inputRequired.push(propName);
      }
    } else if (line.startsWith("@returns") || line.startsWith("@return")) {
      // Extract type inside {}
      // Regex to find first { and matching } is hard without recursion.
      // But JSDoc usually puts type in first {} pair.
      // @returns {{ ok: boolean }}

      const start = line.indexOf("{");
      const end = line.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        const typeBody = line.slice(start + 1, end);
        outputSchema = parseTypeString(typeBody);
      }
    }
  }

  const inputSchema =
    Object.keys(inputProperties).length > 0
      ? {
          type: "object",
          properties: inputProperties,
          required: inputRequired.length > 0 ? inputRequired : undefined,
          additionalProperties: false,
        }
      : undefined;

  return { inputSchema, outputSchema };
}

const healthExample =
  "\n * Checks the dwizi gateway health endpoint.\n * @param {object} input\n * @param {string} [input.baseUrl]\n * @returns {{ ok: boolean, status: number, body: string }}";

const result = inferSchemas(healthExample);
console.log("Input:", JSON.stringify(result.inputSchema, null, 2));
console.log("Output:", JSON.stringify(result.outputSchema, null, 2));

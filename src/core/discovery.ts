import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseFrontmatter } from "./frontmatter.js";
import { listFiles } from "./fs.js";

export type DiscoveredTool = {
  name: string;
  description?: string;
  file: string;
  location?: { line: number; column: number };
  inputSchema?: unknown;
  outputSchema?: unknown;
  inputSchemaSource?: "schema" | "jsdoc" | "signature" | "default";
  outputSchemaSource?: "schema" | "jsdoc" | "signature" | "default";
};

export type DiscoveredResource = {
  name: string;
  description?: string;
  file: string;
  mediaType?: string;
};

export type DiscoveredPrompt = {
  name: string;
  description?: string;
  file: string;
  inputs?: Array<{ name: string; type: string; description?: string }>;
};

const TOOL_FILE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);

type JsonSchema = Record<string, unknown>;

type SchemaExport = {
  input?: unknown;
  output?: unknown;
};

type JSDocInference = {
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  sawParamTags: boolean;
  sawReturnTags: boolean;
  inferredParams: number;
  inferredReturn: boolean;
};

/**
 * Extract the summary line from a JSDoc block.
 */
function extractJSDocSummary(docBlock: string): string | undefined {
  const lines = docBlock
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => Boolean(line));
  return lines[0];
}

/**
 * Locate the default export keyword in a file for error reporting.
 */
function findDefaultExportLocation(content: string): { line: number; column: number } | undefined {
  const match = content.match(/export\s+default/);
  if (!match?.index && match?.index !== 0) return undefined;
  const prefix = content.slice(0, match.index);
  const lines = prefix.split(/\r?\n/);
  const line = lines.length;
  const column = lines[lines.length - 1]?.length + 1;
  return { line, column };
}

/**
 * Format a file + location label for warnings.
 */
function formatLocation(file: string, location?: { line: number; column: number }): string {
  if (!location) return file;
  return `${file}:${location.line}:${location.column}`;
}

/**
 * Split a type string by commas at the top level.
 */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of input) {
    if (char === "{" || char === "[" || char === "<") depth += 1;
    if (char === "}" || char === "]" || char === ">") depth -= 1;
    if ((char === "," || char === ";") && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Split by delimiter while ignoring nested type segments.
 */
function splitByTopLevel(input: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of input) {
    if (char === "{" || char === "[" || char === "<" || char === "(") depth += 1;
    if (char === "}" || char === "]" || char === ">" || char === ")") depth -= 1;
    if (char === delimiter && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Return true when the string is fully wrapped in a single paren pair.
 */
function isWrappedInParens(input: string): boolean {
  if (!input.startsWith("(") || !input.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && i < input.length - 1) return false;
  }
  return depth === 0;
}

/**
 * Normalize a type string (unwrap Promise and trim).
 */
function normalizeTypeString(typeStr: string): string {
  const trimmed = typeStr.trim();
  const promiseMatch = trimmed.match(/^Promise<(.+)>$/);
  if (promiseMatch) return promiseMatch[1].trim();
  return trimmed;
}

/**
 * Convert a TypeScript-like type string into JSON Schema.
 */
export function parseTypeString(typeStr: string): JsonSchema {
  const type = normalizeTypeString(typeStr).replace(/\s+/g, " ");
  if (isWrappedInParens(type)) {
    return parseTypeString(type.slice(1, -1).trim());
  }
  if (/^"[^"]*"$/.test(type) || /^'[^']*'$/.test(type)) {
    return { const: type.slice(1, -1) };
  }
  if (type === "true" || type === "false") {
    return { const: type === "true" };
  }
  if (/^-?\d+(\.\d+)?$/.test(type)) {
    return { const: Number(type) };
  }
  if (type === "any" || type === "unknown") return {};
  if (type === "Date") return { type: "string", format: "date-time" };
  if (type === "bigint") return { type: "integer" };
  const recordMatch = type.match(/^Record<(.+),\s*(.+)>$/);
  if (recordMatch) {
    return {
      type: "object",
      additionalProperties: parseTypeString(recordMatch[2]),
    };
  }
  const mapMatch = type.match(/^Map<(.+),\s*(.+)>$/);
  if (mapMatch) {
    return {
      type: "object",
      additionalProperties: parseTypeString(mapMatch[2]),
    };
  }
  const setMatch = type.match(/^Set<(.+)>$/);
  if (setMatch) {
    return {
      type: "array",
      items: parseTypeString(setMatch[1]),
      uniqueItems: true,
    };
  }
  const unionParts = splitByTopLevel(type, "|");
  if (unionParts.length > 1) {
    const parts = unionParts.map((part) => part.trim()).filter(Boolean);
    return { anyOf: parts.map((part) => parseTypeString(part)) };
  }
  const intersectionParts = splitByTopLevel(type, "&");
  if (intersectionParts.length > 1) {
    const parts = intersectionParts.map((part) => part.trim()).filter(Boolean);
    return { allOf: parts.map((part) => parseTypeString(part)) };
  }
  if (type.endsWith("[]")) {
    const inner = type.slice(0, -2).trim();
    if (inner.startsWith("(") && inner.endsWith(")")) {
      return { type: "array", items: parseTypeString(inner.slice(1, -1)) };
    }
    return { type: "array", items: parseTypeString(inner) };
  }
  const arrayMatch = type.match(/^Array<(.+)>$/);
  if (arrayMatch) {
    return { type: "array", items: parseTypeString(arrayMatch[1]) };
  }
  const readonlyArrayMatch = type.match(/^ReadonlyArray<(.+)>$/);
  if (readonlyArrayMatch) {
    return { type: "array", items: parseTypeString(readonlyArrayMatch[1]) };
  }
  if (type.startsWith("[") && type.endsWith("]")) {
    const inner = type.slice(1, -1).trim();
    const tupleItems = inner ? splitTopLevel(inner).map((part) => parseTypeString(part)) : [];
    return {
      type: "array",
      items: tupleItems,
      minItems: tupleItems.length,
      maxItems: tupleItems.length,
    };
  }
  const tupleMatch = type.match(/^Tuple<(.+)>$/);
  if (tupleMatch) {
    const inner = tupleMatch[1].trim();
    const tupleItems = inner ? splitTopLevel(inner).map((part) => parseTypeString(part)) : [];
    return {
      type: "array",
      items: tupleItems,
      minItems: tupleItems.length,
      maxItems: tupleItems.length,
    };
  }
  if (type.startsWith("{") && type.endsWith("}")) {
    const content = type.slice(1, -1).trim();
    const props: Record<string, unknown> = {};
    const required: string[] = [];
    for (const part of splitTopLevel(content)) {
      const match = part.match(/^([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+)$/);
      if (!match) continue;
      const [, key, optional, rawType] = match;
      props[key] = parseTypeString(rawType);
      if (!optional) required.push(key);
    }
    return {
      type: "object",
      properties: props,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
  }
  if (type.includes("object")) return { type: "object" };
  if (type.includes("string")) return { type: "string" };
  if (type.includes("number")) return { type: "number" };
  if (type.includes("boolean")) return { type: "boolean" };
  if (type.includes("void") || type.includes("undefined") || type.includes("null"))
    return { type: "null" };
  return { type: "string" };
}

/**
 * Infer input and output schemas from JSDoc tags.
 */
function inferSchemaFromDocBlock(docBlock: string): JSDocInference {
  const lines = docBlock.split("\n").map((l) => l.replace(/^\s*\*\s?/, "").trim());
  const inputProperties: Record<string, unknown> = {};
  const inputRequired: string[] = [];
  let outputSchema: JsonSchema | undefined;
  let sawParamTags = false;
  let sawReturnTags = false;
  let inferredParams = 0;
  let inferredReturn = false;

  for (const line of lines) {
    if (line.startsWith("@param")) {
      sawParamTags = true;
      const match = line.match(/@param\s+\{([^}]+)\}\s+(\S+)/);
      if (!match) continue;
      const typeRaw = match[1].trim();
      let nameRaw = match[2].trim();

      const isOptional = nameRaw.startsWith("[") && nameRaw.endsWith("]");
      if (isOptional) nameRaw = nameRaw.slice(1, -1);

      const nameParts = nameRaw.split(".");
      if (nameParts[0] === "input") {
        if (nameParts.length === 2) {
          const propName = nameParts[1];
          inputProperties[propName] = parseTypeString(typeRaw);
          if (!isOptional) inputRequired.push(propName);
          inferredParams += 1;
        }
        continue;
      }
      if (nameParts.length === 1) {
        const propName = nameParts[0];
        inputProperties[propName] = parseTypeString(typeRaw);
        if (!isOptional) inputRequired.push(propName);
        inferredParams += 1;
      }
    } else if (line.startsWith("@returns") || line.startsWith("@return")) {
      sawReturnTags = true;
      const start = line.indexOf("{");
      const end = line.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        const typeBody = line.slice(start + 1, end);
        outputSchema = parseTypeString(typeBody);
        inferredReturn = true;
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

  return {
    inputSchema,
    outputSchema,
    sawParamTags,
    sawReturnTags,
    inferredParams,
    inferredReturn,
  };
}

/**
 * Extract doc block + summary for a default export.
 */
function extractDefaultExportInfo(content: string): { description?: string; docBlock?: string } {
  const exportFnRegex =
    /(?:\/\*\*([\s\S]*?)\*\/\s*)?export\s+default\s+(?:async\s+)?function\s*(?:[A-Za-z0-9_$]+)?\s*\(/;
  const exportArrowRegex = /(?:\/\*\*([\s\S]*?)\*\/\s*)?export\s+default\s+(?:async\s+)?\(/;
  const namedExportRegex = /export\s+default\s+([A-Za-z0-9_$]+)/;

  let match = content.match(exportFnRegex);
  if (match?.[1]) {
    const description = extractJSDocSummary(match[1]);
    return { description, docBlock: match[1] };
  }

  match = content.match(exportArrowRegex);
  if (match?.[1]) {
    const description = extractJSDocSummary(match[1]);
    return { description, docBlock: match[1] };
  }

  const namedMatch = content.match(namedExportRegex);
  if (namedMatch) {
    const name = namedMatch[1];
    const fnRegex = new RegExp(
      `(?:/\\*\\*([\\s\\S]*?)\\*/\\s*)?(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`,
    );
    const constRegex = new RegExp(
      `(?:/\\*\\*([\\s\\S]*?)\\*/\\s*)?(?:export\\s+)?const\\s+${name}\\s*=\\s*(?:async\\s*)?\\(`,
    );
    const fnMatch = content.match(fnRegex) ?? content.match(constRegex);
    if (fnMatch?.[1]) {
      const description = extractJSDocSummary(fnMatch[1]);
      return { description, docBlock: fnMatch[1] };
    }
  }

  return {};
}

/**
 * Extract a parenthesized segment from a string starting at an index.
 */
function extractBetweenParens(
  content: string,
  startIndex: number,
): { value: string; endIndex: number } | null {
  let depth = 0;
  let value = "";
  for (let i = startIndex; i < content.length; i += 1) {
    const char = content[i];
    if (char === "(") {
      depth += 1;
      if (depth === 1) continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return { value, endIndex: i };
    }
    if (depth >= 1) value += char;
  }
  return null;
}

/**
 * Split a parameter list at top level, honoring nested parens.
 */
function splitTopLevelWithParens(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of input) {
    if (char === "{" || char === "[" || char === "<" || char === "(") depth += 1;
    if (char === "}" || char === "]" || char === ">" || char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Split a string once on a delimiter at top level.
 */
function splitOnTopLevel(input: string, delimiter: string): [string, string | null] {
  let depth = 0;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === "{" || char === "[" || char === "<" || char === "(") depth += 1;
    if (char === "}" || char === "]" || char === ">" || char === ")") depth -= 1;
    if (char === delimiter && depth === 0) {
      return [input.slice(0, i).trim(), input.slice(i + 1).trim()];
    }
  }
  return [input.trim(), null];
}

/**
 * Parse a destructured parameter into a schema shape.
 */
function parseDestructuredParams(param: string): {
  schema?: JsonSchema;
  source?: "signature";
} {
  const trimmed = param.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return {};
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return {};
  const props: Record<string, unknown> = {};
  const required: string[] = [];
  const parts = splitTopLevelWithParens(inner);
  for (const part of parts) {
    const token = part.trim();
    if (!token || token.startsWith("...")) continue;
    const [left] = splitOnTopLevel(token, "=");
    const [namePart] = splitOnTopLevel(left, ":");
    const name = namePart.replace(/\?/g, "").trim();
    if (!name) continue;
    props[name] = {};
    const hasDefault = token.includes("=");
    if (!hasDefault) required.push(name);
  }
  if (Object.keys(props).length === 0) return {};
  return {
    schema: {
      type: "object",
      properties: props,
      ...(required.length ? { required } : {}),
      additionalProperties: true,
    },
    source: "signature",
  };
}

/**
 * Extract params and return type from a default export signature.
 */
function extractDefaultExportSignature(content: string): { params?: string; returnType?: string } {
  const functionMatch = content.match(
    /export\s+default\s+(?:async\s+)?function(?:\s+[A-Za-z0-9_$]+)?\s*\(/,
  );
  if (functionMatch?.index !== undefined) {
    const start = functionMatch.index + functionMatch[0].length - 1;
    const params = extractBetweenParens(content, start);
    if (!params) return {};
    const rest = content.slice(params.endIndex + 1);
    const returnMatch = rest.match(/^\s*:\s*([^={;\n]+(?:<[^>]+>)?[^={;\n]*)/);
    const returnType = returnMatch ? returnMatch[1].trim() : undefined;
    return { params: params.value.trim(), returnType };
  }
  const arrowMatch = content.match(/export\s+default\s+(?:async\s+)?\(/);
  if (arrowMatch?.index !== undefined) {
    const start = arrowMatch.index + arrowMatch[0].length - 1;
    const params = extractBetweenParens(content, start);
    if (!params) return {};
    const rest = content.slice(params.endIndex + 1);
    const returnMatch = rest.match(/^\s*:\s*([^=]+?)\s*=>/);
    const returnType = returnMatch ? returnMatch[1].trim() : undefined;
    return { params: params.value.trim(), returnType };
  }
  return {};
}

/**
 * Infer schema from a function signature string.
 */
function inferSchemaFromSignature(content: string): {
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
} {
  const signature = extractDefaultExportSignature(content);
  if (!signature.params && !signature.returnType) return {};
  let inputSchema: JsonSchema | undefined;
  let outputSchema: JsonSchema | undefined;

  if (signature.params) {
    const params = splitTopLevelWithParens(signature.params);
    const firstParam = params[0]?.trim();
    if (firstParam) {
      const [paramName, typePart] = splitOnTopLevel(firstParam, ":");
      if (typePart) {
        inputSchema = parseTypeString(typePart);
      } else {
        const destructured = parseDestructuredParams(paramName.trim());
        inputSchema = destructured.schema;
      }
    }
  }

  if (signature.returnType) {
    outputSchema = parseTypeString(signature.returnType);
  }

  return { inputSchema, outputSchema };
}

/**
 * Convert a tool file path to a tool name.
 */
function toolNameFromPath(relativeFile: string): string {
  const withoutExt = relativeFile.replace(/\.[^.]+$/, "");
  return withoutExt.split(path.sep).join("-").split("/").join("-");
}

export type DiscoverToolsOptions = {
  onWarn?: (message: string) => void;
  failOnInvalid?: boolean;
};

/**
 * Discover tool modules from a tools directory.
 */
export async function discoverTools(
  cwd: string,
  toolsDir: string,
  options: DiscoverToolsOptions = {},
): Promise<DiscoveredTool[]> {
  const toolsPath = path.resolve(cwd, toolsDir);
  if (!fs.existsSync(toolsPath)) return [];

  const toolFiles = listFiles(toolsPath)
    .map((file) => path.join(toolsPath, file))
    .filter((file) => TOOL_FILE_EXTENSIONS.has(path.extname(file)))
    .sort((a, b) => a.localeCompare(b));

  const tools: DiscoveredTool[] = [];
  const defaultInputSchema = { type: "object", properties: {}, additionalProperties: true };
  const defaultOutputSchema = {};
  /**
   * Emit a discovery warning (or route to a handler).
   */
  const warn = (message: string) => {
    if (options.onWarn) {
      options.onWarn(message);
      return;
    }
    if (process.env.DZX_DEV === "1") {
      // eslint-disable-next-line no-console
      console.warn(message);
    }
  };
  /**
   * Raise an error when invalid tools should fail the build.
   */
  const fail = (message: string) => {
    if (options.failOnInvalid) {
      throw new Error(message);
    }
    warn(message);
  };

  for (const file of toolFiles) {
    const content = fs.readFileSync(file, "utf8");
    const relativeFile = path.relative(cwd, file);
    const relativeToolFile = path.relative(toolsPath, file);
    const name = toolNameFromPath(relativeToolFile);
    const location = findDefaultExportLocation(content);
    const locationLabel = formatLocation(relativeFile, location);
    const info = extractDefaultExportInfo(content);

    try {
      const fileUrl = pathToFileURL(file).href;
      const mod = await import(fileUrl);

      const fn = mod.default;
      if (typeof fn !== "function") {
        fail(`Tool file ${locationLabel} does not export a default function`);
        continue;
      }
      if (fn.constructor?.name !== "AsyncFunction") {
        fail(`Tool file ${locationLabel} default export must be async`);
      }

      const description = info.description;
      const camelName = name.replace(/[-_]+([a-zA-Z0-9])/g, (_, char) =>
        String(char).toUpperCase(),
      );
      const schemaExport =
        mod.schema ?? mod.toolSchema ?? mod.defaultSchema ?? mod[`${camelName}Schema`];

      let inputSchema: unknown;
      let outputSchema: unknown;
      let inputSchemaSource: DiscoveredTool["inputSchemaSource"];
      let outputSchemaSource: DiscoveredTool["outputSchemaSource"];

      if (schemaExport && typeof schemaExport === "object") {
        const schemaObject = schemaExport as SchemaExport;
        if (schemaObject.input || schemaObject.output) {
          inputSchema = schemaObject.input;
          outputSchema = schemaObject.output;
          if (inputSchema) inputSchemaSource = "schema";
          if (outputSchema) outputSchemaSource = "schema";
        }
      }

      // Schema resolution order: explicit export → JSDoc → signature → default.
      // Fallback: Infer from JSDoc if no inputSchema or outputSchema
      if ((!inputSchema || !outputSchema) && info?.docBlock) {
        const inferred = inferSchemaFromDocBlock(info.docBlock);
        if (!inputSchema && inferred.inputSchema) {
          inputSchema = inferred.inputSchema;
          inputSchemaSource = "jsdoc";
        }
        if (!outputSchema && inferred.outputSchema) {
          outputSchema = inferred.outputSchema;
          outputSchemaSource = "jsdoc";
        }
        if (
          (inferred.sawParamTags || inferred.sawReturnTags) &&
          inferred.inferredParams === 0 &&
          !inferred.inferredReturn
        ) {
          warn(
            `${locationLabel} JSDoc found but no usable @param/@returns types were inferred (use @param {type} name or @returns {type})`,
          );
        }
      }

      // Fallback: Infer from function signature/destructuring
      if (!inputSchema || !outputSchema) {
        const signature = inferSchemaFromSignature(content);
        if (!inputSchema && signature.inputSchema) {
          inputSchema = signature.inputSchema;
          inputSchemaSource = "signature";
        }
        if (!outputSchema && signature.outputSchema) {
          outputSchema = signature.outputSchema;
          outputSchemaSource = "signature";
        }
      }
      if (!inputSchema) inputSchema = defaultInputSchema;
      if (!outputSchema) outputSchema = defaultOutputSchema;
      if (!inputSchemaSource) {
        inputSchemaSource = "default";
        warn(
          `${locationLabel} missing input schema (add schema export, JSDoc, or type annotation)`,
        );
      }
      if (!outputSchemaSource) {
        outputSchemaSource = "default";
        warn(
          `${locationLabel} missing output schema (add schema export, @returns, or return type)`,
        );
      }

      tools.push({
        name,
        description,
        file: relativeFile,
        location,
        inputSchema,
        outputSchema,
        inputSchemaSource,
        outputSchemaSource,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failMessage = `Failed to load tool file ${relativeFile}: ${message}`;
      if (options.failOnInvalid) {
        throw new Error(failMessage);
      }
      warn(failMessage);
    }
  }
  return tools;
}

/**
 * Discover resources from a resources directory.
 */
export function discoverResources(cwd: string, resourcesDir: string): DiscoveredResource[] {
  const resourcesPath = path.resolve(cwd, resourcesDir);
  if (!fs.existsSync(resourcesPath)) return [];
  const files = listFiles(resourcesPath).filter((file) => file.endsWith(".md"));
  return files
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const fullPath = path.join(resourcesPath, file);
      const content = fs.readFileSync(fullPath, "utf8");
      const parsed = parseFrontmatter(content);
      const name = parsed.frontmatter.name ?? path.basename(file, path.extname(file));
      return {
        name,
        description: parsed.frontmatter.description,
        file: path.relative(cwd, fullPath),
        mediaType: "text/markdown",
      };
    });
}

/**
 * Discover prompts from a prompts directory.
 */
export function discoverPrompts(cwd: string, promptsDir: string): DiscoveredPrompt[] {
  const promptsPath = path.resolve(cwd, promptsDir);
  if (!fs.existsSync(promptsPath)) return [];
  const files = listFiles(promptsPath).filter((file) => file.endsWith(".md"));
  return files
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const fullPath = path.join(promptsPath, file);
      const content = fs.readFileSync(fullPath, "utf8");
      const parsed = parseFrontmatter(content);
      const name = parsed.frontmatter.name ?? path.basename(file, path.extname(file));
      return {
        name,
        description: parsed.frontmatter.description,
        file: path.relative(cwd, fullPath),
        inputs: parsed.frontmatter.inputs,
      };
    });
}

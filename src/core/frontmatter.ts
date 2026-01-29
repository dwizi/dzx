export type Frontmatter = {
  name?: string;
  description?: string;
  inputs?: Array<{ name: string; type: string; description?: string }>;
};

type ParsedFrontmatter = {
  frontmatter: Frontmatter;
  body: string;
};

/**
 * Parse YAML-like frontmatter from a Markdown file.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }

  const lines = content.split(/\r?\n/);
  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const body = lines.slice(endIndex + 1).join("\n");
  const frontmatter: Frontmatter = {};
  let inInputs = false;
  let currentInput: { name: string; type: string; description?: string } | null = null;

  for (const rawLine of frontmatterLines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("inputs:")) {
      inInputs = true;
      continue;
    }

    if (inInputs) {
      if (line.startsWith("-")) {
        const nameMatch = line.match(/-\s*name:\s*(.+)/);
        if (nameMatch) {
          currentInput = { name: nameMatch[1].trim(), type: "string" };
          frontmatter.inputs = frontmatter.inputs || [];
          frontmatter.inputs.push(currentInput);
        }
        continue;
      }
      if (currentInput && line.startsWith("type:")) {
        currentInput.type = line.replace("type:", "").trim();
        continue;
      }
      if (currentInput && line.startsWith("description:")) {
        currentInput.description = line.replace("description:", "").trim();
        continue;
      }
    }

    const kvMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();
      if (key === "name") frontmatter.name = value;
      if (key === "description") frontmatter.description = value;
    }
  }

  return { frontmatter, body };
}

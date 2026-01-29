# Build Output

`dzx build` produces a deployable bundle and a `tool-manifest.json` file.

## Output layout
```
dist/
  tools/
  resources/
  prompts/
  tool-manifest.json
```

## tool-manifest.json
Includes:
- app metadata (name/version/entry)
- runtime and permissions
- tool file paths + schemas
- resources/prompts with file paths

See `tool-manifest.schema.json` for the full schema.

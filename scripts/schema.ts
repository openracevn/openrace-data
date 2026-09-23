/** Regenerates schema/*.schema.json from the zod schemas. Run after changing scripts/lib/schema.ts. */
import { mkdirSync, writeFileSync } from "node:fs";
import { SCHEMA_DIR, jsonSchemaFiles } from "./lib/jsonschema.ts";

mkdirSync(SCHEMA_DIR, { recursive: true });
for (const [path, content] of Object.entries(jsonSchemaFiles())) {
  writeFileSync(path, content);
  console.log(`wrote ${path}`);
}

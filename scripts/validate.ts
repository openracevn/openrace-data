/** CI check: every race file matches the schema and data/index.json agrees with the files. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { CHECKS_PATH, ChecksSchema, serializeChecks } from "./lib/checks.ts";
import { INDEX_PATH, IndexSchema, RACES_DIR, RaceSchema, serialize, type Race } from "./lib/schema.ts";

const errors: string[] = [];
const races = new Map<string, Race>();

for (const file of readdirSync(RACES_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const path = `${RACES_DIR}/${file}`;
  const text = readFileSync(path, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    errors.push(`${path}: invalid JSON (${(err as Error).message})`);
    continue;
  }
  const parsed = RaceSchema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${path}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    continue;
  }
  if (`${parsed.data.id}.json` !== file) errors.push(`${path}: id "${parsed.data.id}" does not match filename`);
  if (serialize(json) !== text) errors.push(`${path}: not in canonical formatting (2-space JSON + trailing newline)`);
  races.set(parsed.data.id, parsed.data);
}

const index = IndexSchema.safeParse(JSON.parse(readFileSync(INDEX_PATH, "utf8")));
if (!index.success) {
  for (const issue of index.error.issues) errors.push(`${INDEX_PATH}: ${issue.path.join(".")}: ${issue.message}`);
} else {
  const ids = index.data.map((e) => e.id);
  if (ids.join() !== [...ids].sort((a, b) => a.localeCompare(b)).join()) errors.push(`${INDEX_PATH}: entries not sorted by id`);
  for (const entry of index.data) {
    const race = races.get(entry.id);
    if (!race) {
      errors.push(`${INDEX_PATH}: "${entry.id}" has no file in ${RACES_DIR}`);
      continue;
    }
    if (entry.lastModified !== race.updatedAt) errors.push(`${INDEX_PATH}: "${entry.id}" lastModified != race updatedAt`);
    const urls = [...new Set(race.sources.map((s) => s.url))].sort();
    if (urls.join() !== entry.sourceUrls.join()) errors.push(`${INDEX_PATH}: "${entry.id}" sourceUrls != race sources`);
  }
  const indexed = new Set(ids);
  for (const id of races.keys()) if (!indexed.has(id)) errors.push(`${RACES_DIR}/${id}.json: missing from ${INDEX_PATH}`);
}

if (existsSync(CHECKS_PATH)) {
  const text = readFileSync(CHECKS_PATH, "utf8");
  const checks = ChecksSchema.safeParse(JSON.parse(text));
  if (!checks.success) {
    for (const issue of checks.error.issues) errors.push(`${CHECKS_PATH}: ${issue.path.join(".")}: ${issue.message}`);
  } else if (serializeChecks(checks.data) !== text) {
    errors.push(`${CHECKS_PATH}: not in canonical formatting (sorted keys, 2-space JSON + trailing newline)`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
console.log(`OK: ${races.size} race(s), index consistent.`);

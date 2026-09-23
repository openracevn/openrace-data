/** CI check: every race file matches the schema and data/index.json agrees with the files. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { CHECKS_PATH, ChecksSchema, serializeChecks } from "./lib/checks.ts";
import { jsonSchemaFiles } from "./lib/jsonschema.ts";
import { INDEX_PATH, IndexSchema, RACES_DIR, RaceSchema, raceFileName, serialize, type Race } from "./lib/schema.ts";

const errors: string[] = [];
const races = new Map<string, Race>();
const idOwner = new Map<string, string>();
const slugOwner = new Map<string, string>();

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
  const expected = raceFileName(parsed.data.slug, parsed.data.date);
  if (expected !== file) {
    errors.push(`${path}: should be named ${expected} (slug + race year); to change a slug use npm run edit -- slug <race> <new-slug>`);
  }
  if (serialize(json) !== text) errors.push(`${path}: not in canonical formatting (2-space JSON + trailing newline)`);
  const sameId = idOwner.get(parsed.data.id);
  if (sameId) errors.push(`${path}: id "${parsed.data.id}" is also used by ${sameId}`);
  idOwner.set(parsed.data.id, path);
  races.set(parsed.data.id, parsed.data);
  const owner = slugOwner.get(parsed.data.slug);
  if (owner) errors.push(`${path}: slug "${parsed.data.slug}" is also used by ${owner}`);
  else slugOwner.set(parsed.data.slug, parsed.data.id);
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
      errors.push(`${INDEX_PATH}: "${entry.id}" (${entry.slug}) has no file in ${RACES_DIR}`);
      continue;
    }
    if (entry.slug !== race.slug) errors.push(`${INDEX_PATH}: "${entry.id}" slug != race slug`);
    if (entry.file !== raceFileName(race.slug, race.date)) errors.push(`${INDEX_PATH}: "${entry.id}" file != ${raceFileName(race.slug, race.date)}`);
    if (entry.name !== race.name || entry.date !== race.date) errors.push(`${INDEX_PATH}: "${entry.id}" name/date != race name/date`);
    if (entry.lastModified !== race.updatedAt) errors.push(`${INDEX_PATH}: "${entry.id}" lastModified != race updatedAt`);
    const urls = [...new Set(race.sources.map((s) => s.url))].sort();
    if (urls.join() !== entry.sourceUrls.join()) errors.push(`${INDEX_PATH}: "${entry.id}" sourceUrls != race sources`);
  }
  const indexed = new Set(ids);
  for (const [id, race] of races) if (!indexed.has(id)) errors.push(`${idOwner.get(id)}: id "${id}" missing from ${INDEX_PATH}`);
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

for (const [path, expected] of Object.entries(jsonSchemaFiles())) {
  const actual = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (actual !== expected) errors.push(`${path}: out of date with scripts/lib/schema.ts (run npm run schema)`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
console.log(`OK: ${races.size} race(s), index consistent.`);

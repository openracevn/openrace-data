/**
 * CI check: every race file matches the schema, data/index.json agrees with the
 * files, series and organizers referenced by races exist, and config/ and state/
 * parse and are in canonical formatting.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { AdminUnitsSchema, GEO_PATH, GeoCacheSchema, PlacesListSchema } from "./lib/geo.ts";
import { jsonSchemaFiles } from "./lib/jsonschema.ts";
import { READS_PATH, ReadCacheSchema } from "./lib/read.ts";
import {
  INDEX_PATH,
  IndexSchema,
  ORGANIZERS_PATH,
  OrganizerListSchema,
  RACES_DIR,
  RaceSchema,
  SERIES_PATH,
  SeriesListSchema,
  raceFileName,
  serialize,
  upgradeRace,
  type Race,
} from "./lib/schema.ts";
import { SITES_PATH, loadSites } from "./lib/sites.ts";
import { CHECKS_PATH, CREDITS_PATH, ChecksSchema, CreditsSchema, SITES_STATE_PATH, SitesStateSchema, serializeSorted } from "./lib/state.ts";
import type { z } from "zod";

const errors: string[] = [];
const races = new Map<string, Race>();
const idOwner = new Map<string, string>();
const slugOwner = new Map<string, string>();

let siteKeys = new Set<string>();
try {
  siteKeys = new Set(loadSites().sites.map((s) => s.key));
} catch (err) {
  errors.push(`${SITES_PATH}: ${(err as Error).message}`);
}

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
  const parsed = RaceSchema.safeParse(upgradeRace(json));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${path}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    continue;
  }
  const race = parsed.data;
  const expected = raceFileName(race.slug, race.date);
  if (expected !== file) {
    errors.push(`${path}: should be named ${expected} (slug + race year); to change a slug use npm run edit -- slug <race> <new-slug>`);
  }
  if (serialize(json) !== text) errors.push(`${path}: not in canonical formatting (2-space JSON + trailing newline)`);
  const sameId = idOwner.get(race.id);
  if (sameId) errors.push(`${path}: id "${race.id}" is also used by ${sameId}`);
  idOwner.set(race.id, path);
  races.set(race.id, race);
  const owner = slugOwner.get(race.slug);
  if (owner) errors.push(`${path}: slug "${race.slug}" is also used by ${owner}`);
  else slugOwner.set(race.slug, race.id);
  for (const site of new Set([...race.sources.map((s) => s.site), ...race.prices.map((p) => p.site), ...race.registrations.map((r) => r.site)])) {
    if (site !== "openrace" && siteKeys.size > 0 && !siteKeys.has(site)) errors.push(`${path}: site "${site}" is not in ${SITES_PATH}`);
  }
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
      errors.push(`${INDEX_PATH}: ${entry.id} has no race file`);
      continue;
    }
    if (entry.slug !== race.slug || entry.name !== race.name || entry.date !== race.date || entry.lastModified !== race.updatedAt || entry.seriesId !== race.seriesId) {
      errors.push(`${INDEX_PATH}: ${entry.id} is out of date with ${entry.file}`);
    }
    if (entry.file !== raceFileName(race.slug, race.date)) errors.push(`${INDEX_PATH}: ${entry.id} file should be ${raceFileName(race.slug, race.date)}`);
    const urls = [...new Set(race.sources.map((s) => s.url))].sort();
    if (urls.join() !== entry.sourceUrls.join()) errors.push(`${INDEX_PATH}: ${entry.id} sourceUrls don't match the race's sources`);
  }
  const indexed = new Set(ids);
  for (const id of races.keys()) if (!indexed.has(id)) errors.push(`${idOwner.get(id)}: id "${id}" missing from ${INDEX_PATH}`);
}

const series = checkList(SERIES_PATH, SeriesListSchema);
const organizers = checkList(ORGANIZERS_PATH, OrganizerListSchema);
for (const [id, race] of races) {
  if (race.seriesId && series && !series.has(race.seriesId)) errors.push(`${idOwner.get(id)}: seriesId "${race.seriesId}" is not in ${SERIES_PATH}`);
  if (race.organizerId && organizers && !organizers.has(race.organizerId)) errors.push(`${idOwner.get(id)}: organizerId "${race.organizerId}" is not in ${ORGANIZERS_PATH}`);
}

checkState(CHECKS_PATH, ChecksSchema);
checkState(SITES_STATE_PATH, SitesStateSchema);
checkState(CREDITS_PATH, CreditsSchema);
checkState(READS_PATH, ReadCacheSchema);
checkState(GEO_PATH, GeoCacheSchema);
checkData("data/places.json", PlacesListSchema);
checkData("data/admin-units.json", AdminUnitsSchema);

for (const [path, expected] of Object.entries(jsonSchemaFiles())) {
  const actual = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (actual !== expected) errors.push(`${path}: out of date with scripts/lib/schema.ts (run npm run schema)`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
console.log(`OK: ${races.size} race(s), ${series?.size ?? 0} series, ${organizers?.size ?? 0} organizer(s), index consistent.`);

/** A series/organizers list: valid, sorted by id, unique ids. Returns its ids (null if absent). */
function checkList(path: string, schema: z.ZodType<{ id: string }[]>): Set<string> | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${path}: ${issue.path.join(".")}: ${issue.message}`);
    return null;
  }
  const ids = parsed.data.map((e) => e.id);
  if (new Set(ids).size !== ids.length) errors.push(`${path}: duplicate ids`);
  if (ids.join() !== [...ids].sort((a, b) => a.localeCompare(b)).join()) errors.push(`${path}: entries not sorted by id`);
  if (serialize(JSON.parse(text)) !== text) errors.push(`${path}: not in canonical formatting`);
  return new Set(ids);
}

function checkState(path: string, schema: z.ZodType<Record<string, unknown>>): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${path}: ${issue.path.join(".")}: ${issue.message}`);
  } else if (serializeSorted(parsed.data) !== text) {
    errors.push(`${path}: not in canonical formatting (sorted keys, 2-space JSON + trailing newline)`);
  }
}

function checkData(path: string, schema: z.ZodType): void {
  if (!existsSync(path)) {
    errors.push(`${path}: missing (run npm run geo)`);
    return;
  }
  const text = readFileSync(path, "utf8");
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${path}: ${issue.path.join(".")}: ${issue.message}`);
  } else if (serialize(parsed.data) !== text) {
    errors.push(`${path}: not in canonical formatting (2-space JSON + trailing newline)`);
  }
}

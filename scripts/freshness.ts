/**
 * One-off (plan 004 stage B): build state/freshness.json for every race from the
 * local data/index.json, state/checks.json and config/sites.yaml, so the API can
 * say how fresh each race is. The check run writes the file on every data commit
 * too (sync.ts freshnessFile); this is the initial fill for all races.
 *
 *   npm run freshness
 */
import { readFileSync, writeFileSync } from "node:fs";
import { FRESHNESS_PATH, FRESHNESS_STATUSES, buildFreshness, freshnessStatus } from "./lib/freshness.ts";
import { INDEX_PATH, IndexSchema } from "./lib/schema.ts";
import { loadSites } from "./lib/sites.ts";
import { CHECKS_PATH, parseChecks, serializeSorted } from "./lib/state.ts";

const read = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

const config = loadSites();
const now = new Date();
const index = IndexSchema.parse(JSON.parse(read(INDEX_PATH) ?? "[]"));
const checks = parseChecks(read(CHECKS_PATH));
const fresh = buildFreshness(index, checks, config, now);

// Status counts for the upcoming races; final ones are never checked again.
const counts = new Map<string, number>();
let upcoming = 0;
for (const entry of index) {
  const status = freshnessStatus(fresh[entry.id]!, now);
  if (status === "final") continue;
  upcoming++;
  counts.set(status, (counts.get(status) ?? 0) + 1);
}
for (const status of FRESHNESS_STATUSES) {
  if (status === "final") continue;
  console.log(`${status}: ${counts.get(status) ?? 0}`);
}

writeFileSync(FRESHNESS_PATH, serializeSorted(fresh));
console.log(`\nwrote ${FRESHNESS_PATH}: ${index.length} race(s), ${upcoming} upcoming (not final).`);
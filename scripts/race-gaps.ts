/**
 * Per-race and per-series checklist of what is still missing (plan 019). Read-only and
 * always exits 0, like gaps.ts. `update-race` uses it to decide what is left to do.
 *
 *   npm run race-gaps -- --race <slug|id|name fragment> [--race ...]
 *   npm run race-gaps -- --series <series id> [--series ...]
 *
 * (`npm run gaps -- --race x` forwards here.) A series prints its editions, missing years
 * and edition numbers, then the checklist of each edition.
 */
import { readdirSync, readFileSync } from "node:fs";
import { formatRaceChecklist, formatSeriesChecklist, raceChecklist, seriesChecklist } from "./lib/race-gaps.ts";
import { RACES_DIR, RaceSchema, SERIES_PATH, SeriesListSchema, upgradeRace, type Race } from "./lib/schema.ts";

const args = process.argv.slice(2);
const wanted = (flag: string) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]!.toLowerCase()] : []));
const raceQueries = wanted("--race");
const seriesQueries = wanted("--series");
if (raceQueries.length + seriesQueries.length === 0) {
  console.error("usage: npm run race-gaps -- --race <slug|id|name> [--race ...] | --series <id> [--series ...]");
  process.exit(0);
}

const races: Race[] = [];
for (const file of readdirSync(RACES_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const parsed = RaceSchema.safeParse(upgradeRace(JSON.parse(readFileSync(`${RACES_DIR}/${file}`, "utf8"))));
  if (parsed.success) races.push(parsed.data);
}
const series = SeriesListSchema.parse(JSON.parse(readFileSync(SERIES_PATH, "utf8")));
const today = new Date().toISOString().slice(0, 10);

for (const q of raceQueries) {
  const exact = races.filter((r) => r.id === q || r.slug === q);
  const hits = exact.length ? exact : races.filter((r) => r.slug.includes(q) || r.name.toLowerCase().includes(q));
  if (hits.length === 0) console.log(`\nno race matches "${q}": it may be a new race to find and add`);
  for (const r of hits) console.log(`\n${formatRaceChecklist(raceChecklist(r, today))}`);
}

for (const q of seriesQueries) {
  const s = series.find((x) => x.id === q) ?? series.find((x) => x.id.includes(q) || x.name.toLowerCase().includes(q));
  if (!s) {
    console.log(`\nno series matches "${q}": it may be a new series (no seriesId on any race yet)`);
    continue;
  }
  console.log(`\n${formatSeriesChecklist(seriesChecklist(s, races))}`);
  for (const r of races.filter((x) => x.seriesId === s.id).sort((a, b) => a.date.localeCompare(b.date))) console.log(`\n${formatRaceChecklist(raceChecklist(r, today))}`);
}

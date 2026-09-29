/**
 * Read-only report of missing data across data/races/*.json: no usable location, no
 * organizer, no prices (split upcoming/past), existing flags/low confidence, and series
 * with a year gap between their earliest and latest edition. Not a CI gate (see
 * validate.ts for that) — always exits 0.
 *
 *   npm run gaps
 *   npm run gaps -- --race <x> | --series <x>   (per-race checklist, see race-gaps.ts)
 */
import { readdirSync, readFileSync } from "node:fs";

// `npm run gaps -- --race <x>` / `--series <x>` is the per-race checklist (scripts/race-gaps.ts).
if (process.argv.some((a) => a === "--race" || a === "--series")) {
  await import("./race-gaps.ts");
  process.exit(0);
}

import { ORGANIZERS_PATH, OrganizerListSchema, RACES_DIR, RaceSchema, SERIES_PATH, SeriesListSchema, upgradeRace, type Race } from "./lib/schema.ts";

const races: Race[] = [];
for (const file of readdirSync(RACES_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const parsed = RaceSchema.safeParse(upgradeRace(JSON.parse(readFileSync(`${RACES_DIR}/${file}`, "utf8"))));
  if (parsed.success) races.push(parsed.data);
}

const seriesNames = new Map<string, string>();
try {
  for (const s of SeriesListSchema.parse(JSON.parse(readFileSync(SERIES_PATH, "utf8")))) seriesNames.set(s.id, s.name);
} catch {
  // Report still works without series.json; names just fall back to ids.
}

// Organizer worklists, biggest first (by races as primary or co-organizer).
const raceCount = new Map<string, number>();
for (const r of races) for (const id of [r.organizerId, ...(r.coOrganizerIds ?? [])]) if (id) raceCount.set(id, (raceCount.get(id) ?? 0) + 1);
const organizers = OrganizerListSchema.parse(JSON.parse(readFileSync(ORGANIZERS_PATH, "utf8")));
const bySize = (a: { id: string }, b: { id: string }) => (raceCount.get(b.id) ?? 0) - (raceCount.get(a.id) ?? 0) || a.id.localeCompare(b.id);
// Role text or several bodies packed into one name: should be a primary plus coOrganizerIds.
const MERGED_NAME = /(đơn vị|ban tổ chức|đồng hành|đồng tổ chức|phối hợp|nhà tài trợ|\s[-–&]\s|,|;|\|)/i;
const mergedOrganizers = organizers.filter((o) => MERGED_NAME.test(o.name)).sort(bySize);
const noOrganizerLinks = organizers.filter((o) => !o.links?.length && !MERGED_NAME.test(o.name)).sort(bySize);

const today = new Date().toISOString().slice(0, 10);

const noLocation = races.filter((r) => !r.location.city && !r.location.venue);
const noOrganizer = races.filter((r) => !r.organizerId);
const noPricesUpcoming = races.filter((r) => r.date >= today && r.prices.length === 0);
const noPricesPast = races.filter((r) => r.date < today && r.prices.length === 0);
const flagged = races.filter((r) => r.flags.length > 0 || r.confidence === "conflicting");

const byYearGap = seriesYearGaps(races);

// Multi-day races whose main race day isn't stated yet (informational; never guessed).
const noMainDate = races.filter((r) => r.endDate !== null && r.mainDate === null);

// Backfill worklist: past editions with no stated participant count, biggest series first.
const seriesSize = new Map<string, number>();
for (const r of races) if (r.seriesId) seriesSize.set(r.seriesId, (seriesSize.get(r.seriesId) ?? 0) + 1);
const noParticipantsPast = races
  .filter((r) => r.date < today && !r.participants)
  .sort((a, b) => (seriesSize.get(b.seriesId ?? "") ?? 0) - (seriesSize.get(a.seriesId ?? "") ?? 0) || a.date.localeCompare(b.date));

const lowParticipants = races.filter((r) => r.participants?.confidence === "low");

const orgLine = (o: { id: string; name: string }) => `${o.id} (${raceCount.get(o.id) ?? 0} races): ${o.name}`;
report("Organizers with merged-looking names (split with the check-organizer skill)", mergedOrganizers, orgLine, organizers.length);
report("Organizers with no links (biggest first)", noOrganizerLinks, orgLine, organizers.length);
report("No usable location (city and venue both null)", noLocation, (r) => r.slug);
report("No organizerId (biggest series first)", [...noOrganizer].sort((a, b) => (seriesSize.get(b.seriesId ?? "") ?? 0) - (seriesSize.get(a.seriesId ?? "") ?? 0)), (r) => r.slug);
report(`No prices, upcoming (date >= ${today})`, noPricesUpcoming, (r) => `${r.slug} (${r.date})`);
report("No prices, past (informational — may be free or unpriced)", noPricesPast, (r) => `${r.slug} (${r.date})`);
report("Flagged or conflicting confidence", flagged, (r) => `${r.slug} (confidence: ${r.confidence}, flags: ${r.flags.join("; ") || "none"})`);
report("Multi-day races with no mainDate (informational; fill only where a source states the main day)", noMainDate, (r) => `${r.slug} (${r.date}..${r.endDate})`);
report("Past races with no participant count (backfill worklist, biggest series first; a report, not a failure)", noParticipantsPast, (r) => `${r.slug} (${r.date}${r.seriesId ? `, series ${r.seriesId}: ${seriesSize.get(r.seriesId)} editions` : ""})`);
report("Participant counts with low confidence (no verified quote; upgrade with a quoted source; informational)", lowParticipants, (r) => `${r.slug} (${r.participants!.count}: ${r.participants!.sourceUrl})`);

console.log(`\nSeries with a year gap: ${byYearGap.length}`);
for (const { seriesId, years } of byYearGap.slice(0, 10)) {
  console.log(`  - ${seriesNames.get(seriesId) ?? seriesId} (${seriesId}): editions in ${years.join(", ")}`);
}

console.log(`\n${races.length} race(s) checked.`);

function report<T>(title: string, list: T[], describe: (r: T) => string, total = races.length): void {
  console.log(`\n${title}: ${list.length} / ${total}`);
  for (const r of list.slice(0, 10)) console.log(`  - ${describe(r)}`);
  if (list.length > 10) console.log(`  ... and ${list.length - 10} more`);
}

/** Series with 2+ editions where the year sequence has a hole between the earliest and latest. */
function seriesYearGaps(races: Race[]): { seriesId: string; years: number[] }[] {
  const bySeriesYears = new Map<string, Set<number>>();
  for (const r of races) {
    if (!r.seriesId) continue;
    const years = bySeriesYears.get(r.seriesId) ?? new Set<number>();
    years.add(Number(r.date.slice(0, 4)));
    bySeriesYears.set(r.seriesId, years);
  }
  const gaps: { seriesId: string; years: number[] }[] = [];
  for (const [seriesId, yearSet] of bySeriesYears) {
    const years = [...yearSet].sort((a, b) => a - b);
    if (years.length < 2) continue;
    const min = Math.min(...years);
    const max = Math.max(...years);
    if (years.length !== max - min + 1) gaps.push({ seriesId, years });
  }
  return gaps.sort((a, b) => a.seriesId.localeCompare(b.seriesId));
}

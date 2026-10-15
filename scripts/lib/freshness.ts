/**
 * How fresh each race is (trust principle 2 — fresh, and visibly fresh): when its
 * sources were last checked, when its file last changed, how often its sources are
 * read, and when the next check is due. Written to state/freshness.json on every
 * commit (see sync.ts freshnessFile, one place for check, agent-read, renormalize
 * and edit) and by scripts/freshness.ts, so the API can show freshness per race
 * without reading every checks.json.
 */
import { z } from "zod";
import { type IndexEntry } from "./schema.ts";
import { siteForUrl, type SitesConfig } from "./sites.ts";
import { vietnamDate, type Checks } from "./state.ts";

export const FRESHNESS_PATH = "state/freshness.json";
export const FRESHNESS_STATUSES = ["fresh", "due", "stale", "final", "unscheduled"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

/** The API shows these. Since plan 027 a race is weekly (Schedule 1's Monday pass reads every upcoming race on a site with a recipe) or manual. */
export const CADENCES = ["weekly", "monthly", "quarterly", "yearly", "manual"] as const;
export type Cadence = (typeof CADENCES)[number];
export const CADENCE_DAYS: Record<Cadence, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
  manual: Number.POSITIVE_INFINITY,
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const FreshnessEntrySchema = z.object({
  lastCheckedAt: z.iso.datetime().nullable(), // newest ok/facts check over the race's source URLs; null: never checked
  lastChangedAt: z.iso.datetime(), // the race file's updatedAt (index lastModified)
  cadence: z.enum(CADENCES), // weekly when a source is on a site with a recipe (plan 027), else manual
  dueAt: isoDate.nullable(), // Vietnam date of lastCheckedAt + cadence; null when manual or never checked
  final: z.boolean(), // the race's last day (endDate ?? date) is before today in Vietnam
});
export const FreshnessSchema = z.record(z.uuid(), FreshnessEntrySchema);

export type FreshnessEntry = z.infer<typeof FreshnessEntrySchema>;

const DAY_MS = 86_400_000;

/** A race is due again when its newest check plus its cadence is past. Manual sites never are. */
export function buildFreshness(index: IndexEntry[], checks: Checks, config: SitesConfig, now: Date): Record<string, FreshnessEntry> {
  const out: Record<string, FreshnessEntry> = {};
  const today = vietnamDate(now);
  for (const entry of index) {
    let lastCheckedAt: string | null = null;
    let cadence: Cadence = "manual";
    for (const url of entry.sourceUrls) {
      const check = checks[url];
      if (check && (check.status === "ok" || check.status === "facts") && (lastCheckedAt === null || check.lastCheckedAt > lastCheckedAt)) lastCheckedAt = check.lastCheckedAt;
      const site = siteForUrl(config, url);
      if (site && site.recipe !== "none") cadence = "weekly";
    }
    const days = CADENCE_DAYS[cadence];
    const dueAt = lastCheckedAt && Number.isFinite(days) ? vietnamDate(new Date(Date.parse(lastCheckedAt) + days * DAY_MS)) : null;
    out[entry.id] = {
      lastCheckedAt,
      lastChangedAt: entry.lastModified,
      cadence,
      dueAt,
      // After the race's last day nothing can change, so it is never stale again.
      final: today > (entry.endDate ?? entry.date),
    };
  }
  return out;
}

/**
 * final first, then unscheduled (a race only a manual site has is never late),
 * then stale once more than 2× the cadence has passed since the last check, then
 * due from its due date, else fresh.
 */
export function freshnessStatus(e: FreshnessEntry, now: Date): FreshnessStatus {
  if (e.final) return "final";
  if (e.cadence === "manual") return "unscheduled";
  if (e.lastCheckedAt === null) return "stale";
  const days = CADENCE_DAYS[e.cadence];
  if (Number.isFinite(days) && now.getTime() > Date.parse(e.lastCheckedAt) + 2 * days * DAY_MS) return "stale";
  if (e.dueAt !== null && vietnamDate(now) >= e.dueAt) return "due";
  return "fresh";
}
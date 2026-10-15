/**
 * What the checker remembers between runs, in state/ (outside data/, so bookkeeping
 * commits don't count as data changes: no Discord post, no API resync).
 *
 * - checks.json: per race page, when it was last read, how it went, and the
 *   fingerprint of what was read. An unchanged fingerprint means nothing is paid for.
 *   `status: facts` without a fingerprint marks a page never read in full. Pages
 *   waiting for a read are on the to-do list (todo.ts, plan 027).
 * - sites.json:  per site, when it was last checked and how many runs in a row failed.
 * - credits.json: Firecrawl credits spent per calendar month (UTC), for the cap, and
 *   per day in Vietnam (the digest's week), kept for DAY_CREDITS_KEPT days.
 */
import { z } from "zod";
import { serialize } from "./schema.ts";

export const CHECKS_PATH = "state/checks.json";
export const SITES_STATE_PATH = "state/sites.json";
export const CREDITS_PATH = "state/credits.json";

export const CheckSchema = z.object({
  lastCheckedAt: z.iso.datetime(),
  // facts: only the site's free data was taken (--facts-only); the page is still to be read.
  status: z.enum(["ok", "facts", "rejected", "error"]),
  reason: z.string().optional(),
  /** Rejected for what the page is (not a sports event), not for a transient problem. */
  permanent: z.boolean().optional(),
  /** Hash of the content last read (read.ts snapshotFingerprint). */
  fingerprint: z.string().optional(),
});
export const ChecksSchema = z.record(z.url(), CheckSchema);

export const SiteStateSchema = z.object({
  lastCheckedAt: z.iso.datetime(),
  status: z.enum(["ok", "error"]),
  reason: z.string().optional(),
  /** Runs in a row that failed to read the site at all. */
  failures: z.number().int().nonnegative(),
});
export const SitesStateSchema = z.record(z.string(), SiteStateSchema);

// "YYYY-MM" (UTC month) or "YYYY-MM-DD" (day in Vietnam).
export const CreditsSchema = z.record(z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/), z.number().int().nonnegative());

export type Check = z.infer<typeof CheckSchema>;
export type Checks = Record<string, Check>;
export type SiteState = z.infer<typeof SiteStateSchema>;
export type SitesState = Record<string, SiteState>;
export type Credits = Record<string, number>;

export const parseChecks = (text: string | null): Checks => (text ? ChecksSchema.parse(JSON.parse(text)) : {});
export const parseSitesState = (text: string | null): SitesState => (text ? SitesStateSchema.parse(JSON.parse(text)) : {});
export const parseCredits = (text: string | null): Credits => (text ? CreditsSchema.parse(JSON.parse(text)) : {});

/** Stable output: keys sorted, so diffs only show what a run touched. */
export function serializeSorted(record: Record<string, unknown>): string {
  return serialize(Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))));
}

const DAY_MS = 86_400_000;
export const DAY_CREDITS_KEPT = 62;

/** A page never read in full: unknown, or only ever taken from free facts (status `facts`, no fingerprint). */
export function isUnread(check: Check | undefined): boolean {
  if (!check) return true;
  return check.status === "facts" && !check.fingerprint;
}

/**
 * Pages never read first, then the soonest race day, then the listing order, so a
 * credit cap leaves the races that can wait. `dayOf` gives a page's race day
 * (from the listing, else the race on file), "9999-12-31" when unknown.
 */
export function sortByUrgency<T extends { url: string }>(refs: readonly T[], checks: Checks, dayOf: (r: T) => string): T[] {
  return refs
    .map((r, i) => ({ r, i, u: isUnread(checks[r.url]) ? 0 : 1, d: dayOf(r) }))
    .sort((a, b) => a.u - b.u || a.d.localeCompare(b.d) || a.i - b.i)
    .map(({ r }) => r);
}

/** Adds a run's credits to its month and its day, and drops days older than DAY_CREDITS_KEPT. */
export function addCredits(credits: Credits, spent: number, now: Date): Credits {
  const out = { ...credits };
  const month = monthKey(now);
  const day = vietnamDate(now);
  out[month] = (out[month] ?? 0) + spent;
  out[day] = (out[day] ?? 0) + spent;
  const oldest = vietnamDate(new Date(now.getTime() - DAY_CREDITS_KEPT * DAY_MS));
  for (const key of Object.keys(out)) if (key.length === 10 && key < oldest) delete out[key];
  return out;
}

/** Credits spent over the 7 days in Vietnam ending today. */
export function weekCredits(credits: Credits, now: Date): number {
  const from = vietnamDate(new Date(now.getTime() - 6 * DAY_MS));
  const to = vietnamDate(now);
  return Object.entries(credits).reduce((sum, [key, n]) => (key.length === 10 && key >= from && key <= to ? sum + n : sum), 0);
}

/** Today's date in Vietnam, where the races are, as YYYY-MM-DD. */
export function vietnamDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(now);
}

export function monthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

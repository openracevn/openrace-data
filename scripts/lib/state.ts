/**
 * What the checker remembers between runs, in state/ (outside data/, so bookkeeping
 * commits don't count as data changes: no Discord post, no API resync).
 *
 * - checks.json: per race page, when it was last read, how it went, and the
 *   fingerprint of what was read. An unchanged fingerprint means nothing is paid for.
 * - sites.json:  per site, when it was last checked and how many runs in a row failed.
 * - credits.json: Firecrawl credits spent per calendar month (UTC), for the cap.
 */
import { z } from "zod";
import { serialize } from "./schema.ts";
import { CADENCE_DAYS, type Site } from "./sites.ts";

export const CHECKS_PATH = "state/checks.json";
export const SITES_STATE_PATH = "state/sites.json";
export const CREDITS_PATH = "state/credits.json";

export const CheckSchema = z.object({
  lastCheckedAt: z.iso.datetime(),
  status: z.enum(["ok", "rejected", "error"]),
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

export const CreditsSchema = z.record(z.string().regex(/^\d{4}-\d{2}$/), z.number().int().nonnegative());

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

/** A site is due when its cadence has passed since the last check (manual sites never are). */
export function isSiteDue(site: Site, state: SiteState | undefined, now: Date): boolean {
  const days = CADENCE_DAYS[site.check];
  if (!Number.isFinite(days)) return false;
  if (!state) return true;
  return (now.getTime() - Date.parse(state.lastCheckedAt)) / DAY_MS >= days - 0.5;
}

/** Today's date in Vietnam, where the races are, as YYYY-MM-DD. */
export function vietnamDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(now);
}

export function monthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

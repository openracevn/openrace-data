/**
 * When to (re)scrape a source page. The check log lives in state/checks.json,
 * outside data/, so bookkeeping commits don't count as data changes (no Discord
 * post, no API resync).
 *
 * - New pages: scraped the first time they're discovered.
 * - Known races: re-checked every REFRESH_DAYS until race day, never after.
 * - Pages that aren't running races (cycling, triathlon, ...): never re-checked
 *   automatically. Anything else that failed (flaky render, no date yet, scrape
 *   error) is retried after RETRY_DAYS.
 */
import { z } from "zod";
import { serialize } from "./schema.ts";

export const CHECKS_PATH = "state/checks.json";
export const REFRESH_DAYS = 14;
export const RETRY_DAYS = 3;

export const CheckSchema = z.object({
  lastCheckedAt: z.iso.datetime(),
  status: z.enum(["ok", "rejected", "error"]),
  reason: z.string().optional(),
  /** Rejected for what the page is (not a running race), not for a transient problem. */
  permanent: z.boolean().optional(),
});
export const ChecksSchema = z.record(z.url(), CheckSchema);

export type Check = z.infer<typeof CheckSchema>;
export type Checks = Record<string, Check>;

export function parseChecks(text: string | null): Checks {
  return text ? ChecksSchema.parse(JSON.parse(text)) : {};
}

/** Stable output: keys sorted, so diffs only show what this run touched. */
export function serializeChecks(checks: Checks): string {
  return serialize(Object.fromEntries(Object.entries(checks).sort(([a], [b]) => a.localeCompare(b))));
}

const DAY_MS = 86_400_000;

function ageDays(check: Check, now: Date): number {
  return (now.getTime() - Date.parse(check.lastCheckedAt)) / DAY_MS;
}

/** A known race's source page: due every REFRESH_DAYS until race day (inclusive), sooner after a failed check. */
export function isRefreshDue(raceDate: string, check: Check | undefined, today: string, now: Date): boolean {
  if (raceDate < today) return false;
  if (!check) return true;
  return ageDays(check, now) >= (check.status === "ok" ? REFRESH_DAYS : RETRY_DAYS);
}

/** A discovered page that isn't a race yet: scrape unless it was rejected for good or failed recently. */
export function isCandidate(check: Check | undefined, now: Date): boolean {
  if (!check) return true;
  if (check.permanent) return false;
  return ageDays(check, now) >= RETRY_DAYS;
}

/** Oldest (or never) checked first, so a capped run makes progress on the most stale pages. */
export function byStaleness(checks: Checks): (a: string, b: string) => number {
  return (a, b) => (checks[a]?.lastCheckedAt ?? "").localeCompare(checks[b]?.lastCheckedAt ?? "");
}

/** Today's date in Vietnam, where the races are, as YYYY-MM-DD. */
export function vietnamDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(now);
}

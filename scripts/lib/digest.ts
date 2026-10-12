/**
 * The Monday data digest (plan 026, step 5): the to-do list for the data, as one
 * Discord message. Pure functions over the committed files, so notify-stale.ts and
 * notify-weekly.ts only load and post, and the rules are tested.
 *
 * - Freshness share of the races that aren't final. `final` is recomputed from the
 *   index's dates at read time: state/freshness.json is only rewritten on a commit,
 *   so between commits it still calls a race that took place yesterday "stale".
 * - Pages pending a paid read (state/checks.json), split by whether Tuesday's
 *   scheduled run takes them (trusted site) or they wait for a check by hand.
 * - Races that need a person: stale, or missing prices, courses, types or a venue.
 * - Firecrawl credits spent this month against the scheduled cap.
 */
import { freshnessStatus, type FreshnessEntry, type FreshnessStatus } from "./freshness.ts";
import { raceChecklist } from "./race-gaps.ts";
import type { IndexEntry, Race } from "./schema.ts";
import { hostOf, siteForUrl, type SitesConfig } from "./sites.ts";
import { isPendingCheck, monthKey, vietnamDate, type Checks, type Credits } from "./state.ts";
import { canonicalSourceUrl } from "./slug.ts";

export const DISCORD_LIMIT = 2000;
const MAX_LISTED = 15;
/** A page plus one image, 5 credits each: the usual cost of reading one race page. */
const CREDITS_PER_PENDING_PAGE = 10;
/** Gaps that make a race worth a session on their own. */
const SESSION_GAPS = ["prices", "courses", "types", "venue"] as const;
/** Gaps only mentioned alongside one of the above (a one-off race rightly has no series). */
const SECONDARY_GAPS = ["series", "edition"] as const;

export type DigestInput = {
  index: IndexEntry[];
  /** Race files by id; a race missing here only gets its freshness counted. */
  races: Map<string, Race>;
  freshness: Record<string, FreshnessEntry>;
  checks: Checks;
  config: SitesConfig;
  credits: Credits;
  now: Date;
};

/** The freshness entry with `final` as of today in Vietnam, from the index's dates. */
export function recomputeFinal(entry: IndexEntry, f: FreshnessEntry, today: string): FreshnessEntry {
  return { ...f, final: today > (entry.endDate ?? entry.date) };
}

export type FreshnessShare = Record<FreshnessStatus, number> & { total: number };

/** Status counts over the races that aren't final. */
export function freshnessShare(index: IndexEntry[], freshness: Record<string, FreshnessEntry>, now: Date): FreshnessShare {
  const today = vietnamDate(now);
  const share: FreshnessShare = { fresh: 0, due: 0, stale: 0, final: 0, unscheduled: 0, total: 0 };
  for (const entry of index) {
    const f = freshness[entry.id];
    if (!f) continue;
    const status = freshnessStatus(recomputeFinal(entry, f, today), now);
    if (status === "final") continue;
    share[status]++;
    share.total++;
  }
  return share;
}

export function formatFreshnessShare(s: FreshnessShare): string {
  const parts = [`fresh ${s.fresh}`, `due ${s.due}`, `stale ${s.stale}`];
  if (s.unscheduled > 0) parts.push(`unscheduled ${s.unscheduled}`);
  return `${parts.join(" · ")} (of ${s.total} upcoming)`;
}

export type PendingPage = { url: string; name: string; host: string; trusted: boolean; known: boolean };

/**
 * Pages waiting for a paid read: changed since their last read, or never read in
 * full. Only pages of races that aren't final, plus pages no race has yet (a new
 * page still needs its read).
 */
export function pendingPages(index: IndexEntry[], checks: Checks, config: SitesConfig, now: Date): PendingPage[] {
  const today = vietnamDate(now);
  const byUrl = new Map<string, IndexEntry>();
  for (const entry of index) for (const url of entry.sourceUrls) byUrl.set(url, entry);
  const out: PendingPage[] = [];
  for (const [url, check] of Object.entries(checks)) {
    if (!isPendingCheck(check) || check.permanent) continue;
    let canonical = url;
    try {
      canonical = canonicalSourceUrl(url);
    } catch {
      // keep the raw URL
    }
    const entry = byUrl.get(url) ?? byUrl.get(canonical);
    if (entry && today > (entry.endDate ?? entry.date)) continue;
    out.push({ url, name: entry?.name ?? url, host: hostOf(url), trusted: siteForUrl(config, url)?.trusted ?? false, known: !!entry });
  }
  // Races on file first, by name; pages no race has yet after them.
  return out.sort((a, b) => Number(b.known) - Number(a.known) || a.name.localeCompare(b.name));
}

export function formatPending(pages: PendingPage[]): string {
  if (pages.length === 0) return "Pending a paid read: none";
  const scheduled = pages.filter((p) => p.trusted);
  const byHand = pages.filter((p) => !p.trusted);
  const parts: string[] = [];
  if (scheduled.length > 0) parts.push(`Tuesday's run takes ${scheduled.length}`);
  if (byHand.length > 0) {
    const names = byHand.slice(0, 3).map((p) => `${p.name} on ${p.host}`);
    parts.push(`${byHand.length} wait${byHand.length === 1 ? "s" : ""} for a check by hand: ${names.join(", ")}${byHand.length > 3 ? ", …" : ""}`);
  }
  return `Pending a paid read: ${pages.length} page${pages.length === 1 ? "" : "s"}, about ${pages.length * CREDITS_PER_PENDING_PAGE} credits (${parts.join("; ")})`;
}

export type NeedsYou = { id: string; name: string; date: string; reasons: string[]; staleSince: string | null };

/** Gaps a full read of the page usually fills; not a person's job while Tuesday's run has the page. */
const READ_FILLS = ["prices", "courses", "types"] as const;

/**
 * Races a person should look at: stale (not checked in time), or with a gap no
 * scheduled run fills (prices, courses, types, venue). A missing series or edition
 * is mentioned only beside one of those. A race whose page is pending Tuesday's
 * paid read isn't listed for prices, courses or types: the read comes first. Stale
 * first (oldest check first), then by race day.
 */
export function needsYou(input: Pick<DigestInput, "index" | "races" | "freshness" | "checks" | "config" | "now">): NeedsYou[] {
  const today = vietnamDate(input.now);
  const scheduledRead = new Set<string>();
  for (const page of pendingPages(input.index, input.checks, input.config, input.now)) {
    if (!page.trusted) continue;
    for (const entry of input.index) if (entry.sourceUrls.includes(page.url)) scheduledRead.add(entry.id);
  }
  const out: NeedsYou[] = [];
  for (const entry of input.index) {
    if (today > (entry.endDate ?? entry.date)) continue;
    const f = input.freshness[entry.id];
    const stale = f ? freshnessStatus(recomputeFinal(entry, f, today), input.now) === "stale" : false;
    const race = input.races.get(entry.id);
    const gaps = race ? raceChecklist(race, today).items.filter((i) => i.status === "gap").map((i) => i.field) : [];
    const primary = SESSION_GAPS.filter((g) => gaps.includes(g) && !(scheduledRead.has(entry.id) && (READ_FILLS as readonly string[]).includes(g)));
    if (!stale && primary.length === 0) continue;
    const reasons: string[] = [];
    if (stale) reasons.push(`stale since ${f?.lastCheckedAt ? f.lastCheckedAt.slice(0, 10) : "never checked"}`);
    for (const g of primary) reasons.push(`no ${g}`);
    for (const g of SECONDARY_GAPS) if (gaps.includes(g)) reasons.push(`no ${g}`);
    out.push({ id: entry.id, name: entry.name, date: entry.date, reasons, staleSince: stale ? (f?.lastCheckedAt ?? "") : null });
  }
  return out.sort((a, b) => {
    if ((a.staleSince === null) !== (b.staleSince === null)) return a.staleSince === null ? 1 : -1;
    if (a.staleSince !== null && b.staleSince !== null && a.staleSince !== b.staleSince) return a.staleSince.localeCompare(b.staleSince);
    return a.date.localeCompare(b.date) || a.name.localeCompare(b.name);
  });
}

export function formatCredits(credits: Credits, config: SitesConfig, now: Date): string {
  const spent = credits[monthKey(now)] ?? 0;
  const cap = config.scheduledMonthlyCredits;
  return cap === undefined ? `Credits this month: ${spent} of ${config.monthlyCredits} cap` : `Credits this month: ${spent} of ${cap} scheduled (${config.monthlyCredits} cap)`;
}

/** The whole message, never over Discord's limit: "needs you" bullets are dropped from the end first. */
export function buildDigest(input: DigestInput): string {
  const day = vietnamDate(input.now);
  const head = [
    `**OpenRace data digest** (${day})`,
    `Freshness: ${formatFreshnessShare(freshnessShare(input.index, input.freshness, input.now))}`,
    formatPending(pendingPages(input.index, input.checks, input.config, input.now)),
  ];
  const tail = formatCredits(input.credits, input.config, input.now);
  const people = needsYou(input);
  if (people.length === 0) return [...head, "Needs you: nothing", tail].join("\n");

  const bullets = people.map((r) => `• ${r.name} · ${r.reasons.join(", ")}`);
  const fixed = [...head, `Needs you: ${people.length} race${people.length === 1 ? "" : "s"}`].join("\n");
  let shown = 0;
  let body = "";
  for (; shown < Math.min(bullets.length, MAX_LISTED); shown++) {
    const next = `${body}\n${bullets[shown]}`;
    // Room for the "…and N more" line and the credits line after this bullet.
    if (fixed.length + next.length + 40 + tail.length > DISCORD_LIMIT) break;
    body = next;
  }
  const more = people.length - shown;
  return [fixed + body, ...(more > 0 ? [`…and ${more} more`] : []), tail].join("\n");
}

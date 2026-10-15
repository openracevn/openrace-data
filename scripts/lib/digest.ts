/**
 * The Monday data digest (plans 026, 027): what needs attention, as one Discord
 * message. Pure functions over the committed files, so notify-stale.ts and
 * notify-weekly.ts only load and post, and the rules are tested.
 *
 * - Freshness share of the races that aren't final. `final` is recomputed from the
 *   index's dates at read time: state/freshness.json is only rewritten on a commit,
 *   so between commits it still calls a race that took place yesterday "stale".
 * - The to-do list (state/todo.json) Schedule 2 reads every morning, and the pages
 *   it couldn't read after MAX_FAILURES tries: those need a person.
 * - Races that need a person: stale, or missing prices, courses, types or a venue.
 * - Firecrawl credits spent this week and this month against the scheduled cap.
 */
import { freshnessStatus, type FreshnessEntry, type FreshnessStatus } from "./freshness.ts";
import { raceChecklist } from "./race-gaps.ts";
import type { IndexEntry, Race } from "./schema.ts";
import { hostOf, siteForUrl, type SitesConfig } from "./sites.ts";
import { monthKey, vietnamDate, weekCredits, type Credits } from "./state.ts";
import { MAX_FAILURES, type Todo, type TodoEntry } from "./todo.ts";

export const DISCORD_LIMIT = 2000;
const MAX_LISTED = 15;
/** A page plus one image, 5 credits each: the usual cost of reading one race page (0 when unchanged and cached). */
const CREDITS_PER_TODO_PAGE = 10;
/** Gaps that make a race worth a session on their own. */
const SESSION_GAPS = ["prices", "courses", "types", "venue"] as const;
/** Gaps only mentioned alongside one of the above (a one-off race rightly has no series). */
const SECONDARY_GAPS = ["series", "edition"] as const;

export type DigestInput = {
  index: IndexEntry[];
  /** Race files by id; a race missing here only gets its freshness counted. */
  races: Map<string, Race>;
  freshness: Record<string, FreshnessEntry>;
  todo: Todo;
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

/** The list Schedule 2 reads next, by reason. */
export function formatTodo(todo: Todo): string {
  const n = todo.entries.length;
  if (n === 0) return "To-do list: empty";
  const by = (r: TodoEntry["reason"]) => todo.entries.filter((e) => e.reason === r).length;
  const parts = [`${by("new")} new`, `${by("changed")} changed`, `${by("weekly")} weekly`];
  return `To-do list: ${n} page${n === 1 ? "" : "s"} (${parts.join(", ")}), at most about ${n * CREDITS_PER_TODO_PAGE} credits`;
}

export type Unresolved = { url: string; name: string; host: string; failures: number; error: string };

/** Pages Schedule 2 failed to read MAX_FAILURES times or more: a person's job. */
export function unresolved(todo: Todo, index: IndexEntry[]): Unresolved[] {
  return todo.entries
    .filter((e) => (e.failures ?? 0) >= MAX_FAILURES)
    .map((e) => {
      const entry = index.find((x) => x.id === e.raceId || x.sourceUrls.includes(e.url));
      return { url: e.url, name: entry?.name ?? e.url, host: hostOf(e.url), failures: e.failures!, error: e.lastError ?? "" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function formatUnresolved(pages: Unresolved[]): string {
  if (pages.length === 0) return "Schedule 2 couldn't read: nothing";
  const shown = pages.slice(0, 5).map((p) => `• ${p.name} on ${p.host} (${p.failures}×: ${p.error.slice(0, 80)})`);
  return [`Schedule 2 couldn't read: ${pages.length} page${pages.length === 1 ? "" : "s"}`, ...shown, ...(pages.length > 5 ? [`…and ${pages.length - 5} more`] : [])].join("\n");
}

export type NeedsYou = { id: string; name: string; date: string; reasons: string[]; staleSince: string | null };

/** Gaps a full read of the page usually fills; not a person's job while the page is on the to-do list. */
const READ_FILLS = ["prices", "courses", "types"] as const;

/**
 * Races a person should look at: stale (not checked in time), or with a gap no
 * scheduled run fills (prices, courses, types, venue). A missing series or edition
 * is mentioned only beside one of those. A race with a page on the to-do list (and
 * not given up on) isn't listed for prices, courses or types: the read comes first.
 * Stale first (oldest check first), then by race day.
 */
export function needsYou(input: Pick<DigestInput, "index" | "races" | "freshness" | "todo" | "now">): NeedsYou[] {
  const today = vietnamDate(input.now);
  const scheduledRead = new Set<string>();
  for (const page of input.todo.entries) {
    if ((page.failures ?? 0) >= MAX_FAILURES) continue;
    for (const entry of input.index) if (entry.id === page.raceId || entry.sourceUrls.includes(page.url)) scheduledRead.add(entry.id);
  }
  const out: NeedsYou[] = [];
  for (const entry of input.index) {
    if (today > (entry.endDate ?? entry.date)) continue;
    const f = input.freshness[entry.id];
    const stale = f ? freshnessStatus(recomputeFinal(entry, f, today), input.now) === "stale" : false;
    const race = input.races.get(entry.id);
    const gapItems = race ? raceChecklist(race, today).items.filter((i) => i.status === "gap") : [];
    const gaps = gapItems.map((i) => i.field);
    // A race with prices for some distances says which ones lack one (Cà Mau 2026: 16
    // tiers, none for the 2km), not "no prices".
    const reasonFor = (g: string) => {
      const partial = g === "prices" ? gapItems.find((i) => i.field === "prices" && i.note.startsWith("no tier for "))?.note : undefined;
      return partial ? partial.replace("no tier for ", "no price for ") : `no ${g}`;
    };
    const primary = SESSION_GAPS.filter((g) => gaps.includes(g) && !(scheduledRead.has(entry.id) && (READ_FILLS as readonly string[]).includes(g)));
    if (!stale && primary.length === 0) continue;
    const reasons: string[] = [];
    if (stale) reasons.push(`stale since ${f?.lastCheckedAt ? f.lastCheckedAt.slice(0, 10) : "never checked"}`);
    for (const g of primary) reasons.push(reasonFor(g));
    for (const g of SECONDARY_GAPS) if (gaps.includes(g)) reasons.push(reasonFor(g));
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
  const week = weekCredits(credits, now);
  const cap = config.scheduledMonthlyCredits;
  const month = cap === undefined ? `${spent} of ${config.monthlyCredits} cap` : `${spent} of ${cap} scheduled (${config.monthlyCredits} cap)`;
  return `Credits: ${week} this week · this month ${month}`;
}

/** The whole message, never over Discord's limit: "needs you" bullets are dropped from the end first. */
export function buildDigest(input: DigestInput): string {
  const day = vietnamDate(input.now);
  const head = [
    `**OpenRace data digest** (${day})`,
    `Freshness: ${formatFreshnessShare(freshnessShare(input.index, input.freshness, input.now))}`,
    formatTodo(input.todo),
    formatUnresolved(unresolved(input.todo, input.index)),
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

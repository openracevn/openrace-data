/**
 * The to-do list between the two daily schedules (plan 027), state/todo.json.
 *
 * Schedule 1 (check.ts --discover, free) lists the sites and snapshots their pages,
 * and adds a page here when it is new (never read in full) or changed (fingerprint
 * changed on the free snapshot); on Monday it also adds every source page of every
 * upcoming race (`weekly`). Schedule 2 (check.ts --todo, paid) reads each page with
 * Firecrawl and removes it once read; a page that fails stays with a `failures` count,
 * and after MAX_FAILURES the digest lists it for a person.
 */
import { z } from "zod";
import { serialize, type IndexEntry } from "./schema.ts";
import { siteForUrl, type SitesConfig } from "./sites.ts";

export const TODO_PATH = "state/todo.json";
/** Failed reads after which a page goes to the digest (it stays on the list). */
export const MAX_FAILURES = 3;

export const TODO_REASONS = ["new", "changed", "weekly"] as const;
export type TodoReason = (typeof TODO_REASONS)[number];

export const TodoEntrySchema = z.object({
  url: z.url(),
  raceId: z.string().optional(),
  reason: z.enum(TODO_REASONS),
  addedAt: z.iso.datetime(),
  failures: z.number().int().positive().optional(),
  lastError: z.string().optional(),
});
export const TodoSchema = z.object({
  /** When Schedule 1 last went through every due site; it runs once a day. */
  discoveredAt: z.iso.datetime().nullable().default(null),
  /** When Schedule 2 last went through the list. */
  readAt: z.iso.datetime().nullable().default(null),
  entries: z.array(TodoEntrySchema).default([]),
});

export type TodoEntry = z.infer<typeof TodoEntrySchema>;
export type Todo = z.infer<typeof TodoSchema>;

export const emptyTodo = (): Todo => ({ discoveredAt: null, readAt: null, entries: [] });
export const parseTodo = (text: string | null): Todo => (text ? TodoSchema.parse(JSON.parse(text)) : emptyTodo());

/** Stable output: entries by URL. */
export function serializeTodo(todo: Todo): string {
  return serialize({ ...todo, entries: [...todo.entries].sort((a, b) => a.url.localeCompare(b.url)) });
}

/** Why a page is read matters for the digest only: new beats changed beats weekly. */
const RANK: Record<TodoReason, number> = { new: 0, changed: 1, weekly: 2 };

/** Adds a page, or keeps the one already there (its addedAt and failures) with the stronger reason. */
export function addTodo(todo: Todo, entry: Omit<TodoEntry, "failures" | "lastError">): void {
  const prev = todo.entries.find((e) => e.url === entry.url);
  if (!prev) {
    todo.entries.push({ ...entry });
    return;
  }
  if (RANK[entry.reason] < RANK[prev.reason]) prev.reason = entry.reason;
  prev.raceId ??= entry.raceId;
}

export function removeTodo(todo: Todo, url: string): void {
  todo.entries = todo.entries.filter((e) => e.url !== url);
}

export function failTodo(todo: Todo, url: string, error: string): void {
  const entry = todo.entries.find((e) => e.url === url);
  if (!entry) return;
  entry.failures = (entry.failures ?? 0) + 1;
  entry.lastError = error.slice(0, 300);
}

/** The race's last day has passed: never checked again. */
export const isPast = (entry: Pick<IndexEntry, "date" | "endDate">, today: string): boolean => today > (entry.endDate ?? entry.date);

/** Monday's weekly pass: every source page, on a site with a recipe, of every race still to come. */
export function weeklyPages(index: IndexEntry[], config: SitesConfig, today: string): { url: string; raceId: string }[] {
  const out: { url: string; raceId: string }[] = [];
  for (const entry of index) {
    if (isPast(entry, today)) continue;
    for (const url of entry.sourceUrls) {
      const site = siteForUrl(config, url);
      if (site && site.recipe !== "none") out.push({ url, raceId: entry.id });
    }
  }
  return out;
}

/** ISO weekday (Monday = 1) and ISO week number of a YYYY-MM-DD date. */
export function isoWeek(day: string): { weekday: number; week: number } {
  const d = new Date(`${day}T00:00:00Z`);
  const weekday = d.getUTCDay() || 7;
  const thursday = new Date(d.getTime() + (4 - weekday) * 86_400_000);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return { weekday, week: Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7) };
}

export const isMonday = (day: string): boolean => isoWeek(day).weekday === 1;

/**
 * Which sites Schedule 1 lists today: sellers every day, hubs and race sites (which
 * change rarely) on Monday of even ISO weeks. Only sites with a recipe.
 */
export function discoverySites(config: SitesConfig, today: string): SitesConfig["sites"] {
  const { weekday, week } = isoWeek(today);
  const fortnightly = weekday === 1 && week % 2 === 0;
  return config.sites.filter((s) => s.recipe !== "none" && (s.kind === "seller" || fortnightly));
}

/**
 * Schedule 2 runs once a day, after Schedule 1: it skips when it already went
 * through the list today, after the latest discovery.
 */
export function readDoneToday(todo: Todo, today: string, dayOf: (iso: string) => string): boolean {
  if (!todo.readAt || dayOf(todo.readAt) !== today) return false;
  return !todo.discoveredAt || todo.discoveredAt <= todo.readAt;
}

/**
 * Possible duplicate races (plan 029): two races within a day of each other, not known
 * to be in different provinces, with similar names. Sync only compares pages from
 * different sites, once, when a race is added, and its near-miss warning only reaches the
 * commit message, so validate fails on every such pair until a person decides: merge it
 * (npm run edit -- merge <keep> <drop>) or list it in config/not-duplicates.yaml with
 * the reason the races differ.
 *
 * Name, day and place alone can't decide it: IRONKIDS and SUNRISE SPRINT run in the same
 * city on the same day for the same organizer, and their names score 0.6, the same as
 * the "Galaxy Run 2" / "Samsung Galaxy Run" pair that was one race.
 */
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { nameSimilarity } from "./text.ts";

export const NOT_DUPLICATES_PATH = "config/not-duplicates.yaml";
/** Same as sync's near-miss warning (plan 010). */
export const DUPLICATE_NAME_SCORE = 0.4;
const DAY_MS = 86_400_000;

export const NotDuplicatesSchema = z.array(
  z.strictObject({
    races: z.tuple([z.string().min(1), z.string().min(1)]),
    reason: z.string().min(1),
  }),
);
export type NotDuplicates = z.infer<typeof NotDuplicatesSchema>;

export type DuplicateCandidate = { slug: string; name: string; date: string; province: string | null };
export type DuplicatePair = { a: DuplicateCandidate; b: DuplicateCandidate; score: number };

export function parseNotDuplicates(text: string): NotDuplicates {
  return NotDuplicatesSchema.parse(parse(text) ?? []);
}

export function loadNotDuplicates(path = NOT_DUPLICATES_PATH): NotDuplicates {
  return existsSync(path) ? parseNotDuplicates(readFileSync(path, "utf8")) : [];
}

const pairKey = (x: string, y: string) => (x < y ? `${x}\n${y}` : `${y}\n${x}`);

/** Unreviewed pairs, highest name score first. Entries naming a slug that no longer exists are simply never hit. */
export function possibleDuplicates(races: readonly DuplicateCandidate[], reviewed: NotDuplicates = []): DuplicatePair[] {
  const skip = new Set(reviewed.map((r) => pairKey(r.races[0], r.races[1])));
  const sorted = [...races].sort((x, y) => x.date.localeCompare(y.date));
  const out: DuplicatePair[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (Date.parse(b.date) - Date.parse(a.date) > DAY_MS) break;
      if (a.province && b.province && a.province !== b.province) continue;
      if (skip.has(pairKey(a.slug, b.slug))) continue;
      const score = nameSimilarity(a.name, b.name);
      if (score >= DUPLICATE_NAME_SCORE) out.push({ a, b, score });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

export function formatDuplicate(p: DuplicatePair): string {
  return `possible duplicate races: ${p.a.slug} ~ ${p.b.slug} (${p.a.date}${p.b.date === p.a.date ? "" : ` / ${p.b.date}`}, name ${p.score.toFixed(2)}): merge with npm run edit -- merge <keep> <drop>, or list the pair in ${NOT_DUPLICATES_PATH} with the reason they differ`;
}

/**
 * Series found from the races themselves: editions of one event share a slug once
 * the year is taken out (dalat-ultra-trail-2024, -2025, -2026 → dalat-ultra-trail).
 * Only for races whose site names no series; a site's own series always wins.
 *
 * Misses renamed events ("Chạy Vì Trái Tim" → "Run for the Heart"); link those by
 * hand with an override on seriesId. Two races in the same year only are not a
 * series (two different events that happen to share a name).
 */
import type { EntityRef } from "./reconcile.ts";

/** The slug without its years and without a "-2" style duplicate suffix. */
export function seriesKey(slug: string): string {
  return slug
    .replace(/(^|-)(19|20)\d{2}(?=-|$)/g, "")
    .replace(/-\d{1,2}$/, "")
    .replace(/^-+|-+$/g, "");
}

// Too short to identify an event on its own ("run", "trail").
const MIN_KEY_LENGTH = 8;

export type SeriesCandidate = { id: string; slug: string; name: string; date: string };

/** Race id → its inferred series, for races in a group spanning at least two years. */
export function inferSeries(races: readonly SeriesCandidate[]): Map<string, EntityRef> {
  const groups = new Map<string, SeriesCandidate[]>();
  for (const race of races) {
    const key = seriesKey(race.slug);
    if (key.length < MIN_KEY_LENGTH) continue;
    groups.set(key, [...(groups.get(key) ?? []), race]);
  }
  const out = new Map<string, EntityRef>();
  for (const [key, group] of groups) {
    if (new Set(group.map((r) => r.date.slice(0, 4))).size < 2) continue;
    // Named after the latest edition, without its year.
    const latest = [...group].sort((a, b) => b.date.localeCompare(a.date))[0]!;
    const name = seriesName(latest.name);
    for (const race of group) out.set(race.id, { id: key, name });
  }
  return out;
}

/** An edition's name without what changes each year: "Giải ... lần thứ 67 năm 2025" → "Giải ...". */
export function seriesName(editionName: string): string {
  const name = editionName
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\s*(lần thứ|mùa thứ|lần|mùa|season|edition)\s*\d+\s*/giu, " ")
    .replace(/\s+năm\s*$/iu, "")
    .replace(/\s*[-–—|:,]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return name || editionName;
}

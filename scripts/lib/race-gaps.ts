/**
 * Per-race and per-series gap checklists (plan 019): what is still missing on a race,
 * so `update-race` knows what is left to find and when it is done. Pure functions over
 * parsed data; scripts/race-gaps.ts reads the files and prints.
 */
import type { Race, Series } from "./schema.ts";

export type GapItem = { field: string; status: "ok" | "gap" | "info"; note: string };
export type RaceChecklist = { slug: string; date: string; items: GapItem[] };
export type SeriesChecklist = {
  seriesId: string;
  name: string;
  statedEditionCount: number | null;
  editions: { slug: string; date: string; edition: number | null }[];
  /** Years with no edition between the earliest and latest on record. */
  missingYears: number[];
  /** Edition numbers below the highest stated one with no race on record. */
  missingEditionNumbers: number[];
  /** statedEditionCount minus the editions on record, when positive. */
  missingByCount: number;
  notes: string[];
};

const ok = (field: string, note = ""): GapItem => ({ field, status: "ok", note });
const gap = (field: string, note: string): GapItem => ({ field, status: "gap", note });
const info = (field: string, note: string): GapItem => ({ field, status: "info", note });

/** `today` is an ISO date; past races need a participant count, upcoming ones a registration link. */
export function raceChecklist(r: Race, today: string): RaceChecklist {
  const past = (r.endDate ?? r.date) < today;
  const items: GapItem[] = [];

  items.push(ok("date", r.endDate ? `${r.date}..${r.endDate}${r.mainDate ? ` (main ${r.mainDate})` : ""}` : r.date));
  items.push(r.location.venue ? ok("venue", r.location.venue) : gap("venue", "no venue"));
  items.push(r.location.city ? ok("city", r.location.city) : gap("city", "no city"));
  items.push(r.geo ? ok("geo") : gap("geo", "no location point"));
  items.push(r.organizerId ? ok("organizer", r.organizerId) : gap("organizer", "no organizerId"));
  items.push(r.courses.length > 0 ? ok("courses", r.courses.map((c) => c.label).join(", ")) : gap("courses", "no courses"));
  const noMeters = r.courses.filter((c) => c.meters === null).map((c) => c.label);
  if (noMeters.length) items.push(info("course meters", `unknown for ${noMeters.join(", ")}`));
  items.push(r.types.length > 0 ? ok("types", r.types.join(", ")) : gap("types", "no types"));
  if (r.prices.length > 0) {
    const priced = new Set(r.prices.map((p) => p.distance?.toLowerCase()));
    const unpriced = r.courses.filter((c) => !priced.has(c.label.toLowerCase())).map((c) => c.label);
    items.push(ok("prices", `${r.prices.length} tiers`));
    if (unpriced.length && !past) items.push(gap("prices", `no tier for ${unpriced.join(", ")}`));
  } else {
    items.push(past ? info("prices", "none (past; may be free or unpriced)") : gap("prices", "none for an upcoming race"));
  }
  items.push(r.edition !== null ? ok("edition", String(r.edition)) : gap("edition", "edition number unknown"));
  items.push(r.seriesId ? ok("series", r.seriesId) : gap("series", "no seriesId"));
  if (past) {
    if (!r.participants) items.push(gap("participants", "past race, no count"));
    else if (r.participants.confidence === "low") items.push(gap("participants", `low confidence (${r.participants.count}); needs a quoted source`));
    else items.push(ok("participants", `${r.participants.count} (${r.participants.confidence})`));
  }
  if (!past) {
    const open = r.registrations.length > 0 || r.links.some((l) => l.kind === "seller");
    items.push(open ? ok("registration link") : gap("registration link", "no registration or seller link"));
  }
  if (r.flags.length > 0) items.push(gap("flags", r.flags.join("; ")));
  if (r.confidence === "conflicting") items.push(gap("confidence", "sources conflict"));

  return { slug: r.slug, date: r.date, items };
}

export function seriesChecklist(series: Pick<Series, "id" | "name" | "statedEditionCount">, races: readonly Race[]): SeriesChecklist {
  const editions = races
    .filter((r) => r.seriesId === series.id)
    .map((r) => ({ slug: r.slug, date: r.date, edition: r.edition }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const years = editions.map((e) => Number(e.date.slice(0, 4)));
  const yearSet = new Set(years);
  const missingYears: number[] = [];
  if (years.length >= 2) for (let y = Math.min(...years); y <= Math.max(...years); y++) if (!yearSet.has(y)) missingYears.push(y);

  const numbers = new Set(editions.map((e) => e.edition).filter((n): n is number => n !== null));
  const top = numbers.size ? Math.max(...numbers) : 0;
  const missingEditionNumbers: number[] = [];
  for (let n = 1; n < top; n++) if (!numbers.has(n)) missingEditionNumbers.push(n);

  const stated = series.statedEditionCount ?? null;
  const missingByCount = stated !== null && stated > editions.length ? stated - editions.length : 0;

  const notes: string[] = [];
  if (stated === null) notes.push("statedEditionCount is unknown: find the organizer's own edition count and record it on the series");
  if (editions.some((e) => e.edition === null)) notes.push(`${editions.filter((e) => e.edition === null).length} edition(s) have no edition number`);

  return { seriesId: series.id, name: series.name, statedEditionCount: stated, editions, missingYears, missingEditionNumbers, missingByCount, notes };
}

export function formatRaceChecklist(c: RaceChecklist): string {
  const mark = { ok: "✓", gap: "✗", info: "·" } as const;
  const gaps = c.items.filter((i) => i.status === "gap").length;
  return [`${c.slug} (${c.date}): ${gaps === 0 ? "no gaps" : `${gaps} gap(s)`}`, ...c.items.map((i) => `  ${mark[i.status]} ${i.field}${i.note ? `: ${i.note}` : ""}`)].join("\n");
}

export function formatSeriesChecklist(c: SeriesChecklist): string {
  const lines = [
    `${c.name} (${c.seriesId}): ${c.editions.length} edition(s) on record, organizer states ${c.statedEditionCount ?? "unknown"}`,
    ...c.editions.map((e) => `  - ${e.date}  ${e.slug}${e.edition !== null ? `  (edition ${e.edition})` : ""}`),
  ];
  if (c.missingYears.length) lines.push(`  ✗ no edition on record for: ${c.missingYears.join(", ")} (held? cancelled? find out)`);
  if (c.missingEditionNumbers.length) lines.push(`  ✗ edition numbers with no race: ${c.missingEditionNumbers.join(", ")}`);
  if (c.missingByCount > 0) lines.push(`  ✗ ${c.missingByCount} edition(s) short of the stated count`);
  for (const n of c.notes) lines.push(`  · ${n}`);
  return lines.join("\n");
}

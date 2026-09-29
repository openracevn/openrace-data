/**
 * How complete the data is, as two numbers (plan 023). Pure and import-free on purpose:
 * this file is copied byte-identical into openrace-api (src/lib/completeness-core.ts),
 * and both repos run test/fixtures/completeness-cases.json against it. Change a rule here,
 * copy the file there and update the fixture in the same pass.
 *
 * - score (depth): of the items we expect for the races we have, the share that are ok.
 * - editionCoverage: editions on record ÷ editions known to exist, across series.
 * Neither can see a race nobody has found yet.
 */

/** The facts a rule reads, in a shape both repos can build (a race file or a D1 row). */
export type ScoreInput = {
  date: string;
  endDate: string | null;
  seriesId: string | null;
  edition: number | null;
  venue: string | null;
  city: string | null;
  /** Current province code from geo; null when there is no usable point. */
  geoProvince: string | null;
  organizerId: string | null;
  courseLabels: string[];
  types: string[];
  /** One entry per price tier: its distance label, or null when the tier names none. */
  priceDistances: (string | null)[];
  /** Has a registration or a seller link. */
  hasRegistration: boolean;
  participantsConfidence: "high" | "medium" | "low" | null;
  flagCount: number;
  conflicting: boolean;
};

export type SeriesInput = { id: string; statedEditionCount: number | null };

export type ScoredField = "place" | "geo" | "organizer" | "courses" | "types" | "edition" | "prices" | "registration" | "participants";
export const SCORED_FIELDS: readonly ScoredField[] = ["place", "geo", "organizer", "courses", "types", "edition", "prices", "registration", "participants"];

export type FieldScore = { field: ScoredField; ok: number; total: number };
export type Completeness = {
  /** 0–100, rounded. */
  score: number;
  ok: number;
  total: number;
  /** Worst first; fields that apply to no race are left out. */
  byField: FieldScore[];
  editionCoverage: { score: number; onRecord: number; known: number; series: number };
  /** Races with flags or conflicting sources: reported beside the score, not in it. */
  openIssues: number;
  races: number;
};

/** A race is past once its last day is before `today` (a Vietnam ISO date). */
export function isPast(r: Pick<ScoreInput, "date" | "endDate">, today: string): boolean {
  return (r.endDate ?? r.date) < today;
}

/** The items scored for one race. A field missing from the result doesn't apply to it. */
export function scoreItems(r: ScoreInput, today: string): Partial<Record<ScoredField, boolean>> {
  const past = isPast(r, today);
  const items: Partial<Record<ScoredField, boolean>> = {
    place: Boolean(r.venue || r.city),
    geo: r.geoProvince !== null,
    organizer: r.organizerId !== null,
    courses: r.courseLabels.length > 0,
    types: r.types.length > 0,
  };
  if (r.seriesId) items.edition = r.edition !== null;
  if (past) {
    items.participants = r.participantsConfidence === "high" || r.participantsConfidence === "medium";
  } else {
    items.prices = pricesComplete(r);
    items.registration = r.hasRegistration;
  }
  return items;
}

/** Tiers exist and every course has one (a tier with no distance covers a one-course race). */
function pricesComplete(r: ScoreInput): boolean {
  if (r.priceDistances.length === 0) return false;
  const priced = new Set(r.priceDistances.map((d) => (d === null ? null : d.toLowerCase())));
  if (r.courseLabels.length === 1 && priced.has(null)) return true;
  return r.courseLabels.every((c) => priced.has(c.toLowerCase()));
}

export function completeness(races: readonly ScoreInput[], series: readonly SeriesInput[], today: string): Completeness {
  const fields = new Map<ScoredField, FieldScore>();
  for (const r of races) {
    for (const [field, ok] of Object.entries(scoreItems(r, today)) as [ScoredField, boolean][]) {
      const f = fields.get(field) ?? { field, ok: 0, total: 0 };
      f.total++;
      if (ok) f.ok++;
      fields.set(field, f);
    }
  }
  const byField = SCORED_FIELDS.flatMap((f) => (fields.has(f) ? [fields.get(f)!] : [])).sort(
    (a, b) => a.ok / a.total - b.ok / b.total || b.total - a.total || a.field.localeCompare(b.field),
  );
  const ok = byField.reduce((n, f) => n + f.ok, 0);
  const total = byField.reduce((n, f) => n + f.total, 0);
  return {
    score: percent(ok, total),
    ok,
    total,
    byField,
    editionCoverage: editionCoverage(races, series),
    openIssues: races.filter((r) => r.flagCount > 0 || r.conflicting).length,
    races: races.length,
  };
}

/**
 * Known editions per series = the largest of: on record, the organizer's stated count,
 * on record + missing years between the first and last, on record + missing edition
 * numbers below the highest. Series with no races on record are left out.
 */
function editionCoverage(races: readonly ScoreInput[], series: readonly SeriesInput[]): Completeness["editionCoverage"] {
  let onRecord = 0;
  let known = 0;
  let counted = 0;
  for (const s of series) {
    const editions = races.filter((r) => r.seriesId === s.id);
    if (editions.length === 0) continue;
    const years = new Set(editions.map((r) => Number(r.date.slice(0, 4))));
    const span = Math.max(...years) - Math.min(...years) + 1;
    const numbers = new Set(editions.map((r) => r.edition).filter((n): n is number => n !== null));
    const top = numbers.size ? Math.max(...numbers) : 0;
    const missingNumbers = Math.max(0, top - numbers.size);
    const n = editions.length;
    onRecord += n;
    known += Math.max(n, s.statedEditionCount ?? 0, n + (span - years.size), n + missingNumbers);
    counted++;
  }
  return { score: percent(onRecord, known), onRecord, known, series: counted };
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 100 : Math.round((part / whole) * 100);
}

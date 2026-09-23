import { normalizeExtracted } from "./extraction.ts";
import { CANONICAL_FIELDS, type CanonicalRace, type Race, type RaceSource, type SourceName } from "./schema.ts";

// Highest priority first. ActiUp is the primary source for every field; bibchung
// fills what ActiUp leaves empty (distances, price range) and is the only source
// of the group price.
export const SOURCE_PRIORITY: readonly SourceName[] = ["actiup", "bibchung"];

export type Reconciled = { fields: CanonicalRace; confidence: Race["confidence"] };

/**
 * Derive canonical race fields from all of a race's sources: each field comes
 * from the highest-priority source that has a value for it.
 *
 * confidence: single-sourced (one usable source), multi-sourced (several, and
 * they agree on race day), conflicting (they disagree on race day).
 */
export function reconcile(sources: readonly RaceSource[]): Reconciled | { error: string } {
  const ranked = [...sources].sort((a, b) => SOURCE_PRIORITY.indexOf(a.name) - SOURCE_PRIORITY.indexOf(b.name));
  const usable: CanonicalRace[] = [];
  const reasons: string[] = [];
  for (const source of ranked) {
    const result = normalizeExtracted(source.rawExtracted);
    if (result.ok) usable.push(result.race);
    else reasons.push(`${source.name}: ${result.reason}`);
  }
  const [primary, ...rest] = usable;
  if (!primary) return { error: reasons.join("; ") || "no sources" };

  const fields: CanonicalRace = { ...primary };
  for (const field of CANONICAL_FIELDS) {
    if (!isEmpty(field, fields[field])) continue;
    const fill = rest.find((r) => !isEmpty(field, r[field]));
    if (fill) (fields as Record<string, unknown>)[field] = fill[field];
  }
  if (fields.priceMin !== null && fields.priceMax !== null && fields.priceMin > fields.priceMax) fields.priceMax = null;

  const confidence: Race["confidence"] =
    usable.length === 1 ? "single-sourced" : usable.every((r) => r.date === primary.date) ? "multi-sourced" : "conflicting";
  return { fields, confidence };
}

function isEmpty(field: string, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0 || (field === "types" && value.join() === "other");
  if (field === "location") {
    const loc = value as CanonicalRace["location"];
    return loc.city === null && loc.venue === null;
  }
  return false;
}

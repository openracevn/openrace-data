import { normalizeExtracted } from "./extraction.ts";
import type { CanonicalRace, Race, RaceSource, SourceName } from "./schema.ts";

// Highest priority first. With one source this is trivially "use ActiUp"; when a
// second source lands, per-field agreement/conflict logic replaces `reconcile`.
const SOURCE_PRIORITY: readonly SourceName[] = ["actiup"];

export type Reconciled = { fields: CanonicalRace; confidence: Race["confidence"] };

/** Derive canonical race fields from all of a race's sources. */
export function reconcile(sources: readonly RaceSource[]): Reconciled | { error: string } {
  const ranked = [...sources].sort(
    (a, b) => SOURCE_PRIORITY.indexOf(a.name) - SOURCE_PRIORITY.indexOf(b.name),
  );
  const reasons: string[] = [];
  for (const source of ranked) {
    const result = normalizeExtracted(source.rawExtracted);
    if (result.ok) return { fields: result.race, confidence: "single-sourced" };
    reasons.push(`${source.name}: ${result.reason}`);
  }
  return { error: reasons.join("; ") || "no sources" };
}

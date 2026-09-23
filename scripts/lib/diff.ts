import { foldVietnamese } from "./places.ts";
import { CANONICAL_FIELDS, type CanonicalField, type CanonicalRace } from "./schema.ts";

/** Canonical fields whose values differ between two versions of a race. */
export function changedFields(before: Partial<CanonicalRace>, after: Partial<CanonicalRace>): CanonicalField[] {
  return CANONICAL_FIELDS.filter((f) => !deepEqual(before[f], after[f]));
}

/**
 * The model rewords free text between checks ("Quảng trường Lâm Viên và khu vực Hồ
 * Xuân Hương" vs "Quảng trường Lâm Viên, bên Hồ Xuân Hương"). Keep the previous
 * venue/organizer when the new one shares most of its words, so rewording alone
 * isn't a change.
 */
export function stabilize(before: CanonicalRace, after: CanonicalRace): CanonicalRace {
  const venue = sameText(before.location.venue, after.location.venue) ? before.location.venue : after.location.venue;
  const organizer = sameText(before.organizer, after.organizer) ? before.organizer : after.organizer;
  return { ...after, location: { ...after.location, venue }, organizer };
}

function sameText(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const wa = new Set(foldVietnamese(a).split(" ").filter(Boolean));
  const wb = new Set(foldVietnamese(b).split(" ").filter(Boolean));
  const shared = [...wa].filter((w) => wb.has(w)).length;
  // Mostly the same words, or one is the other plus an address ("Vinhomes Grand Park"
  // vs "Vinhomes Grand Park, Tp Thủ Đức, Tp Hồ Chí Minh").
  return shared / Math.max(wa.size, wb.size, 1) >= 0.6 || shared / Math.max(Math.min(wa.size, wb.size), 1) >= 0.8;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

import { CANONICAL_FIELDS, type CanonicalField, type CanonicalRace } from "./schema.ts";

/** Canonical fields whose values differ between two versions of a race. */
export function changedFields(before: Partial<CanonicalRace>, after: Partial<CanonicalRace>): CanonicalField[] {
  return CANONICAL_FIELDS.filter((f) => !deepEqual(before[f], after[f]));
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

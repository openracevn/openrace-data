import { foldVietnamese } from "./places.ts";

/** A slug from a race name, for races without a source slug (openrace): "Tết Run 2027" → "tet-run-2027". */
export function slugFromName(name: string): string {
  return foldVietnamese(name).replace(/\s+/g, "-").slice(0, 80).replace(/-+$/, "") || "race";
}

/** Normalizes a source URL so the same page always maps to the same key. */
export function canonicalSourceUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  u.hostname = u.hostname.replace(/^www\./, "");
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.toString();
}

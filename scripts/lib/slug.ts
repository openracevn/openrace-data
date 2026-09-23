import { foldVietnamese } from "./places.ts";

/** "Tây Hồ Half Marathon", "2026-11-15" -> "tay-ho-half-marathon-2026". */
export function raceSlug(name: string, date: string): string {
  const base = foldVietnamese(name).replace(/\s+/g, "-").slice(0, 80).replace(/-+$/, "") || "race";
  const year = date.slice(0, 4);
  return base.split("-").includes(year) ? base : `${base}-${year}`;
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

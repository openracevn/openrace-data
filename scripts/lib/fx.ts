import { existsSync, readFileSync } from "node:fs";

export const FX_CACHE_PATH = "data/fx/rates.json";

/** currency ("USD", "EUR", ...) -> year ("2019") -> VND per one unit of that currency. */
export type FxCache = Record<string, Record<string, number>>;

let cache: FxCache | null = null;

function loadCache(): FxCache {
  if (cache) return cache;
  cache = existsSync(FX_CACHE_PATH) ? (JSON.parse(readFileSync(FX_CACHE_PATH, "utf8")) as FxCache) : {};
  return cache;
}

export type FxLookup = { rate: number; asOf: string };

/**
 * VND per one unit of `currency`, as of `date` (nearest earlier year cached; the World
 * Bank publishes one official rate per year, see scripts/fx-ref.ts). `null` if the
 * cache has nothing for or before that date — never a guess.
 */
export function vndRate(currency: string, date: string): FxLookup | null {
  if (currency === "VND") return null;
  const years = loadCache()[currency];
  if (!years) return null;
  const year = date.slice(0, 4);
  const known = Object.keys(years)
    .filter((y) => y <= year)
    .sort();
  const asOf = known.at(-1);
  if (asOf === undefined) return null;
  return { rate: years[asOf]!, asOf };
}

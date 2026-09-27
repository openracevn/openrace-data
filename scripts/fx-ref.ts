/**
 * Fetch official annual USD/VND and EUR/VND exchange rates from the World Bank
 * (free, no key, no signup; https://api.worldbank.org) and write the committed
 * cache at data/fx/rates.json. Run by hand when a new non-VND currency shows up
 * in a source's facts.currency (see scripts/lib/fx.ts) — never during a normal
 * sync/renormalize run.
 *
 *   npm run fx:ref
 *
 * The World Bank only has one rate per calendar year (period average, LCU per
 * US$), so scripts/lib/fx.ts looks up rates by year, not by month.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MIN_RACE_YEAR } from "./lib/schema.ts";
import type { FxCache } from "./lib/fx.ts";
import { FX_CACHE_PATH } from "./lib/fx.ts";

// World Bank country/aggregate code whose own currency is `<key>`, so its
// PA.NUS.FCRF series ("LCU per US$") gives `<key>` per US$. Add an entry here
// (and re-run) when a source states a currency not yet listed.
const CURRENCY_WB_CODE: Record<string, string> = {
  EUR: "EMU",
};

const INDICATOR = "PA.NUS.FCRF"; // Official exchange rate, LCU per US$, period average
const START_YEAR = MIN_RACE_YEAR;
const END_YEAR = new Date().getUTCFullYear();

type WbObservation = { date: string; value: number | null };

async function fetchAnnualRates(wbCode: string): Promise<Map<string, number>> {
  const url = `https://api.worldbank.org/v2/country/${wbCode}/indicator/${INDICATOR}?format=json&date=${START_YEAR}:${END_YEAR}&per_page=200`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank API ${res.status} for ${wbCode}`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body) || !Array.isArray(body[1])) throw new Error(`unexpected World Bank response for ${wbCode}: ${JSON.stringify(body).slice(0, 200)}`);
  const observations = body[1] as WbObservation[];
  const rates = new Map<string, number>();
  for (const obs of observations) {
    if (obs.value !== null) rates.set(obs.date, obs.value);
  }
  return rates;
}

const vndPerUsd = await fetchAnnualRates("VNM");
const output: FxCache = { USD: Object.fromEntries(vndPerUsd) };

for (const [currency, wbCode] of Object.entries(CURRENCY_WB_CODE)) {
  const otherPerUsd = await fetchAnnualRates(wbCode); // e.g. EUR per USD
  const rates: Record<string, number> = {};
  for (const [year, vnd] of vndPerUsd) {
    const other = otherPerUsd.get(year);
    if (other) rates[year] = vnd / other; // VND per <currency>
  }
  output[currency] = rates;
}
for (const rates of Object.values(output)) {
  for (const [year, rate] of Object.entries(rates)) rates[year] = Math.round(rate * 100) / 100;
}

mkdirSync(dirname(FX_CACHE_PATH), { recursive: true });
writeFileSync(FX_CACHE_PATH, JSON.stringify(output, null, 2) + "\n");
for (const [currency, rates] of Object.entries(output)) {
  console.log(`${currency}: ${Object.keys(rates).length} years cached (${Object.keys(rates)[0]}..${Object.keys(rates).at(-1)})`);
}

# Plan 014: Convert every price to VND at its own historical rate, and flag implausible prices

## Roadmap fit

Serves path step 4, "price trends by year" (`.claude/docs/roadmap.md`), which is
meaningless if some prices are silently left in USD (or any other currency) at
their nominal number — a 2019 race priced in USD and a 2026 race priced in USD
are not comparable at face value, since the VND/USD rate moved between those
dates. It also serves trust principles 1 ("every fact traces to a source"; we
must keep the original figure and the rate used, not just overwrite it) and 3
("honest about uncertainty" — an implausible price becomes a flag, not a
silent guess).

Constraint check: budget is free-services-only, no paid APIs, no Claude API in
scheduled runs. The fix below keeps FX conversion offline in the sync/reconcile
path — a committed rate cache is fetched occasionally by a `*-ref.ts` script
(same pattern as `geo-ref.ts` → `geo.ts`), never called live during a normal
`sync`/`renormalize` run. No tension with any principle, constraint or non-goal.

## Why

`halong-bay-heritage-marathon-2019` currently stores raw USD numbers (8, 10,
15, ... 95) under a race whose top-level `currency` is `"VND"`. Its own
`sources[1].extracted.facts.currency` correctly says `"USD"` and even notes
"Prices are in USD" — the information was extracted correctly and lost during
reconciliation.

Two separate bugs produced this:

1. **`reconcile.ts:106`** sets the race's `currency` from a single source
   (`primary.facts.currency`, the first usable source by role/site rank) but
   builds `prices` (`reconcile.ts:97-99`) by flattening **every** source's
   tiers verbatim, regardless of what currency that source stated. A source
   whose currency disagrees with the winning `currency` gets its raw numbers
   merged in unconverted.
2. **No sanity floor on price.** `PriceTierSchema` (`schema.ts:150`) only
   checks `price >= 0 && price <= MAX_PRICE`. A VND race with a price of `8`
   passes validation even though a real fee is never that low (it's either
   `0`/free, or at least ~10,000₫).

Fixing this isn't just "multiply by today's rate" — the user's point: OpenRace
is meant to support price trends *across years*, so a 2019 USD price and a
2026 USD price need the rate that applied *when that price was charged*, not
one blanket rate. A price tier already carries its own sale window
(`from`/`to`), so the rate must be looked up per tier, at the tier's `from`
date (when a buyer would actually have paid it) falling back to the race
`date` when `from` is null.

## Changes

- **`data/fx/usd-vnd.json`** (new, committed): a small cache of historical
  USD→VND rates, keyed by year-month (`"2019-02": 23200`, ...), fetched once
  by a new `scripts/fx-ref.ts` (mirrors `geo-ref.ts`: a manually-run, network
  fetch into a cache file, never run during `sync`/`renormalize`). Monthly
  granularity matches typical tier-window length and keeps the cache small
  across years of backfill; a tier's `from` (or the race `date` if `from` is
  null) maps to its year-month, nearest earlier month if that exact month is
  missing from the cache.
  - Source: a free historical-rate API with no paid tier for our volume (this
    repo has maybe a handful of non-VND-priced races total, so call volume is
    trivial). Needs a decision — see Open questions.
  - Currencies other than USD get the same treatment if/when they show up;
    the cache is keyed `"<CCY>_VND"` per file or one file with a currency
    field, whichever `fx-ref.ts` makes simpler.
- **`scripts/lib/fx.ts`** (new): pure, offline lookup — `vndRate(currency,
  date): number | null` reading the committed cache, nearest-earlier-month
  fallback, `null` (not a guess) if the cache has nothing for or before that
  date.
- **`scripts/lib/schema.ts`**:
  - `PriceTierSchema` gains two optional fields for provenance, only present
    when a conversion happened:
    - `priceOriginal: { currency: string; amount: number } | null`
    - `fxRate: { rate: number; asOf: string } | null` (`asOf` is the
      year-month the rate came from)
  - Add `MIN_PRICE = 10_000` (VND) next to `MAX_PRICE`. Not a hard `z.refine`
    on `PriceTierSchema` alone (currency lives on the race, not the tier) —
    enforced as a flag in `reconcile.ts`, per the next bullet.
- **`scripts/lib/reconcile.ts`**:
  - Race `currency` is no longer read from a source; it's hardcoded `"VND"`
    (per your call: one currency for all races).
  - When building `rawPrices`, for each source whose `facts.currency !==
    "VND"`: look up `fx.vndRate(facts.currency, tier.from ?? primary.facts.date)`
    for each of that source's tiers. If a rate is found, convert
    (`price: Math.round(originalPrice * rate)`) and set `priceOriginal`/
    `fxRate`; the original USD number is preserved, never discarded. If no
    rate is found for that date, keep the tier out of `rawPrices` and push a
    flag (`"<site>: prices stated in USD, no VND rate cached for 2019-02 —
    needs scripts/fx-ref.ts run"`) instead of guessing.
  - After building `fields.prices`, add one more flag pass: any tier with
    `price > 0 && price < MIN_PRICE` and no `priceOriginal` (i.e. a converted
    tier that's still implausibly low isn't new information — a raw VND tier
    that's implausibly low is) gets `"<site>: <distance> price <price> VND is
    below the plausible floor (${MIN_PRICE}) — check the source"`.
- **`scripts/gaps.ts`**: add a category for races with a price-floor flag (or
  reuse the existing "non-empty flags" category — check whether that already
  catches these once the flag text above exists; if the flag category is
  already generic enough, no gaps.ts change is needed beyond a manual check).
- **Backfill**: no manual data edits. Once `fx-ref.ts` has populated the
  cache for every year-month any non-VND source needs, `npm run renormalize
  -- --commit` re-derives every race from its already-stored `extracted`
  facts (free, no Firecrawl/Claude cost) and fixes `halong-bay-heritage-marathon-2019`
  and any other latent case the same way, in one pass.
- **`scripts/lib/extraction.ts`**: no change needed — `facts.currency` is
  already captured correctly per source; the bug was entirely in how
  `reconcile.ts` used it.
- **Docs**: one line in `.claude/docs/status.md` (or wherever the FX cache
  lives is documented) noting `data/fx/usd-vnd.json` exists, how it's
  refreshed (`npm run fx:ref`), and that a race can carry a
  `priceOriginal`/`fxRate` per tier when its source wasn't VND.

## Open questions — resolved 2026-09-27

- **FX data source: `fawazahmed0/currency-api` doesn't actually have historical
  depth.** Built `fx-ref.ts` against it and checked the npm package's version
  list directly (`data.jsdelivr.com/v1/packages/npm/@fawazahmed0/currency-api`):
  the earliest cached snapshot is `2024-10-01`, not back to 2015 as hoped — a
  404 on every date this repo actually needs (2019–2022). Re-checked
  exchangerate.host (now requires a signup API key, no longer keyless) and
  ECB/Frankfurter (still no VND) as alternatives; both ruled out again.
  **Switched to the World Bank's official annual exchange rate**
  (`api.worldbank.org`, indicator `PA.NUS.FCRF`, "LCU per US$, period average"):
  free, no key, no signup, real data back through the 1980s, and it directly
  covers VND (query country `VNM`) and — via a cross rate through
  `VNM`/`<currency's own country>`, e.g. `EMU` for EUR — any other currency a
  source states. User confirmed this trade (2026-09-27).
- **Monthly → annual granularity.** The World Bank series is one number per
  calendar year, not per month, so `fx-ref.ts`/`fx.ts` key the cache by year
  (`"2019"`, not `"2019-02"`) and a tier looks up its `from` year (or the race
  year) with nearest-earlier-year fallback. Coarser than the plan's original
  monthly design, but real, sourced, and free — the alternative (a paid or
  signup-gated API) isn't worth it for the handful of non-VND races this repo
  actually has.
- **Cache format**: one file, `data/fx/rates.json`, `{ "<CCY>": { "<year>":
  <VND per unit> } }` — not `data/fx/usd-vnd.json` as first drafted, since EUR
  showed up too (halong-bay-heritage-marathon-2022, justrunlah.com prices in
  EUR) the moment the actual data was checked.

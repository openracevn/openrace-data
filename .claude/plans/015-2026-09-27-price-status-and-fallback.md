# Plan 015: a real price at any time, and a simpler `PriceStatus`

## Roadmap fit

Refines a **Built** part of the path, not a new direction: [plan 003](003-2026-09-24-schema-v3-geo-price.md) already put "the current price is worked out at read time from today's date" in `design-v2.md:69`, and the roadmap's question table already has "Sort upcoming races by price... price on a date" and "All races under 300k at today's tier" marked Built. This plan fixes gaps in that read-time logic (a race with no tier on sale currently returns `price: null`, which under-informs both a newbie checking a past race and the `maxPrice` filter) and simplifies its status vocabulary. No trust principle, constraint or non-goal is touched — if anything it serves principle 3 ("honest about uncertainty... an unknown value is null and never treated as zero or cheap") by not letting a real, known price disappear behind `null` just because no tier is currently open, and by not labeling a closed race `on_sale` (a claim that would be false). No roadmap change-log entry needed.

openrace-data itself has **no schema or pipeline change** — this is entirely in how already-stored, already-correct data (`prices[]`, each tier's `from`/`to`/`kind`/`site`) is read. Confirmed in the prior conversation: sellers essentially never disagree on price when they cover the same tier (24/26 same-window comparisons matched exactly across all races today), so keeping every source's price as its own row (not collapsing to one) stays as-is.

## Decision (confirmed with the user)

**Status** is purely race-date-relative, 3 values, replacing the current 4 (`on_sale` / `not_yet_open` / `ended` / `no_price`):

| Status | When |
| --- | --- |
| `on_sale` | before race day, and a tier's window covers today |
| `not_selling` | before race day, but no tier window covers today (before the first tier opens, or a gap between tiers) |
| `ended` | on/after race day |

`no_price` is **not a status** — it was conflating "we have no price data for this course" (a data-completeness question, answered by `price: null` regardless of status) with the race's temporal state. Every race with any price data at all should resolve to one of the 3 statuses above, with a price attached whenever any tier exists to fall back to.

**Price always resolves, given any price data exists:**
- `on_sale`: the active tier's price (existing logic).
- `not_selling` / `ended`: fall back to the last known tier — prefer `kind: "regular"`, else the tier with the latest `to`/`from` — excluding `kind: "group"` tiers always (a seller-side discount, not the race's own price).
- When several sources (`site`) match the same tier, **prefer `official` over `seller` over `reference`** (same role rank `reconcile.ts:28` already uses on the data side) as the tie-break, ahead of price.
- `audience` stays as it is today: default to `resident` when unspecified. Not touched by this plan.

## What's actually affected, repo by repo

### openrace-api (`src/lib/price.ts`, `src/api/routes/races/races.services.ts`, `src/api/routes/races/races.schema.ts`)

- `PriceStatus` (`price.ts:16`) narrows to `"on_sale" | "not_selling" | "ended"`.
- `priceAt` (`price.ts:42-74`) needs `raceDate` as a new input (it currently only sees the query date `at`, never the race's own date — today it can't actually tell "before the race, tiers exhausted" from "the race happened," both fall into today's `ended` branch). New shape:
  - `at >= raceDate` → `status: "ended"`, price = fallback (regular, else latest, both excluding `group`).
  - a candidate tier's window covers `at` → `status: "on_sale"`, its price, official-over-seller tie-break added to `byPriceThenTo` (`price.ts:33-34`).
  - otherwise → `status: "not_selling"`, price = fallback: last known **past** tier (regular, else latest, excluding `group`); if no tier has opened yet at all (e.g. months before an SEB starts), fall back to the **soonest upcoming** tier's price instead of `null` (confirmed by the user, 2026-09-27) — `next` already carries the same tier, so this just also surfaces it as the displayed price.
- The official/seller tie-break needs each tier's role. `PriceTier.site` (a site key like `"irace"`) has no role on it directly; `race_sources` (`schema.drizzle.ts:86-93`) has `site`+`role` but is only joined in the single-race detail path (`races.services.ts:487-505`), not the list path used for search/filter/sort. Cheapest fix: port the small known-seller-site classification openrace-data already has (`scripts/lib/sites.ts:69`: anything not a known aggregator/seller is `official`) into `price.ts` as a static list, rather than adding a `sources` join to every list query. Flag: this duplicates a list across repos, same shape of problem plan 006 solved for race types — fine for now, worth a shared-values follow-up later if the seller list drifts.
- `selectRacePrice` (`races.services.ts:205-222`) and the `["not_yet_open", "ended", "no_price"]` fallback loop (`:217`) simplify to the 2 non-`on_sale` statuses.
- `applyPriceAndFreshFilters`'s `maxPrice` filter (`races.services.ts:272-278`) and `sortRaces`'s price sort (`:293-299`) currently only treat `status === "on_sale"` as a real price for filtering/top-of-sort purposes, excluding everything else. **Decide explicitly:** keep that (a `maxPrice` filter is about "can I buy this for ≤X now," so `not_selling`/`ended` races legitimately stay excluded from it) — recommend keeping as-is, just confirm it's intentional now that those races *do* carry a price, so it doesn't look like an oversight later.
- `races.schema.ts:210-212`'s OpenAPI enum and example need updating to the new 3 values.

### openrace-web (`src/lib/api-types.ts`, `src/components/openrace/or-course-price-table.tsx`)

- `PriceAt["status"]` (`api-types.ts:118`) narrows to match.
- `or-course-price-table.tsx`'s `columnStatus` (`:35-39`) reuses `PriceAt["status"]` today, but it answers a **different question** — is this specific tier's own window before/during/after *its own* dates (used to highlight one column in a price table), not the race's overall status. It has no `not_selling` case and doesn't need one. Narrowing `PriceAt["status"]` would make its `"not_yet_open"` return value stop type-checking against that shared type. Give it its own local type (`"on_sale" | "not_yet_open" | "ended"`, all about one column) instead of borrowing `PriceAt["status"]`, so the two concepts stop being silently coupled.
- No other file branches on `priceAt.status` directly (checked `or-race-card.tsx`, `or-race-detail.tsx`, `or-search-dialog.tsx`, `page.tsx`, `race-search/route.ts`, `race-heatmap.ts` — none do).

### openrace-mcp (`src/lib/format.ts`, `src/lib/types.ts`)

- Thin pass-through (`status: string`, no local enum) — no type change needed. `format.ts:21`'s `c.priceAt?.status ?? "no_price"` fallback string should just change to something that isn't a now-nonexistent status (e.g. `null`), since it's dead-ish defensive code (every course from the API always carries a `priceAt`).

## Build order

1. openrace-api: `price.ts` (status enum, `raceDate` param, fallback, tie-break) → `races.services.ts` (selectRacePrice, filters, sort — confirm the maxPrice-only-on_sale behavior) → `races.schema.ts` (OpenAPI). Add/update tests for the 3 statuses and the fallback (before-first-tier, mid-gap, post-race) cases.
2. openrace-mcp: update the dead fallback string.
3. openrace-web: `api-types.ts`, decouple `or-course-price-table.tsx`'s column type.
4. openrace-data: record the decision in `.claude/docs/decisions.md` (status is race-date-relative only; fallback and tie-break rules) once built, same pattern as other cross-repo decisions there.

## Out of scope

- Any change to `reconcile.ts` or how multi-seller prices are stored (explicitly kept as-is).
- `audience` resolution beyond today's `resident` default.
- A shared site-role/values package across repos (noted as a future follow-up, not this plan).

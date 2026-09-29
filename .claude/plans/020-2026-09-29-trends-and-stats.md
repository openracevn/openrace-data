# Plan 020: Trends and better stats (data, API, MCP, web)

Date: 2026-09-29. Status: draft, not yet approved. Spans openrace-data, openrace-api, openrace-mcp and openrace-web; each sibling repo gets a short plan that links back here.

## Roadmap fit

Serves path step 4 ("Stats from the data") and the question-table row "How many trail races a year? North vs South? Distance distribution?", which is still "Later". One tension to confirm with the user:

- **Trends go a little beyond step 4's list.** Step 4 names "price trends by year" and "deeper stats once there's enough history". It does not name per-series price and participant trends, or races per year by type. **Build step 0 adds the new question rows and a dated change-log line before anything else is built.**

Trust principles hold, and the design leans on them:

- **3 (honest about uncertainty):** every trend response carries `known` and `total`, and a point built from fewer than 5 races is dropped, not plotted. Unknown is `null`, never 0.
- **6 (automated, not reviewed):** the derived price and the new `status` are checked by `validate` before commit.
- **1 (every fact traces to a source):** `status` needs a source link and a reason, like an override.

Constraints and non-goals: free tiers only, no new external service; aggregate statistics only, nothing per runner; no ticket quota tracking.

## Problem

We have 387 races (343 past), 62 series, 1,315 price tiers and 67 participant counts, but nothing shows change over time:

- `GET /stats/by-month` and `by-type` mix all years together. `by-distance` groups by the free-text course label, so "21km", "Half" and "21K" are different bars.
- The only time-series chart is `OrSeriesGrowth` (participants per edition). There is no price over time, no races per year by type.
- 2024–2026 have 100+ races each; 2015–2023 have about 50 in total. Without a coverage rule, an early "low" year reads as a real trend.
- 114 races in a series have no `edition`, and no race can say it was cancelled or postponed. `registrationStatus: cancelled` is used by zero races. Series gaps (for example Andros Lakes 2021) exist only as prose in a description.
- Prices have five tier kinds (super_early to group) and 70 tiers with no `distance`, so there is no single comparable price per race.

Region already works (the API derives north/central/south from `admin_units`), so it is not part of this plan.

## Goal

Someone can ask "how many trail races a year?", "how has the price of a half marathon changed since 2022?" and "how has this series grown?", get an answer from the API, the MCP server and the web, and always see how much data stands behind it.

## Design

### 1. openrace-data (schema v4)

**`courses[].priceRegular`** (derived). One comparable price per course: the `regular` tier, else `early`, else `null`. Companion `priceBasis: "regular" | "early" | null`. Group tiers and `other` never count. It is computed in `scripts/lib/` next to the price reconciliation and re-derived on every write, like participant `confidence`, so it cannot drift. Matching a tier to a course uses the existing distance parsing; a tier with no `distance` on a race with one course maps to that course, otherwise the course stays `null` (a gap, not a guess).

**`status`** on a race: `held | cancelled | postponed | moved`, default `held`. Non-`held` needs `statusSource` (a URL) and `statusReason`, checked by `validate`. A `moved` race keeps its original year in `statusReason`. Cancelled and postponed races are `status`, not deletions, so series gaps become data.

**`edition` fill** is data work, not a schema change: `npm run gaps` reports series races without one, and the `update-race` skill (plan 019) fills them.

**Backfill** of past editions for the larger series comes with the `update-race` skill. This is the real bottleneck: trends are only as good as the history behind them.

Distance bands are deliberately *not* in the data. They are a statistics concept and the API already owns `PARTICIPANT_SIZE_BANDS` the same way.

### 2. openrace-api

- **Migration:** `courses` keeps its JSON column (it now carries `band`, `priceRegular`, `priceBasis`); add `status`, `status_source`, `status_reason` columns to `races` and an index on `status`. Add a `band` derivation at sync and update `schema.zod.ts`, `schema.drizzle.ts` and the OpenAPI schema.
- **`DISTANCE_BANDS`** (single source of truth, exported like `PARTICIPANT_SIZE_BANDS` and returned in responses): `5k`, `10k`, `21k`, `42k`, `50k`, `70k`, `100k_plus`, `other`, each with inclusive metre bounds. A course with `meters: null` is `other`, never dropped.
- **`GET /stats/by-year`**: `groupBy=type|region|band`, optional `type` and `region`. Returns `{year, count}` (or with the group key). Counts held past races only; upcoming races are counted only with `scope=all`.
- **`GET /stats/price-trend`**: `band` (required), optional `type` and `region`. Per year: median `priceRegular`, `n` (races with a price), `total` (races in that band and year). Median, not mean, so a few big races do not skew it. A year with `n < minSample` is omitted and `minSample` (5) is returned.
- **`GET /stats/participants-trend`**: same shape, by year, band or type.
- **`GET /stats/by-distance`** repointed at bands. The label version stays as `?groupBy=label` so nothing breaks.
- **`GET /series/{id}`** gains `trend`: per edition `{edition, year, date, status, participants, priceRegular}` where `priceRegular` is for the series' main band, plus `firstYear` and the change from first to latest known figure. `latestParticipants` and `peakParticipants` stay.
- **Race payload** gains `status`, `courses[].band`, `courses[].priceRegular`. Existing fields do not change. Breaking changes are allowed while the contract settles, but this plan needs none.
- Every stats response carries `known`, `total` and a scope string, following `by-size`.

### 3. openrace-mcp

- **New tool `get_stats`**: `metric` (`races_per_year | price_trend | participants_trend | distance_bands`), `groupBy`, and filters. Its description says what is counted, that unknown is not zero, that each result has `known/total` and a sample size `n`, and that a model should quote "based on N races" rather than extrapolate. It follows the tool file convention (`*_INFO`, `execute*`, `register*`), so the `GET /` page lists it automatically.
- **`get_series`** returns `trend` and each edition's `status`.
- **`get_race`** returns `status`, `band` and `priceRegular` per course.
- **`npm run eval`** grows from six roadmap questions to nine, adding the three questions in Goal.
- A change to `src/lib/arg-summary.ts` still lands in both repos.

### 4. openrace-web

Every chart follows the existing rule (`stats-chart-explanation.md`): a `title` and an `explanation`, scope in the title, keys in both `vi.json` and `en.json`.

On `/stats`:

1. **Races per year, stacked by type** (bar chart). Title and explanation say that years before 2024 are incomplete backfill, not a real drop.
2. **Median regular price by distance band, by year** (a line per band). Points below `minSample` are hidden; the tooltip shows `n` and `total`.
3. **Distance bands** replace the label-based distance chart, fixing the fragmentation.
4. **Participants by year:** a chart when there is enough data, otherwise one line of text ("known for 13 of 107 races in 2025").

On a series page, next to `OrSeriesGrowth`, a new `OrSeriesPriceTrend`: `priceRegular` per edition for the main band. Cancelled, postponed or unknown editions are labelled gaps, like the existing no-figure bar, never zero. On a race page, a `status` badge beside `or-race-status`. Use the `dataviz` skill for the charts.

## Steps

0. **Roadmap:** add question rows ("How many trail races a year?", "How has the price of a distance changed?", "How has this series grown?") and a dated change-log line; link this plan from the "Later" row.
1. **Data:** `status` and `priceRegular` in the schema, derivation and `validate` checks, tests, a re-derive run over all races, `edition` gaps in `npm run gaps`. Version the schema and update the generated JSON schema.
2. **API:** migration, `DISTANCE_BANDS`, `by-year`, repointed `by-distance`, race payload fields. Ships value on the data we already have.
3. **API:** `price-trend`, `participants-trend`, `series.trend`.
4. **MCP:** `get_stats`, description updates on `get_series` and `get_race`, eval questions.
5. **Web:** `/stats` sections 1, 3 and 4, then the price chart, the series chart and the status badge.
6. **Backfill:** past editions of the bigger series through `update-race`. Runs in parallel with steps 2–5 and decides how full the trend charts look.

Steps 1–2 and the distance and per-year charts are useful before the backfill. The price and participants charts will be mostly empty until step 6 catches up, and `minSample` hides them until then.

## Testing

- **Data:** unit tests for the `priceRegular` derivation (regular over early, group excluded, no `distance` on a multi-course race stays `null`), `validate` rejecting a non-`held` status without a source, and a snapshot re-derive that changes only derived fields.
- **API:** service tests for bands (edges 5,000 / 10,000 / 21,097 / 42,195 m, null metres), `by-year` counts against a fixture, price-trend omits `n < 5`, and `series.trend` with a cancelled edition and a missing figure.
- **MCP:** eval script against a running server; input-schema tests as for existing tools.
- **Web:** typecheck and build; charts tested with fixtures that include a gap, a below-sample year and an empty state. Per the user's global rule, the browser is not launched without asking; if not permitted, the UI is reported as not visually tested.

## Risks

- **Thin history.** Mitigation: `minSample`, `known/total` everywhere, an explicit early-years note, and the backfill in step 6.
- **A wrong tier-to-course match** would put a wrong price in a trend. Mitigation: the derivation leaves `null` when unsure, `validate` flags a `priceRegular` outside the price-plausibility bounds, and the existing price sanity checks still run.
- **Median of few points can jump.** Mitigation: show `n` in every tooltip and hide below the threshold.
- **Schema v4 touches all four repos.** Mitigation: the data and API changes are additive (new fields, new routes), so the repos can deploy in order without a flag day.

## Open decisions

1. **Where `priceRegular` is derived.** Recommended: in openrace-data, so `validate` checks it before commit (principle 6). The alternative is the API at sync: less data churn, but no validation and a second place to fix a bad match.
2. **`minSample`.** 5 is a starting value; revisit once the backfill is done.

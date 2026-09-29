# Plan 023: A public completeness score (data, API, MCP, web)

Date: 2026-09-29. Status: built 2026-09-29 (steps 0–4), committed locally in all four repos, not pushed or deployed. Spans openrace-data, openrace-api, openrace-mcp and openrace-web; the API and web plan indexes get a line that links here.

## Roadmap fit

Serves the mission's "correct, complete and current, and they can see why they can trust it", and path step 5 (the website as the public window, plan 022). New question row: "How complete is OpenRace's data, and is it getting better?" (step 0 adds it).

Trust principles hold, and the design leans on them:

- **3 (honest about uncertainty):** the score says what it can't measure (races we don't know exist), dips are shown and explained, never smoothed away. The user's first idea was "the score goes up with every update". It won't always: adding an old race with little data lowers depth, and finding a missing edition raises coverage but lowers depth until it is filled. The page frames the score as "tracked in the open, with history", not "always rising".
- **1 (every fact traces to a source):** the score is computed from the data, never typed by hand. The page's "what we're working on" list comes from the same numbers, not written copy (plan 022's rule).
- **6 (automated):** the score is computed at every sync and by the daily cron; nobody updates it.

Constraints: free tiers only. One extra D1 row per sync and per cron run. No new service.

## Problem

`npm run gaps` lists missing data by kind but gives no overall picture, and nothing public says how complete the data is. The per-race checklist (`raceChecklist`, plan 019) marks fields ok/gap for `update-race`, but used raw as a score it is unfair in three ways (measured 2026-09-29, raw score 63%):

- `city` is null on 277 races whose `venue` names the place ("Aeon Bình Tân, Hồ Chí Minh") and whose `geo` has the province. City reads 27% when the place is known.
- `series` counts as a gap on every one-off race, which may rightly have none; `edition` likewise.
- `flags` and `confidence` only appear when something is wrong, so they are pure penalties with no ok side.

## Goal

One public number (plus a second for edition coverage) that anyone can read on every page of the site, through the API and through the MCP server, with its history, its per-field breakdown and a plain statement of what it doesn't measure.

## Design

### Two numbers

1. **Depth** (`score`, 0–100): of the facts we expect for the races we have, the share we hold. Per race, these items are scored (ok or gap; anything else is not scored):

   | Item | Scored for | ok when |
   | --- | --- | --- |
   | `place` | all | `venue` or `city` is set |
   | `geo` | all | a point with a current province |
   | `organizer` | all | `organizerId` set |
   | `courses` | all | at least one course |
   | `types` | all | at least one type |
   | `edition` | races in a series | `edition` set |
   | `prices` | upcoming | tiers exist and every course has one |
   | `registration` | upcoming | a registration or seller link |
   | `participants` | past | a count with medium or high confidence |

   `date` is not scored (it can't be missing). `series` is not scored (a one-off and a missing link look the same). Flags and conflicts are reported beside the score as `openIssues`, not inside it. "Past" is by the last day (`endDate ?? date`) against Vietnam's today.

2. **Edition coverage** (`editionCoverage`, 0–100): across series, editions on record ÷ editions known to exist. Known per series = the largest of: editions on record, the organizer's `statedEditionCount`, on record + missing years between first and last, on record + missing edition numbers below the highest. When plan 020's `status: cancelled` lands, cancelled editions count as on record.

Neither can see a race we haven't found, and races outside any series have no coverage measure. The API, MCP and page say so.

`raceChecklist` stays as it is for `update-race` (city and series gaps are still useful work hints there). The score uses its own `scoreItems`.

### One definition, two implementations, one fixture

The API computes the score from D1 (it holds every race; the data repo's commit path only reads changed files, and reading all 387 through the GitHub API per commit would blow the rate limit). The data repo computes it locally for `npm run gaps`. To stop the two drifting, `test/fixtures/completeness-cases.json` (a few synthetic races, a fixed today and the expected items) lives in both repos, byte-identical, and both test suites run it. A rule change touches both repos in the same pass (like `arg-summary.ts` in the MCP).

### 1. openrace-data

- `scripts/lib/race-gaps.ts`: `scoreItems(race, today)`, `completeness(races, series, today)` returning `{score, ok, total, byField[], editionCoverage: {score, onRecord, known}, openIssues, races}`.
- `npm run gaps` prints both numbers and the breakdown first.
- `test/completeness.test.ts` over the fixture.

### 2. openrace-api

- Migration `0013_completeness.sql`: `completeness_snapshots(day TEXT PRIMARY KEY, computed_at, commit_sha, score, ok, total, edition_on_record, edition_known, open_issues, races, by_field TEXT JSON)`. One row per Vietnam day, last write of the day wins (upsert).
- `src/lib/completeness.ts`: the same rules over D1 rows. Run at the end of a sync that changed races and in the daily cron (past/upcoming shifts daily with no commit).
- `GET /stats/completeness`: the latest snapshot (computed live if the table is empty) plus `history: [{day, score, editionCoverage}]` (oldest first, all days), plus `notMeasured` (a fixed sentence list, vi/en keys are the web's job; the API gives English). Cached like the other stats routes.
- Test over the shared fixture.

### 3. openrace-mcp

- New tool `get_data_completeness` (no input): both numbers, breakdown, open issues, `computedAt`, history length and first day, and the "not measured" note. Its description tells a model to quote the numbers with their date and not to read depth as "share of Vietnam's races we list". Follows the tool file convention (`*_INFO`, `execute*`, `register*`).
- `npm run eval` gains the question "How complete is OpenRace's data?".

### 4. openrace-web

- **Footer badge** on every page (`or-footer.tsx`): "◐ Độ đầy đủ dữ liệu 63% ▲ +2 / 30 ngày", a link to the page. The 30-day change shows ▲ or ▼ as it is; hidden only when there's less than 2 days of history.
- **Page** `/minh-bach` (en `/transparency`), sections:
  1. Two stat tiles (depth, edition coverage) with their fractions and the computed time.
  2. History chart, both lines, with the caption that dips come from adding old races. Shown once there are 2+ days.
  3. Per-field bars, with the scope footnotes (upcoming only, past only, series only).
  4. How it's worked out, and what it doesn't measure.
  5. "Đang làm tiếp": the three biggest gaps, as counts from the API (not written copy), linking to lists where one exists.
  6. "Thấy sai hoặc thiếu?": a link to openrace-data's GitHub issues.
- Keys in both `vi.json` and `en.json`; chart title and explanation per `stats-chart-explanation.md`; charts with the `dataviz` skill. Sitemap and footer link include the page.

## Steps

0. Roadmap: add the question row (Status: this plan). Plans index line.
1. openrace-data: `scoreItems`, `completeness`, `gaps` output, fixture + test. Commit.
2. openrace-api: migration, lib, sync + cron hook, route, fixture test. Deploy needs `db:migrate:remote` and `wrangler deploy` (ask the user before running either against production).
3. openrace-mcp: tool, eval question. Deploy after the API is live.
4. openrace-web: footer badge, page, i18n, sitemap. Build + typecheck; browser check only with the user's permission.

## Later

- Seed history from git: replay openrace-data's commits per day (since 2026-09-23) through `completeness` and load them as snapshots, so the chart doesn't start empty.
- Weighting fields by what users ask about (prices, dates, place) if the flat share turns out misleading.

## Build log

- **2026-09-29, data:** `scripts/lib/completeness-core.ts` (import-free, copied to the API), `scoreInput()` in `race-gaps.ts`, `npm run gaps` prints the two numbers first. First real numbers: **69% depth (1,778 / 2,560), 70% editions (194 / 278 across 62 series), 11 open issues.** The raw checklist gave 63%; the difference is the fixed rules (place instead of city, no series item, edition only for series races, flags outside the score) and a stricter prices item (every course priced: 77% of upcoming races).
- **2026-09-29, API:** migration 0013 (`completeness_snapshots`), `src/lib/completeness.ts` (JSON reduced in SQL to keep Worker CPU low), snapshot at the end of a sync and in the daily cron, `GET /stats/completeness`. Same fixture passes in both repos; loading the real 387 race files through `toRaceValues` into the test D1 gives the exact numbers above.
- **2026-09-29, MCP:** `get_data_completeness` tool, server instructions line, eval Q7, README table.
- **2026-09-29, web:** footer badge (hidden when the API call fails), `/minh-bach` (en `/transparency`) with tiles, history chart (shown from 2 days), per-field bars, "working on next" from counts, method and not-measured text, a GitHub issues link; sitemap entry. `next build` passes. Not checked in a browser.
- **To go live (in order):** push openrace-api, `db:migrate:remote`, deploy; push and deploy openrace-mcp; push openrace-web; push openrace-data. History starts on the first sync after the deploy.

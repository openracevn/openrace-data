# Plan 016: multi-day races: first day, last day and a main race day

Status: **written, awaiting approval. Nothing is built.**

## Roadmap fit

Serves a **Built** question, "I'm in Nha Trang 1–15/12: which races are nearby on those days?" (`date` overlap `date`..`endDate`), by making the days it relies on correct. Adds one new question to the table first (done with this plan): **"Which day is the main race day of a multi-day event?"**

- **Principle 1 (every fact traces to a source):** `mainDate` is written only when a source states it, or by an override with a reason and a link.
- **Principle 3 (honest about uncertainty):** an unknown main day is `null`. It is never copied from `date`, because today's `date` is a mix of first day and main day (see "The problem").
- **Constraints and non-goals:** none touched. No new paid service. Breaking openrace-api is allowed, but this change is additive.

No roadmap change-log entry is needed.

## The problem

Multi-day is already supported end to end: `date`..`endDate` in the data (149 of 362 races have an `endDate`), the API's overlap filter and last-day logic, the web's date range, the MCP `from`/`to` window. What is missing:

1. **No main race day.** A 6–8 Nov event with the main race on 8 Nov (Standard Chartered Hanoi Heritage Race) can't say so.
2. **`date` means two things.** `design-v2.md:45` says "Race day", but the source that wins decides whether `date` is the first day or the main day. Hanoi's `date` is 11-08 (main day); Halong Bay Heritage 2026 was 11-20 (first day) while irace and ActiUp said 11-22 (main day).
3. **False "sources disagree" flags.** `reconcile.ts:130` compares only `date`. Sources that give the first day and the main day of one event look like a conflict. Likely cause of most of the 6 date-conflict flags in `npm run gaps` (Andros 18/19 was two real days; Global Gate and Dat Sen are unchecked).
4. **Extraction can't represent it.** `PAGE_EXTRACTION` (`scripts/lib/extraction.ts:71`) has `date` and `endDate` ("only for multi-day events"). `normalizeExtraction` (`:230`) nulls any `endDate <= date`. ActiUp gives start and end dates only; irace's JSON-LD dates are documented as unreliable for multi-day races.
5. **Web JSON-LD** (`openrace-web/src/app/[locale]/races/[slug]/page.tsx:80`) emits `startDate` only, no `endDate`. FAQ "next race" answers show only the first date.

## Decision (to confirm)

| Field | Meaning | Null means |
| --- | --- | --- |
| `date` | **First day** of the event | never null |
| `endDate` | **Last day**; null for a one-day event | one day |
| `mainDate` (new) | The **headline race day**, when the source states one | not stated / same as `date` |

- Rule: `date <= mainDate <= endDate`; `mainDate` requires `endDate` (a one-day race has no `mainDate`). Same style as the existing `endDate >= date` refine at `schema.ts:323`.
- **Two sources agree on the race day** when the later date falls inside the earlier one's `date..endDate`, or when they are equal. Only a real disagreement raises the flag and `conflicting`.
- **Never backfill `mainDate` by copying `date`.** See the backfill stage.
- Alternative not chosen: keep `date` as the main day and add `startDate`. Smaller, but every current `date..endDate` consumer would need reviewing (sorting, upcoming, series, stats by month).
- Out of scope (later): `courses[].date`, which distance runs on which day. Sources rarely state it, and it is a bigger model change.

## What changes, by repo

### openrace-data (stage A)

- `scripts/lib/schema.ts`: `mainDate` on `RaceSchema` (nullable, default null) with the range refine, on `IndexEntry` (`:429` area) and in the extraction facts; add `mainDate` to the override field list (`:240`). Then `npm run schema`.
- `scripts/lib/extraction.ts`: `PAGE_EXTRACTION` asks for the first day, the last day and the main race day separately, and only fills the main day when the page states one. `normalizeExtraction`: parse `mainDate`, drop it unless `date <= mainDate <= endDate`.
- `scripts/lib/reconcile.ts`: carry `mainDate` from the primary source; replace the exact-equality day check at `:130` and `:149` with the range-agreement rule above.
- `scripts/sync.ts` (`indexEntry`, `:430`) and `fieldFlags` (`:321`): pass `mainDate` through; keep the "span too long" flag.
- Recipes: `actiup.ts` and `irace.ts` need no invented main day (they don't have one). Check that ActiUp's `start_date`/`end_date` still land in `date`/`endDate` only.
- `npm run edit`: accept `mainDate`. `scripts/gaps.ts`: new informational section "multi-day races with no mainDate".
- Tests: `test/extraction.test.ts` (parse and drop cases), `test/sync.test.ts` (flags, agreement rule), `test/schema-v3.test.ts` (refine), a fixture with a known answer (Hanoi: 6–8 Nov, main day 8).
- Docs: `README.md` example, `design-v2.md:45`, the `check-race` skill's field list and step 5.

### openrace-api (stage B)

- Migration `0005`: `main_date TEXT`. `schema.drizzle.ts:45`, `schema.zod.ts:130` (with an example), `sync.schema.ts:45`, `sync.services.ts:91`.
- Race payloads (list and detail) carry `mainDate`. Filters, sorting, `upcoming`/`past`, freshness `final`, organizers, series and stats are unchanged: they already use `date..endDate`.
- OpenAPI text and README: `series.schema.ts:57` ("First race day") stays true; document `mainDate`.

### openrace-mcp (stage B)

- `src/lib/types.ts` and `src/lib/format.ts`: pass `mainDate` through. Update fixtures and the `search_races` description (the `from`/`to` overlap wording stays).

### openrace-web (stage C)

- `src/lib/api-types.ts`: `mainDate: string | null`.
- `or-race-card.tsx`: the range stays; when `mainDate` is set and differs from `date`, add a small "main day 8 Nov" marker.
- `or-race-detail.tsx` and `or-race-status.tsx`: show "Main race day: 8 Nov" beside the range.
- `races/[slug]/page.tsx:80`: JSON-LD gets `endDate`.
- FAQ answers (`[slug]/page.tsx`, `[leaf]/page.tsx`): use the range instead of the first date alone.
- vi/en strings for the new labels.

## Backfill (stage D)

`renormalize` can't fix existing races: it only re-derives from stored `extracted`, which never carried a main day. And copying today's `date` into `mainDate` is **not allowed** (it would state a guess as fact).

- **One-day races (`endDate` null):** nothing to do.
- **The 6 date-conflict races first:** fix `date`, `endDate` and `mainDate` with overrides (reason and source link), as done today for Andros, Global Gate and Halong 2026. Standard Chartered Hanoi Heritage Race 2026 is next: 6–8 Nov, main day 8 Nov, once a source link is attached.
- **The other multi-day races:** re-read with the new extraction prompt (`agent-read`, free) or override by hand, biggest series first, driven by the new gaps section. The data is filled only where a source states a main day.
- Until a race is backfilled, the API and web show the range or single date as they do today, with no main-day marker.

## Build order and checks

1. **A. openrace-data:** schema, extraction, reconcile, gaps, tests. `npm run typecheck && npm test`, `npm run schema`, `npm run renormalize` (dry run) to see which races change. Check `test/answers.test.ts` still passes.
2. **B. openrace-api and openrace-mcp:** migration, payloads, fixtures, tests. Deploy the API before the web reads the field.
3. **C. openrace-web:** types, card, detail, JSON-LD, strings. Typecheck and build. UI is not visually tested without the user's OK to use the browser.
4. **D. Backfill:** the 6 conflicts, then the multi-day list.
5. Record the decision (first day / last day / main day, and the agreement rule) in `.claude/docs/decisions.md` once built.

Stages A and B can go to opencode workers with supervision for the mechanical parts (fixtures, strings, field pass-through); the extraction and reconcile changes stay with Claude.

## Open questions

1. Confirm `date` = first day, with `mainDate` as the headline day (the alternative is a `startDate`).
2. Confirm the name `mainDate`.
3. Confirm per-course days stay out of scope.

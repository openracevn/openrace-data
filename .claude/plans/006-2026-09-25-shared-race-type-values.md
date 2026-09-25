# Plan: one source of truth for race type values

**For:** a future session, any of the three repos (openrace-data, openrace-api, openrace-web).
**Read first:**
- `.claude/docs/decisions.md`, the 2026-09-25 type-filtering entry
- `scripts/lib/schema.ts` (`RACE_TYPES`, `RACE_TYPE_COMPONENTS`)
- openrace-api: `src/db/enums.ts` (its comment on why the lists are hand-copied)
- openrace-web: `src/lib/api-types.ts` (`RaceType`, and `SWIM_RACE_TYPES` before this session's web fix removes it)

## Problem

`RACE_TYPES` (13 event-format strings) is hand-copied in three places, each maintained by convention, not by import:

- `openrace-data/scripts/lib/schema.ts` — the owning definition (zod + comments)
- `openrace-api/src/db/enums.ts` — a plain copy, with a comment admitting it's hand-synced
- `openrace-web/src/lib/api-types.ts` — a plain TS union type, third copy

2026-09-25 added `RACE_TYPE_COMPONENTS` (composite format → component disciplines, e.g. `triathlon → [swim, road_cycle, road_run]`) for loose type filtering, duplicated the same way into `openrace-data` and `openrace-api`. Nothing checks that the three lists agree. A value added to `RACE_TYPES` in openrace-data doesn't 400 in openrace-api until someone remembers to copy it; a wrong or stale entry (openrace-web's `SWIM_RACE_TYPES` briefly listed `duathlon`, which has no swim leg) ships silently. This is fragile in the sense that matters here: no error, just quietly wrong answers.

## Roadmap fit

- **Serves** path step 2 ("questions people ask") indirectly: correct type filtering is a prerequisite for the trail/road/swim stats questions in step 4's table.
- **Trust principle 6** ("automated, not reviewed") is the real fit: catching enum drift needs a check that runs itself, since nobody reviews these commits by hand.
- No principle, constraint or non-goal is weakened by fixing this — it's tightening an existing contract, not changing the mission or path. No confirmation needed before building; flagging here per `AGENTS.md`'s process, not because of tension.
- **Out of scope:** changing what the type values mean, adding new types (e.g. `backyard` — still an open question, decided later).

## Options

1. **Shared npm package** (`@openrace/enums` or similar), published or path-linked, imported by all three repos.
   - Pro: one real source, compile-time safety.
   - Con: three separately deployed repos (two Cloudflare Workers, one Next.js app) now share a release dependency; someone has to version and publish it, which is more infrastructure than the $0-budget, 100–150-races/year scale of this project (`roadmap.md` constraints) justifies right now.
2. **Generate, don't copy.** openrace-api/openrace-web read `schema/race.schema.json` (already generated and versioned by `npm run schema` in openrace-data) at build time instead of retyping the enum.
   - Pro: no new package; the JSON schema is already the published contract.
   - Con: needs a build step in two repos that doesn't exist yet (openrace-web has no codegen step today); more plumbing than option 3 for the same result.
3. **Automated consistency check, not a shared source.** A test in openrace-api and openrace-web that fetches `openrace-data`'s `schema/race.schema.json` from its GitHub raw URL (or a pinned copy checked in and refreshed by a script) and asserts the local `RACE_TYPES`/`RACE_TYPE_COMPONENTS` match. Fails CI/`npm test` on drift instead of preventing it at compile time.
   - Pro: smallest change, matches how `SCHEMA_VERSION` already gates breaking changes (`scripts/lib/schema.ts` comment), no shared release process.
   - Con: drift is caught at test time, not edit time; still needs someone to run the fix.

**Recommendation: option 3.** It fits the project's actual scale and matches the existing pattern (comments + `SCHEMA_VERSION`, not a package) while turning "kept in sync by hand" into something that actually fails when it isn't.

## Steps (once decided)

1. openrace-data: no change — `schema/race.schema.json` already publishes `RACE_TYPES`; add `RACE_TYPE_COMPONENTS` to a generated file too if it should also be machine-checked (currently it's TS-only, not in the zod schema).
2. openrace-api: add a test that fetches the raw schema JSON (or a periodically-refreshed local copy, to avoid a network call in every test run) and diffs it against `RACE_TYPES` in `src/db/enums.ts`.
3. openrace-web: same check against `RaceType` in `src/lib/api-types.ts`.
4. Decide how `RACE_TYPE_COMPONENTS` gets published from openrace-data so step 2/3 can check it too (it's not currently in the JSON schema, since it's a filtering rule, not a data shape).
5. Document the check in each repo's README so a future enum change knows to run it.

Not started.

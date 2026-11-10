# 028: Validate before a scheduled run commits

Status: built 2026-11-10 (items 1, 2 and 4; item 3 dropped, see Outcome).

## Roadmap fit

Serves trust principle 6, **"Automated, not reviewed"**: validation does the reviewing *before* anything is committed. Right now the scheduled check (`scripts/check.ts` → `syncToGitHub`) breaks this. It commits first, and the tree is only validated afterwards by Main. No tension with the constraints or non-goals: this adds no paid reads and no LLM API.

## What happened (2026-11-09)

- In Schedule 2's commit `c7f68b2` ("data: 11 updated"), the race `vnexpress-marathon-galaxy-run-2-2026` went from `seriesId: "vnexpress-marathon-galaxy-run-2"` to `null`. `reconcile.ts:107` takes `seriesId` from the sources' series hint, and the re-read source no longer carried that hint.
- The series stayed in `data/series.json` with no races. `validate.ts:126` then failed, which failed the `flush batch` test, so **Main failed from Nov 8 21:08 UTC to Nov 10**. While it failed, "Run npm run validate" and "Notify API" were skipped for every data commit.
- Fixed by hand in `6ce91eb`, an `npm run edit -- set … seriesId` override. Main passed and the API was notified.

## Changes

1. **Validate in sync before committing.** In `syncToGitHub` (scripts/sync.ts), run `treeValidator` (scripts/lib/flush.ts:199) on the planned files on top of the checkout. If it fails, don't commit the race files. Commit only the bookkeeping (`state/`), and post the errors in a Discord alert ("🚫 scheduled run produced invalid data, nothing committed"). Better still, drop only the races whose change causes the errors (the same approach as `planBatch`) so one bad race doesn't hold back the rest.
2. **Don't drop a known series silently.** In `reconcile.ts`, when the new reading has no series hint and the previous record had a `seriesId`, keep the previous one. A series is identity, not something a page re-read should erase. Report it in the run summary as a ⚠ line.
3. **Orphaned series on purpose.** If a race really leaves its series (an override or a new hint), sync already avoids *adding* an unused hinted series (sync.ts:236–240). Extend that so it also *removes* a series left with no races only by that run's changes, never one that already existed with no races.
4. **Tests.** Add a reconcile test for item 2, and a sync test where a planned change orphans a series: nothing invalid is committed and an alert is raised.

## Out of scope

- Changing how series are inferred from names (lib/series.ts).
- Any LLM API in scheduled runs (ruled out by the roadmap, 2026-10-15 change log).

## Check

`npm run typecheck && npm test && npm run validate`. Then run `npm run check -- --dry-run` against a copy of `c7f68b2^`'s data with the Nov 9 readings, and confirm it would have kept `seriesId` and committed nothing invalid.

## Outcome (2026-11-10)

- **Cause, more precisely:** the VnExpress Marathon recipe sends a series hint only when the site's menu names the race. On the Nov 8 re-read it didn't, so the hint was empty and `composeRace` set `seriesId: null`.
- **Item 2** is built in `stabilize` (scripts/lib/diff.ts): when a re-read names no series, the race keeps the one it had. Edits (`planEdit`) don't stabilize, so an override can still take a race out of a series.
- **Item 1** is `planValidSync` (scripts/sync.ts), used by `scripts/check.ts` for both commit and dry runs. A valid plan is validated once. Otherwise each race is added in turn and any race that breaks the tree is held back. A held page is recorded as an `error` check (so it gets read again) and goes back on the to-do list as a failure (the digest picks it up after `MAX_FAILURES`), and the run posts a 🚫 Discord alert.
- **Item 3 is dropped:** with items 1 and 2, an orphaned series can't be committed by a scheduled run, and deleting series automatically would be the riskier choice.
- **Checks:** typecheck, 174 tests and validate all pass. A replay of the real Nov 8 reading on `c7f68b2^`'s data keeps `seriesId` and still lands the other updates. Without the item 2 fix, the same replay holds the race back with the orphaned-series error instead of committing it.
- agent-read, renormalize and sync-cli still commit through `syncToGitHub` without this check. They run from sessions where a person sees Main's result.

# 028: Validate before a scheduled run commits

Status: proposed, waiting for the user's go.

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

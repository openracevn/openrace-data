# Plan 018: Stop burning Actions minutes and GitHub API calls

Date: 2026-09-29. Status: built.

## Roadmap fit

Infrastructure only; serves no new question and touches no trust principle, constraint or non-goal. "Corrections are explicit" still holds: batched commits list every race and field in the message. Making the repo public (done by the user 2026-09-29 to unblock Actions) is worth a look against "Non-commercial for now": the data was already meant to be open, but check source terms before promoting it.

## Problem

2026-09-29: jobs refused to start ("recent account payments have failed or your spending limit needs to be increased"). The private repo's 2,000 free minutes were gone: 634 commits in 30 days, each push starting 4 jobs (`changes`, `validate`, `notify-api`, `notify-discord`), 3 of them running `npm ci`, each billed at least a minute.

## Done

1. `main.yml` is one job (one checkout, one `npm ci`). Discord still runs before validation; API notify still only after typecheck/test/validate pass. Typecheck and tests are skipped when a push touches only `data/`, `state/`, `.claude/` or `*.md`.
2. `ci.yml`: `concurrency` cancels superseded PR runs; `timeout-minutes` on `ci.yml`, `stale.yml`, `main.yml`.
3. `npm run edit -- set-many <race> --json '{...}' --reason ...`: several overrides on one race in one commit (the log had `set seriesId` and `set edition` as separate commits, 198 `edit:` commits in 30 days).
4. Docs and skills say: one commit per batch or race, not per field.
5. Full git history scanned for secrets before the repo went public: none found.

## Not done, on purpose

- `concurrency: cancel-in-progress` on `main.yml`: the notifiers diff the push's own before/after, so cancelling loses races from the Discord and API payloads until the daily sync (decisions.md).
- A `--queue` mode to stage results across commands: habit change first (batch `agent-read commit`, `set-many`); revisit if commit counts stay high.
- `set-many` across several races in one commit: `planEdit` plans one race at a time.

## Later

Make the notifiers diff from the last successfully synced commit, so a failed run can't drop a push's changes.

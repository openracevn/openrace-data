# Plan 019: One `update-race` skill, Claude-led, parallel, batch-committed

Date: 2026-09-29. Status: approved by the user 2026-09-29; steps 0–4 built 2026-09-29, pilot (step 5) pending.

## Roadmap fit

Serves the mission ("correct, complete and current") and the questions about series editions, prices and participants: it closes gaps without the user having to name them. Three tensions, all confirmed by the user on 2026-09-29. **Build step 0 adds them to the roadmap's change log before anything else is built:**

- **Trust principle 5** ("study each site first, then read it with a recipe") is relaxed: Claude's own web search and page reads lead. Recipes and `find-sources` stay for sites that have one.
- **Firecrawl is opt-in**, used only when the user asks. The budget constraint is unaffected.
- **Parallel Claude subagents are allowed** (`race-research` forbade them). It raises Claude usage on purpose, for speed.

Trust principles 1, 3, 4 and 6 hold: every fact still traces to a source, a gap stays a gap, corrections are overrides with a reason, and `validate` runs before anything is committed. No non-goal is touched.

## Problem

Data finding is spread over six skills (`check-race`, `agent-read`, `race-research`, `backfill-field`, `check-organizer`, `opencode-read`). The user has to name the right one, and has to spot missing data themselves. Firecrawl and opencode reads are slower and less effective than Claude's own web search. Work is sequential, and every step tends to become its own commit, which burns GitHub Actions minutes and API calls (plan 018).

## Goal

The user says: `update race A, race B, series C`. One skill decides what to do, finds all the data it can, and commits once.

## Design

### 1. Entry point and target resolution

`update-race` takes a list of names, slugs, ids or URLs. For each it decides, with `npm run find` plus a web search:

- **Existing race:** audit every field, fill gaps.
- **Unknown race:** find it, add it, then audit it.
- **Series:** list every edition (organizer history page, Wayback, reseller pages), compare with `statedEditionCount` and year gaps, add missing editions, audit each one.

### 2. Gap detection (`scripts/race-gaps.ts`)

`npm run gaps -- --race <x>` and `--series <x>` print a per-race checklist: date, venue, location point, organizer, courses, types, prices, edition, series, participants (past races only), registration link, flags and low confidence. It is read-only and always exits 0, like `gaps.ts`. For a series it also reports missing editions. The skill uses it to decide what is left to do and to know when it is done.

### 3. Claude does the work

Source order for each gap:

1. `WebSearch`, batched in parallel (Vietnamese and English wording).
2. `curl` or `WebFetch` on the promising hits.
3. Existing recipes and `npm run find-sources` for known sites.
4. Wayback fallbacks at every step.

Claude judges which source to trust and whether something is the same edition or a new one, and reads price images itself. Free opencode models are optional, for bulk mechanical extraction only, and Claude verifies their output. Deterministic steps stay in scripts: normalization, `backfill-verify`, `validate`, the commit.

The stopping rule is that every gap is either filled from a source or logged in `attempts.json` as a dead end, with what was tried. Nothing is guessed.

### 4. Parallel work without conflicts

- **Orchestrator.** The session the user talks to splits the request into units (one per race or series). With 3 or more units it spawns a subagent per unit, each in its own git worktree. With fewer it works inline. The user may also open extra sessions by hand.
- **Claims.** A unit claims its race or series ids in `.git/openrace-claims/` (shared by all worktrees) before starting. A second session skips or waits on a claimed target. A stale claim expires after a timeout.
- **Staging.** Workers never commit. They write a bundle to `.staging/<unit>.json`: a list of operations (`add`, `set-many`, agent-read results) with reasons and source links.
- **One commit per batch.** `npm run flush` collects all bundles, applies them in a temporary tree, runs `validate` there, and makes one commit through the existing GitHub API path (`scripts/lib/github.ts`, which already retries when the branch moved). The commit message lists every race and field. A unit that fails validation is rejected and left out; the rest still commit. This also delivers the multi-race `set-many` that plan 018 left undone.

### 5. Logs and archive (unchanged rule)

Nothing is deleted. Every fetched page, Wayback snapshot, CDX listing, price image and `WebSearch` query with its full result is saved, per unit. When a unit finishes (committed, rejected or dead end), its folder and its staged bundle move to `.agent-read-archive/<YYYY-MM-DD>-<slug>/`. Both directories are gitignored. Workers check the archive before fetching. Each worker has its own subfolder; the archive is a shared absolute path in the main checkout, so removing a worktree never loses it.

### 6. Old skills

They move under `.claude/skills/update-race/refs/` as reference documents, and their descriptions stop auto-triggering, so the user only ever calls one skill. Their scripts are unchanged and remain what `update-race` calls.

## Build steps

0. Add the three changes above to the roadmap change log (dated 2026-09-29) and update the sections they touch.
1. `scripts/race-gaps.ts` with tests: the per-race and per-series checklist.
2. Staging bundle format, claims, and `npm run flush` (multi-race batch commit, temporary-tree validation, archive on completion), with tests.
3. The `update-race` skill: orchestrator and worker instructions, source order, stopping rule, report format. Move the old skills into `refs/` and adjust their descriptions.
4. Docs: `.claude/docs/README.md`, `AGENTS.md` (the skills list), `status.md`, the plans index.
5. Pilot on 3 real targets (one race with a gap, one missing race, one series). Record time, Claude usage and commit count against the old flow in the plan's log.

## Verification

- `npm run typecheck && npm test` pass; `npm run validate` passes after the pilot.
- The pilot's three targets end as one commit, with a Main run each, not one per race or field.
- Two sessions given the same race: the second is refused by its claim.
- A bundle with a bad `prices[].site` is rejected without blocking the others.

## Open risks

- **Claude usage:** subagents on Claude cost more than one sequential session. The 3-unit threshold is a guess; adjust from the pilot.
- **Web-search-first accuracy:** a snippet is secondhand. The rule stays that a fact from a snippet is backed by a fetched, saved page, and a count without a quote is stored as `low` confidence.
- **Stale claims** after a crashed session: handled by expiry, to be tuned in the pilot.

## Build log

- **2026-09-29, steps 0–4 built.** Roadmap change log and principle 5 updated. `scripts/lib/race-gaps.ts` + `npm run gaps -- --race|--series` (also `npm run race-gaps`). `scripts/lib/workspace.ts` (folders anchored to the main checkout), `claims.ts`, `staging.ts` (bundle ops `add`, `set-many`, `source`), `flush.ts` + `npm run flush` and `npm run claim`. Tests in `test/update-race.test.ts` cover the claim refusal (second session refused) and a bundle with a bad `prices[].site` rejected by the temporary-tree `validate` while the others commit. Skill in `.claude/skills/update-race/`; the six old skills moved to `refs/<name>/REFERENCE.md`.
- **Deviation:** workers do not get a git worktree each. They only write untracked files (`.staging/`, `.agent-read/`), never `data/`, so they share the main checkout and a worktree would only cost a `node_modules` install. Manually opened extra sessions may still use a worktree; the folders resolve to the main checkout.
- **Not built:** editing `data/series.json` (`statedEditionCount`, `description`) has no command yet; the skill reports it to the user. A bundle op for it is a follow-up.
- **Step 5 (pilot) pending:** needs three real targets from the user and a live commit; time, Claude usage and commit count go here when done.

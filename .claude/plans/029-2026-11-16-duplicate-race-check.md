# 029: A standing duplicate-race check

## Roadmap fit

Serves trust principle 6, **"Automated, not reviewed"**: the user doesn't review commits, so a check has to do the reviewing. Here one didn't. No tension with the constraints or non-goals: no paid reads, no LLM API; a held race waits for a person, as plan 028 already does for races that fail validation.

## What happened

`samsung-galaxy-run-2026` (iRace, organizer VnExpress Marathon) and `vnexpress-marathon-galaxy-run-2` (vm.vnexpress.net) were one race, 2026-11-22 in HCMC, stored twice from 2026-11-09 until merged by hand on 2026-11-16 (`62ae81e`).

- Sync's name match (`scripts/sync.ts`, `MATCH_THRESHOLD` 0.65) scored the names 0.600, so it added a second race.
- Its near-miss warning (plan 010, `dupWarning`, ≥ 0.4) fired, but it only lives in the commit message (`2eeeb0c`). Nothing reads commit messages.
- The matcher only compares pages from **different** sites, once, when a race is added. A scan of all 403 races found more pairs from the same site (all ActiUp), for example `kun-fun-run-dong-thap-2026-keyshop` / `mini-game-kun-fun-run-dong-thap-2026` and `phu-quoc-marathon-2025` / `vtv-phu-quoc-marathon-2025-combo`.

Lowering the merge threshold is not the fix. Same day, same province and same organizer still don't separate duplicates from distinct races: `2026-ironkids-viet-nam-in-phu-quoc` / `2026-sunrise-sprint-viet-nam-in-phu-quoc` match on all three (name 0.61). So a person (or Claude in a session) decides, and the check makes sure someone has to.

## The rule

`validate` fails on any **unreviewed** pair of races that:

- start within 1 day of each other (`date`),
- are not known to be in different provinces (`geo.current.province` equal, or missing on either), and
- have a name similarity ≥ 0.4 (the same Dice score sync uses, `nameSimilarity`).

A pair is reviewed when it is listed in `config/not-duplicates.yaml` (both slugs and a reason). Entries naming a slug that no longer exists are ignored, so merges and renames never break validate.

Real duplicates are merged (`npm run edit -- merge <keep> <drop>`), not listed.

## What this does to each path

- **Scheduled runs** (`check.ts`, plan 028): a new race that forms an unreviewed pair fails validation, so it is held back, its page goes back on the to-do list as a failure and reaches the Monday digest after `MAX_FAILURES`. The failure reason names both slugs. It is never published as a duplicate.
- **`edit` / `flush`**: already validate before committing, so a hand-added duplicate is refused with the same message.
- **Main** (CI validate): fails if a pair gets in some other way.

To clear a held race: merge it into the existing race (`edit add --url <keep>@<url>`, or `matchId` in a staged read), or add the pair to `config/not-duplicates.yaml` with the reason it's different.

## Steps

1. `nameSimilarity` moves to `scripts/lib/text.ts` (sync re-exports it). New `scripts/lib/duplicates.ts`: `possibleDuplicates(races, reviewed)` and the YAML loader.
2. `scripts/validate.ts`: one error per unreviewed pair, e.g. `possible duplicate races: a ~ b (2026-11-22, name 0.60): merge with npm run edit -- merge, or list the pair in config/not-duplicates.yaml`.
3. Tests in `test/duplicates.test.ts`: the Galaxy Run pair flags; different provinces don't; a reviewed pair doesn't; a stale entry is ignored.
4. Clear the current tree before the rule lands: merge the real duplicates (the owner decides which), list the rest with a reason. Commit the rule and the cleared tree together, so Main never goes red.
5. Mention it in the `update-race` skill (how to clear a held race) and in this README's index.

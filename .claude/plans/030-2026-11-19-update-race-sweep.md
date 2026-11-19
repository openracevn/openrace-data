# 030: A sweep mode for `update-race`

## Roadmap fit

Serves path step 1, **trusted data** (correct, complete, current), and trust principle 5: Claude's own search and page reads lead (plan 019). The sweep is free: no Firecrawl, no Claude or OpenRouter API, nothing scheduled. It runs only when the owner types it in a session, and it stops before it changes anything. No tension with the constraints or non-goals.

## Why

The schedules (plan 027) find pages and read them, but the work that needs judgment waits until the owner opens a session and names targets: pages that keep failing (Ultra Trail Cao Bằng, 11× 404), possible duplicates (plan 029), missing fields (courses 37%, edition 47%, participants 19% on 2026-11-19), merged organizer names, and races no site we check lists. The owner wants one phrase that finds all of that.

## What it does

`update-race` with no target (or "check the data", "sweep", "what needs work") runs a sweep:

1. `git pull`, then discovery (`npm run check -- --discover`, free). If Schedule 1 already ran today, use the list it made.
2. Collect: the digest (`notify:stale --dry-run`), `state/todo.json`, `npm run gaps`, `npm run validate` (errors and possible duplicates).
3. Look for races we miss: a few web searches for upcoming races in Vietnam, each name checked with `npm run find`.
4. Show one ranked list (target, problem, proposed fix) and **stop**.
5. On the owner's pick, the chosen targets go through the normal skill (sections 1–5): parallel units, staging, one flush.

Pages on the to-do list are not read during the sweep itself; they are list items, read for free once the owner picks them.

## Steps

1. Add a "Sweep" section and the trigger phrases to `.claude/skills/update-race/SKILL.md`.
2. Add this plan to `.claude/plans/README.md`.

## Status

Built 2026-11-19 (skill text only, no code).

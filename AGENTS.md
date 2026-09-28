# openrace-data: notes for agents

Race data for Vietnam: one JSON file per race in `data/races/`, built from sources by the scripts in `scripts/`. The API lives in the sibling repo openrace-api.

## Stay on the road

Before writing a plan or starting non-trivial work, read `.claude/docs/roadmap.md` and check the work against it: its mission, trust principles, path, constraints and non-goals.

- If the work doesn't serve the path, weakens a trust principle, breaks a constraint or hits a non-goal, **say so plainly and ask before going on, even when the user asked for it.** Name the part of the roadmap it conflicts with.
- If the user confirms the change, add a dated line to the roadmap's change log (and update the section it changes) before building.
- Every plan in `.claude/plans/` has a "Roadmap fit" section (see `.claude/plans/README.md`).
- A new question users should be able to ask goes in the roadmap's question table first.

## Where things are

- `.claude/docs/README.md`: the index of working notes. Start with `roadmap.md`, then `status.md`.
- `.claude/plans/`: numbered plans, `NNN-YYYY-MM-DD-topic.md` (highest number + 1), with an index in `README.md`.
- `.claude/skills/`: `backfill-field` for one field across many races (participants), `check-organizer` for organizer entities (splits, duplicates, links), `check-race` for single-race work, `agent-read` for reading races without Firecrawl.
- `scripts/lib/recipes/README.md`: how a site is read, and how to add one.

Firecrawl credits cost money: say the cost before any paid run, and prefer free checks.

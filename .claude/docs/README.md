# Infra notes

Working notes on how openrace-data is wired up. Read these before changing ingestion, the schema or the workflows. The top-level `README.md` is the user-facing overview; these files record the operational state and the reasons behind it.

| File | What's in it |
| --- | --- |
| [roadmap.md](roadmap.md) | **Start here for direction:** the questions OpenRace should answer, their status, and the phases |
| [design-v2.md](design-v2.md) | **The agreed redesign (2026-09-24; steps 1–3 built):** any source, recipes + Firecrawl, price tiers, organizer → series → edition. Wins over decisions.md where they differ |
| [infrastructure.md](infrastructure.md) | Every moving part, where it runs, and how the parts connect |
| [secrets.md](secrets.md) | Every secret and config value: where it lives and whether it's set (names only, never values) |
| [firecrawl.md](firecrawl.md) | Firecrawl API facts verified against their docs, and the traps behind the current design |
| [decisions.md](decisions.md) | Design decisions and deliberate departures from the original spec |
| [status.md](status.md) | What's live, what isn't, known gaps, next steps |
| [2026-09-26-summary-agent-read-backfill.md](2026-09-26-summary-agent-read-backfill.md) | Backfilling plan 008: 2 recipe fixes (vnexpress-marathon venue subpage, irace `#bang-gia`/`irace.vn` fallback, plan 009 built), a duplicate race caught and fixed, plan 010 written for the process gaps that cost the most time |
| [2026-09-25-summary-race-research.md](2026-09-25-summary-race-research.md) | The `race-research` skill built and piloted on Andros The Lakes Race: 5 editions found via Wayback Machine, 4 real code fixes, workflow redesigned mid-session into a finder that hands off to agent-read/check-race |
| [2026-09-24-summary-part-2.md](2026-09-24-summary-part-2.md) | Day summary, part 2: first price batch, openrace-api on schema v2, agent-read |
| [2026-09-24-summary-part-3.md](2026-09-24-summary-part-3.md) | Day summary, part 3: schema v3 and the API live (plans 003 and 004), the six questions answered |
| [2026-09-24-summary.md](2026-09-24-summary.md) | Day summary: design v2 built and checked, 300 races seeded, series |
| [2026-09-23-summary.md](2026-09-23-summary.md) | Day summary: what was built, how the design changed and why, problems found in real runs, commits |

Last updated: end of 2026-09-24. The check-race skill (.claude/skills/check-race) is the quick path for any single-race task; `scripts/lib/recipes/README.md` explains recipes and how to add a site.

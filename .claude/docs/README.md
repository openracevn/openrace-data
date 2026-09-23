# Infra notes

Working notes on how openrace-data is wired up. Read these before changing ingestion, the schema or the workflows. The top-level `README.md` is the user-facing overview; these files record the operational state and the reasons behind it.

| File | What's in it |
| --- | --- |
| [infrastructure.md](infrastructure.md) | Every moving part, where it runs, and how the parts connect |
| [secrets.md](secrets.md) | Every secret and config value: where it lives and whether it's set (names only, never values) |
| [firecrawl.md](firecrawl.md) | Firecrawl API facts verified against their docs, and the traps behind the current design |
| [decisions.md](decisions.md) | Design decisions and deliberate departures from the original spec |
| [status.md](status.md) | What's live, what isn't, known gaps, next steps |

Last updated: end of 2026-09-23. The check-race skill (.claude/skills/check-race) is the quick path for any single-race task.

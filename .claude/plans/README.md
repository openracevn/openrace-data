# Plans

Work plans for a session or an agent, one file each: `NNN-YYYY-MM-DD-topic.md`.

- `NNN` is a running number (001, 002, ...). A new plan takes the highest number + 1. Numbers are never reused.
- The date is the day the plan is for.
- **Every plan has a "Roadmap fit" section** near the top: which roadmap question or path step it serves (`.claude/docs/roadmap.md`), and any tension with a trust principle, constraint or non-goal. If there is tension, the user confirms it and it goes in the roadmap's change log before the plan is built.

| # | Plan | Status |
| --- | --- | --- |
| 001 | [ActiUp 20-race study](001-2026-09-24-actiup-20-races-study.md) (for an external agent) | Done; reviewed in `.claude/docs/study/` |
| 002 | [Upcoming prices, then openrace-api v2](002-2026-09-24-prices-and-api.md) | Part 1: 10 of 41 races read, then stopped by the user to save credits. Part 2 not started. Part 3 done. See `.claude/docs/2026-09-24-summary-part-2.md` |
| 003 | [Schema v3: location, distances, price on a date, and the API](003-2026-09-24-schema-v3-geo-price.md) | Done and live; see `.claude/docs/2026-09-24-summary-part-3.md` |
| 004 | [Build spec for plan 003](004-2026-09-24-plan-003-build-spec.md) (opencode workers, supervised) | Done (stages A–D) |
| 005 | [MCP server](005-2026-09-24-mcp-server.md) (new repo openrace-mcp, small API changes) | Written; next session |
| 006 | [One source of truth for race type values](006-2026-09-25-shared-race-type-values.md) (across openrace-data, openrace-api, openrace-web) | Written; not started |
| 007 | [North/Central/South region as a filterable field](007-2026-09-25-region-filter.md) (across openrace-data, openrace-api, openrace-mcp, openrace-web) | openrace-data steps done: `region` on `data/admin-units.json` provinces and `data/places.json` hubs; openrace-api/mcp/web still to do |

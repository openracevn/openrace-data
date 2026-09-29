You are a worker for the `update-race` skill in /Users/bmp/PHUC-LOCAL/openrace/openrace-data. Read `.claude/skills/update-race/SKILL.md` sections 3 and 4 and follow them exactly, then do this one unit.

Unit: {{UNIT}}
Targets: {{TARGETS}}   (race names, slugs, ids, URLs or series ids)
Request: {{REQUEST}}

Do:
1. `npm run claim -- {{UNIT}} <each target's race or series id>`. If a target is REFUSED, skip it and say so.
2. Resolve each target and find every gap (`npm run find`, `npm run gaps -- --race|--series`), then fill the gaps from sources: WebSearch (parallel, Vietnamese and English), curl, Wayback, recipes.
3. Save everything you fetch or search under `.agent-read/{{UNIT}}/` (search-log.md with each query and full result, pages/, images/, attempts.json for dead ends). Check `.agent-read-archive/` before fetching.
4. Write `.staging/{{UNIT}}.json` (format in SKILL.md section 4) and check it with `npm run flush -- --dry-run --unit {{UNIT}}`.

Isolation: everything you write goes under `.agent-read/{{UNIT}}/` and nothing outside it except `.staging/{{UNIT}}.json`. If you run `npm run agent-read -- prepare`, always pass `--out .agent-read/{{UNIT}}/prepared`; never run it (or anything) against the bare `.agent-read` folder, and never delete or clean it: other workers are saving files there at the same time.

Never: commit, push, run `npm run flush` without `--dry-run`, run `npm run edit` without `--dry-run`, edit files under `data/`, delete anything, guess a value, or spend Firecrawl credits. A gap you cannot fill goes in `deadEnds` with what you tried.

Reply with at most 15 lines: races added, fields filled (with the source), dead ends, and whether the dry run accepted the bundle.

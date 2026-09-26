# Plan 010: agent-read process hardening (source-finding order, duplicate guard, safe merge, price pre-fill)

## Roadmap fit

Serves path step 1 ("Trusted data. Any source (sellers, hubs, race sites), recipes,
agent-read, price tiers...") and two trust principles directly: principle 1 ("every
fact traces to a source... nothing is invented") and principle 6 ("Automated, not
reviewed... validation and sanity checks do the reviewing before anything is
committed"). The duplicate-race incident this plan responds to is exactly principle 6
failing to catch a mistake before commit. No tension with a constraint or non-goal —
this is tooling/process hardening around agent-read, not new scope.

## Why

Backfilling 5 races from plan 008 (2026-09-26) surfaced a repeatable process, but it
took much longer than it should have, and one step nearly shipped bad data:

1. **No written order for where to look for a missing price/venue.** Found
   `vm.vnexpress.net`'s `/thong-tin-cuoc-dua` subpage and `irace.vn/su-kien/<slug>` by
   ad hoc searching (the user searching by hand, then me verifying by curl), not by
   following a checklist. Next session re-derives this from scratch.
2. **A duplicate race nearly shipped.** Adding `techcombank-ha-noi-marathon`'s
   `irace.vn` source created a *second* race instead of merging: `sync.ts`'s
   name-similarity (official Vietnamese name vs. irace.vn's English title) scored
   0.575, under the 0.65 `MATCH_THRESHOLD`, even though the race day matched exactly.
   The dry-run's `+` (new race) vs. `~` (merged) distinction is easy to miss in a
   busy diff — this one was caught by reading the output carefully, not by any guard.
3. **A local edit doesn't steer `--commit`.** Tried to nudge the merge by hand-editing
   local `data/index.json`'s `sourceUrls` before running `agent-read commit --commit`.
   Had no effect: `syncToGitHub` reads current state from the GitHub API, not local
   files. Cost a full extra round-trip (create the duplicate, discover it, merge
   `sources[]` by hand, fix `index.json`, `npm run renormalize -- --commit`) before it
   was fixed, live, in commits `3e176db`/`0c4c5a4`.
4. **Price transcription is still fully manual**, even for a page whose price table is
   already a real HTML `<table>` (`ticket.irace.vn`, `irace.vn/su-kien/<slug>`) — every
   number typed by hand into `read.json`, across two races and 24 tiers total this
   session.

## Decisions made (this conversation)

- Write the source-finding order into the `agent-read`/`check-race` skills, not just
  this plan, so it's the default the next session follows without being told again.
- The duplicate-race guard and the local-edit trap both get fixed in `agent-read.ts`
  itself (code + docs), not left as things to remember by hand.
- The price pre-fill is scoped to irace's two text-table page shapes only (the ones
  read this session), not a general table-to-JSON parser for every recipe.

## Changes

1. **Source-finding checklist** (`.claude/skills/agent-read/SKILL.md`,
   `.claude/skills/check-race/SKILL.md`): when a race's known source(s) have no
   price/venue, check in this order before treating it as "no source available":
   - a subpage on the *same* site (the recipe may only read one page; check for an
     info/price tab like `/thong-tin-cuoc-dua`) — free, and worth a recipe fix if found,
     not a one-off read.
   - `ticket.irace.vn/<slug>` — free, text table, no OCR.
   - `irace.vn/su-kien/<slug>` — free, usually a text table (`.eventon_desc_in`), but
     never auto-discovered; a manual search.
   - ActiUp / `irace.vn`'s old poster images — last, since it costs Firecrawl OCR
     credits (or an agent's own eyes on an image).
2. **Duplicate-race guard** (`scripts/agent-read.ts` or `scripts/sync.ts`'s dry-run
   formatting): when a `--race <url>` input's `planSync` result is a new race (`+`),
   also compute and print its `nameSimilarity` against every same-day candidate, even
   under `MATCH_THRESHOLD` — so "this scored 0.575 against an existing race the same
   day" is visible in the dry run, not just a bare `+ <name>` line indistinguishable
   from a genuinely new race.
3. **A real "attach source to an existing race" operation**, replacing the local
   `index.json` hand-edit that turned out to have no effect: fetches current index
   state (same source `syncToGitHub` reads), adds the URL to the right race's
   `sourceUrls`, and is safe to run before `agent-read commit --commit` so the match
   succeeds on the first try. Exact shape (new script vs. an `agent-read` flag) to be
   decided during implementation.
4. **Price pre-fill for irace's text tables**: a small parser in
   `scripts/lib/recipes/irace.ts` (or a `agent-read.ts` helper) that reads the
   `#personal`/`#bang-gia`/`.eventon_desc_in` table structure (rows = distance, columns
   = tier with dates in the header) and writes a draft `prices` array into `read.json`
   directly, so the agent verifies against the table instead of hand-typing every
   number. Scoped to these two page shapes; ActiUp/irace.vn poster images still need a
   human or Firecrawl OCR.

## Open questions

- Exact form of item 3 (new script, or a flag on `agent-read.ts`) — decide during
  implementation, not blocking the write-up.
- Whether the duplicate-race guard (item 2) should also refuse `--commit` outright
  above some similarity floor (e.g. same day + score > 0.5) rather than only warning,
  once it's seen a few more real cases.

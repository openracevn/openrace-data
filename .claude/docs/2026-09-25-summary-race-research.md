# Day summary: 2026-09-25 — race-research built, piloted on Andros The Lakes Race

New skill: [`.claude/skills/race-research/SKILL.md`](../skills/race-research/SKILL.md). Piloted end-to-end on one race (Andros The Lakes Race / The Lakes Race), which found 5 missing editions, fixed 2 pre-existing bugs in that race's own data, and — because the pilot kept breaking things — led to four real code fixes and a substantial rewrite of the skill itself. Current state: [status.md](status.md).

## What race-research is

`check-race`/`agent-read` read **one race's current listing on one known site** (a recipe). race-research goes wider: given a race by name, it searches the open web (and, critically, the Wayback Machine) for every edition that's ever run and every independent account of it — for gaps a recipe can never reach (old, often-dead ticket reseller pages; an organizer's own site from before it was overwritten for next year).

It ended the day defined as **a finder and completeness auditor, not a one-shot backfill**:
- Every run re-walks *every* existing edition (missing price, approximate date, no distances, unnumbered edition next to numbered siblings, thin sourcing, open conflicts) — not just new ones. Repeated runs are expected to make a race's record more trustworthy over time, not just look for what's new.
- Discovery and judgment (WebSearch, reconciling conflicting sources) stay with Claude. Delegate the mechanical part — reading fetched raw pages into structured JSON — to one opencode worker per batch.
- **When a found/audited race sits on a site we already have a recipe for** (ActiUp, VnExpress Marathon, a race-site), race-research's job for it is done once found: hand off to `agent-read` (free) or `check-race` (paid) for the real collection. This was a hard-learned rule, not a starting assumption — see below.

## What the pilot found on Andros The Lakes Race

- Went from 3 tracked races to 9: editions 1 (2019-04-07), 2 (2019-10-20), 3 (2020-11-15), 4 (2022-05-15), 5 (2023-06-04) added; 6/7/8 (already tracked) corrected.
- The organizer's own site (`androslakesrace.com`, live is "Coming Soon") had a "Previous Editions" page only reachable via Wayback Machine — it resolved every remaining doubt in one read: confirmed Edition 1 (previously an unlinked, doubted record with a conflicting date from another source), and numbered Editions 4 and 7 (previously left null after two of my own guesses were caught and reverted).
- 2026's own listings disagree by one day (2026-04-18 vs 2026-04-19) — surfaced automatically as `confidence: "conflicting"` by `reconcile.ts` once both sources were added, no manual step needed.
- Found no evidence anywhere of a cancelled edition, despite Vol 4 being pushed from a planned 2021-05-16 to 2022-05-15 (most likely Covid) — a real one-year gap, not a bug.

## Problems found in real runs (all fixed same day)

- **`edit -- add` always tagged a hand-entered source `"openrace"`**, even when the URL belonged to a site `config/sites.yaml` already recognized — the site lookup was only used to *refuse* recipe-covered URLs, then discarded. Fixed to tag with the recognized site's key.
- **...and when no site is recognized, it still said `"openrace"`** instead of using the domain sitting right there in the URL — user-flagged directly after seeing it on the live site ("why does a source need to be listed in sites to appear as a source?"). Fixed: `siteKeyForUrl()` now falls back to a slug of the URL's own host (`123go.vn` → `123go-vn`), never a placeholder. `validate.ts`'s site-registry check now only applies to official/seller sources and registrations (which only ever come from a real recipe read or a recognized link) — a reference source never needed a special-cased escape value in the first place.
- **Two hand-added sources on the same race can silently create a duplicate race instead of joining it**, when both fall back to a shared generic site tag (`sync.ts`'s name-matching explicitly skips a candidate that already has a source on the same site — by design, to avoid false merges, but it backfires when the "same site" is really just "no site recognized"). Root-caused to Wayback Machine URLs never being recognized by hostname (`web.archive.org`, not the site actually archived). Fixed `hostOf()` to unwrap a Wayback URL to the original site first. Two stray duplicate races from this bug were caught (via checking the `add` output named the expected race, not a new slug) and cleaned up with `git revert`.
- **No way to remove a stale duplicate source** once one existed (from the tagging fix above: re-adding the same URL under its new correct tag left the old one behind, since sources are matched by site+url together). Added `npm run edit -- drop-source <race> <site> <url>`.
- **Two of my own inferred edition numbers** ("this is between Vol 6 and Vol 8, so it must be Vol 7") were written and then caught and reverted — inferring from sequence position is the same guessing the skill already forbids for dates, just dressed as arithmetic. `unset` doesn't remove a value baked into an `add`'s own facts (only overrides); needed `set edition null` instead.
- **Prices went missing on the 3 most recent editions** (all ActiUp-backed) because race-research tried to extract them itself with `curl`, which gets static HTML only — never ActiUp's price image, never a JS-rendered table. This is what led to the "finder, not backfill" redesign: a recipe-covered gap now gets handed to `agent-read`/`check-race`, never DIY'd.

## Schema/data additions

- `data/series.json` entries gained a `description` field (hand-written, `null` by default) — for series-level findings (edition count, gaps, why a year is missing) that don't belong to any one race's `sources[]`. Filled in for Andros.
- `registrationStatus` gained `"cancelled"`, distinct from `"closed"` (registration simply ended) — schema had no way to record an edition being called off; none of Andros's turned out to need it, but the gap was real.
- `config/sites.yaml`: `androslakesrace.com` (the race's own official site, `recipe: none` since it's live-dead), plus `ticketbox`, `raceez`, `ticketgo` registered as sellers (link-recognition only), and `app.irace.vn` added to iRace's hosts.

## How the workflow design changed mid-session

| Version | What it did |
| --- | --- |
| First (built, then piloted) | One-shot: find missing editions for a race, add them, stop. Did its own extraction for every source regardless of whether a recipe existed. |
| After the pricing gap was noticed | **Finder + auditor.** Every run re-walks every existing edition for completeness (price/date/distances/edition/seriesId/confidence), not just new ones. Hands off to `agent-read`/`check-race` whenever a recipe applies; only extracts by hand for sources with none. |

Confirmed explicitly: `agent-read` itself stays source/recipe-driven only (no independent web search) — giving it that would duplicate race-research's own job with a second, divergent implementation, and would break its coordination with the scheduled Firecrawl run (agent-read's fingerprint cache in `state/checks.json` only makes sense for recipe-read pages; an arbitrary web-researched source has no fingerprint to coordinate with).

## Commits

openrace-data: f6dc81f new skill · 6ab1eb4 tag recognized sites · ac400df…5c6a4f5 the 5 new editions + edition/seriesId corrections (several reverted: a1384e3, f401acb, 8ff72ba, 300a8af) · 0c075c2 series.description + registrationStatus cancelled · 15bd935 Wayback host unwrapping · 947cfc1 drop-source command · 2c19607…5bac996 duplicate-source cleanup (6 races) · d233523 domain-slug fallback instead of "openrace" · 76d5a91 + b2cfa84 + 418012a skill rewrites (finder/auditor, Wayback-first, known limitations).

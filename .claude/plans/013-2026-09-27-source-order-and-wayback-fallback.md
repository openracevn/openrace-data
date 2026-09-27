# Plan 013: a fixed source order, a Wayback fallback at every tier, and a checked archive

## Roadmap fit

Serves trust principle 5 ("We learn how organizers publish... studied first, then read
with a recipe") and the budget constraint (irace's HTML price tables are free reads;
ActiUp's images cost Firecrawl OCR credits or agent token time — plan 009 already
decided irace should be preferred for exactly this reason). It also serves principle 6
("Automated, not reviewed... validation and sanity checks do the reviewing before
anything is committed") indirectly: a process that gives up on the first empty fetch,
when a human re-asking or a manual web search reliably finds the price, is not yet
something that can run end-to-end without supervision — this plan is about closing that
reliability gap. No tension with any trust principle, constraint or non-goal.

## Why

The user's complaint, in their own words: "each race research cost a lot of resources
(tokens, time) and there's never a run that can run from A to Z without my supervision,
making this process not reliable for automation... when finding price, it does not try
with Wayback and usually stops when the first fetch has no results, while prices might
be hard to find but it is obviously available data — most of the time when I ask again,
or I do a web search myself, I would get the price."

This checks out against the actual skill files:

- `check-race`'s step 2 checklist (`.claude/skills/check-race/SKILL.md:37-41`) is:
  1. a subpage on the same site
  2. `ticket.irace.vn`
  3. `irace.vn/su-kien/<slug>`
  4. ActiUp/irace.vn poster images (Firecrawl OCR or read by eye)

  No Wayback step anywhere in it, despite `race-research`'s step 1.5 treating Wayback
  as **mandatory**, not optional, for exactly this kind of gap (missing price/venue on
  a page that used to have it). A single-race check today has no equivalent step, so it
  stops at "no source has this" one tier too early.

- `agent-read`'s "check in this order" list (`.claude/skills/agent-read/SKILL.md:20-24`)
  is the same four steps, same gap.

- Neither list names "the race's own/organizer site" as its own tier — it's folded
  into "a subpage on the same site," which is ambiguous about which site that even is
  (the known source could be ActiUp *or* the organizer's own site).

- The order that exists today doesn't consistently rank irace ahead of ActiUp. Plan 009
  already established the reason to prefer irace: `ticket.irace.vn`'s price table is
  real HTML text, no OCR needed, while ActiUp (and `irace.vn`'s own write-up) carry
  prices as **images** — Firecrawl credits or an agent's own token-expensive image read.
  That preference needs to be the *first* thing the checklist says, not implied by
  where each site happens to sit in a four-item list.

- **A second, related gap: raw fetches aren't all saved, and nothing checks for them
  before re-fetching.** `agent-read`'s normal flow (`.agent-read/` → archived to
  `.agent-read-archive/<date>-<slug>/`) and `race-research`'s `raw/` folder both save
  every page and image they touch, including dead ends, and archive on the way out. But:
  - `check-race`'s step 2 checklist only writes a one-line narration per step into
    `attempts.json` (`.claude/skills/check-race/SKILL.md:45-56`) — never the actual
    fetched HTML or downloaded price image. A `check-race` run today leaves a text
    description of what happened, not the evidence itself.
  - **None of the three skills check `.agent-read-archive/` before fetching.** Only
    `race-research` even mentions it, and only as a "known tool limitations" aside near
    the bottom of the file (`.claude/skills/race-research/SKILL.md:188`), not as an
    early step. `check-race` and `agent-read` have no such instruction at all. So a
    page already fetched (and paid for, in tokens or credits) in an earlier session can
    get fetched again for no reason, and — worse — a second, possibly different fetch
    can silently replace the one an earlier commit was actually based on.
  - This matters more once this plan adds Wayback fallbacks at every tier: more fetches
    per race means more chances to redundantly re-fetch something already on disk from
    a prior run, unless checking the archive first becomes a first step, not an aside.

- **A third gap: exhausting the fixed site list ends the search, instead of widening it.**
  Today, once `check-race`/`agent-read`'s checklist comes up empty, the field is left
  null and that's the end of it — there's no step that says "now web-search for a page
  we don't already know about." `race-research` already does exactly this (step 2:
  `<race name> lần thứ`, `<race name> vol <n>`, `site:irace.vn`, etc., varying phrasing
  since organizers rarely use the same word twice), but only as its own separate,
  heavier skill — not as a fallback inside `check-race`/`agent-read`. The user's own
  experience confirms it's usually findable this way: "most of the time when I ask
  again, or I do a web search myself, I would get the price." A checklist that never
  tries the one thing that reliably works is why runs stall on a supervisor's manual
  follow-up instead of finishing on their own.

## Decisions made (this conversation)

- **Fixed tier order, confirmed with the user:**
  1. irace (`ticket.irace.vn` first, `irace.vn/su-kien/<slug>` second — both free HTML text)
  2. irace, Wayback snapshot (if the live irace page 404s, or exists but lacks the field)
  3. Main/organizer site (the race's own site, including any info/price subpage the
     recipe might not read — this absorbs the current "subpage on the same site" step)
  4. Main site, Wayback snapshot
  5. ActiUp (price image — OCR or read by eye; last, because it's the most expensive)
  6. ActiUp, Wayback snapshot
  7. **Web search** (`WebSearch`, varying phrasing as `race-research` step 2 already
     does) for any other page — a reseller, a news article, a blog recap — that states
     the field. Only after this comes up empty (or every hit is checked and none has
     it) does "no source has this" become true. Any promising hit found here is fetched
     and saved the same way as every other tier (below), and, if it turns out to be on
     a site `config/sites.yaml` already has a recipe for, handed to that recipe going
     forward rather than treated as a one-off (same handoff rule `race-research` step
     1.1 already states).
- **A tier is not "checked" until its Wayback fallback is also tried**, when the live
  fetch at that tier came back empty, 404, or missing the field. Skipping straight to
  the next tier without trying Wayback first is the exact failure mode reported.
- **This order applies to `check-race` and `agent-read`.** `race-research` already has
  its own (correct, more thorough) Wayback discipline in step 1.5 — it gets a
  cross-reference to this same tier order for consistency, not a rewrite.
- **The orchestration (tiers 1–6) is a new script, not just prose the agent re-derives
  each run.** Checking the archive, fetching each fixed-site tier in order, only
  advancing when a tier is actually empty, saving raw output to the right folder, and
  writing `attempts.json` are all mechanical — no judgment involved — so they belong in
  code the same way `validate`/`renormalize`/`gaps` already are, not in three skill
  files' worth of hand-followed instructions an agent can skip a step of under token
  pressure. This is the direct fix for the "not reliable for automation" complaint:
  the fixed part of the search becomes something that either ran correctly or didn't
  (checkable), instead of something an agent narrates doing.
  - New `scripts/find-sources.ts` (`npm run find-sources -- <race url|slug|id>`):
    given a race, runs tiers 1–6 in order against `.agent-read-archive/` first (skip
    a tier already archived for this race, any date), then irace, irace Wayback, the
    main site, main site Wayback, ActiUp, ActiUp Wayback — stopping early only when a
    tier's fetched content actually contains the field being looked for (a `--field
    <name>` flag; default is "any of prices/venue/city/organizer missing"). Saves
    every fetch into `.agent-read-archive/<date>-<race-slug>-source-check/<tier>/`
    and writes `attempts.json` itself, in the format `check-race` already defines.
    Prints a short summary: which tier (if any) resolved it, or "none of 1–6 — try a
    web search" when all six come up empty. Tier 7 (`WebSearch`) stays manual/agent-run
    — it needs judgment on which hits are worth following, and `WebSearch` isn't
    scriptable from `scripts/` — but its result still gets saved into the same folder
    (`web-search-hit-<n>/`, `search-log.md`) by hand, per the structure below.
  - New `scripts/find-race.ts` (`npm run find -- <query>`): promotes the inline
    `python3 -c "..."` one-liner `check-race` step 1 and `race-research` step 1 both
    currently ask an agent to retype into a real, tested script — same query, same
    output shape (id, slug, date, name, sourceUrls), removing the small chance of a
    transcription slip and the token cost of re-deriving it each run.
  - Both scripts are read-mostly: `find-race.ts` never writes; `find-sources.ts` only
    writes into `.agent-read-archive/` (gitignored, never committed) — no interaction
    with `data/` or GitHub, so there's no new commit-safety surface to reason about.
- **`check-race`'s checklist saves every fetch's raw bytes, not just a narration.**
  One folder per tier under the same `.agent-read-archive/<date>-<race-slug>-source-check/`
  directory it already writes `attempts.json` into:
  ```
  .agent-read-archive/<date>-<race-slug>-source-check/
    attempts.json
    search-log.md        (only if step 7 ran: every WebSearch query + full result)
    irace/                page.html
    irace-wayback/        page.html
    main-site/            page.html   (+ any price image)
    main-site-wayback/    page.html
    actiup/               page.html  image-1.jpg
    actiup-wayback/       page.html
    web-search-hit-1/     page.html  (any promising page step 7 turns up, one per hit)
  ```
  A tier that wasn't reached (checklist stopped earlier because an earlier tier found
  the field) has no folder — same as `attempts.json` already skipping steps that didn't
  apply. `search-log.md` follows `race-research`'s own convention (append query + full
  result right after the call, before judging whether the hit was useful).
- **All three skills check `.agent-read-archive/` before fetching**, not just
  `race-research`, and as an explicit early step in each skill's flow, not a buried
  aside. Before any `curl`/Wayback fetch: look for an existing archived copy of that
  exact URL (same date-or-later folder, matching tier name) and read that first; only
  hit the network for a URL (or a page section, e.g. a different tab) not already saved.
  This is the same discipline `race-research` already states at
  `.claude/skills/race-research/SKILL.md:188`, just promoted from "known tool
  limitations" to a first-class early step, and extended to `check-race`/`agent-read`.

## Changes

- New `scripts/find-race.ts` and `scripts/find-sources.ts` (see the two bullets above)
  plus `"find"` and `"find-sources"` entries in `package.json`, next to
  `validate`/`renormalize`/`gaps`.
- `.claude/skills/check-race/SKILL.md` step 1 and step 2:
  - Step 1: replace the inline `python3 -c "..."` one-liner with
    `npm run find -- <url, slug or id fragment>`.
  - Step 2: replace the four-item checklist (lines 37-41) with:
    `npm run find-sources -- <race url|slug|id>` to run tiers 1–6 (archive check,
    irace, irace Wayback, main site, main site Wayback, ActiUp, ActiUp Wayback,
    stopping early on a hit, everything saved and logged automatically) — then, only
    if it reports none of 1–6 resolved the field, tier 7: web search by hand (`WebSearch`,
    varying phrasing as `race-research` step 2 does), saving each promising hit into
    the same `.agent-read-archive/<date>-<race-slug>-source-check/web-search-hit-<n>/`
    folder and its queries/results into `search-log.md` there.
  - Update the "hard stop" paragraph (line 37, "Only after all four turn up nothing
    does 'no source has this' become true") to say seven tiers, and to point at
    `find-sources.ts`'s own summary output as the check for whether 1–6 are truly
    exhausted, rather than an agent tracking that by hand.
  - `find-sources.ts` writes `attempts.json` itself for tiers 1–6; the skill only adds
    entries by hand for tier 7 (web search), same shape as today's example.
- `.claude/skills/agent-read/SKILL.md`:
  - Replace the "check in this order" list (lines 20-24) with: run
    `npm run find-sources -- <race url|slug|id>` for tiers 1–6, then tier 7 (web
    search) by hand if it reports nothing, same as `check-race` above.
  - Note that the normal recipe-driven `.agent-read/` flow (`prepare`/`commit`) is
    unaffected — `find-sources.ts` is for the ad hoc "this field is still missing,
    where else could it be" case the current "check in this order" list already covers.
- `.claude/skills/race-research/SKILL.md`:
  - Step 1: replace its own inline `python3 -c "..."` block with
    `npm run find -- <race name fragment>` (same script as `check-race`, wider query).
  - Step 1.5: add a one-line cross-reference noting `find-sources.ts` runs this same
    irace-before-main-site-before-ActiUp order for a single race/field, so a
    race-research pass and a single-race check don't quietly disagree on source
    preference — this skill can call it too for a specific gap (step 1's checklist)
    instead of hand-rolling the same `curl`/CDX sequence.
  - Promote the existing "Check `.agent-read-archive/` before re-fetching anything"
    note (currently under "Known tool limitations", line 188) up to step 1 or 1.5, as
    a first step rather than an aside — content unchanged, position only. (This is
    also just what `find-sources.ts` already does automatically for tiers 1–6; the
    promoted note now mainly covers this skill's own wider, non-tiered fetching.)
  - No other structural change — its raw-saving and Wayback discipline (steps 1.5, and
    the "save everything" rule) are already ahead of the other two skills; this plan
    brings them up to it via the shared script, not the reverse.
- `scripts/lib/recipes/README.md`: add a short note in the site table or nearby prose
  naming this same order as the reason irace is preferred over ActiUp, linking back to
  plan 009's rationale (HTML text vs. image OCR), and pointing at `find-sources.ts` as
  where the order is actually enforced (not just documented).

## Open questions

- None blocking. If a future site is added that also splits across "text tier" vs.
  "image tier" (like irace vs. ActiUp), it should slot into this same seven-tier
  pattern (six fixed-site tiers + web search) rather than getting its own bespoke order.

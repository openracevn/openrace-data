---
name: update-race
description: The one skill for finding and fixing race data in openrace-data. Use for any request to update, check, fix, complete, add, research or backfill races or a series, e.g. "update race A, race B, series C", "check this race", "add this race", "find all editions of X", "fill the gaps", "what's missing on X", or a race URL, slug or id. Claude leads with its own web search and page reads, works units in parallel, stages the results and commits once.
---

# Update races (plan 019)

The user says `update race A, race B, series C`. You decide what each target needs, find all the data you can, and **commit once at the end**. You never make the user name a sub-skill or spot the gaps themselves.

Read `.claude/docs/roadmap.md` first (trust principles). Firecrawl is **opt-in**: use it only when the user asks, and say the cost first. Everything below is free.

## 1. Resolve each target into a unit

For each name, slug, id or URL:

```bash
git pull -q
npm run find -- "<fragment>"            # existing race? (also a WebSearch for names that don't match)
npm run gaps -- --race <slug>           # per-race checklist: ✓ ok, ✗ gap, · info
npm run gaps -- --series <series-id>    # editions on record, missing years / edition numbers / shortfall, then every edition's checklist
```

- **Existing race:** audit every field, fill every ✗.
- **Unknown race:** find it (WebSearch), add it, then audit it.
- **Series:** list every edition (organizer history page, Wayback, resellers), compare with `statedEditionCount` and the year gaps, add missing editions, audit each edition. `statedEditionCount` and `description` live in `data/series.json` and have no edit command yet: report what you found and tell the user; don't hand-edit the file.

One unit = one race or one series. Name it `<slug>` in lowercase-with-dashes (`^[a-z0-9][a-z0-9-]*$`).

## 2. Orchestrate

- **1–2 units:** work them yourself, one after the other, using section 3.
- **3 or more units:** spawn one subagent per unit, **all in one message so they run in parallel** (`Agent`, `general-purpose`, prompt = `.claude/skills/update-race/worker-prompt.md` filled in with the unit and its targets). Workers write only untracked files (`.staging/`, `.agent-read/`) and never commit, so they share this checkout: no worktree is needed. A manually opened extra session in a worktree also works: the workspace folders are anchored to the main checkout.
- **Claim before starting** so a second session skips the same target:
  ```bash
  npm run claim -- <unit> <race-id-or-series-id> [...]     # exit 1 + REFUSED line if another unit holds it
  npm run claim -- --list
  ```
  Skip or wait on a refused target. Claims expire after 2 hours; flush releases them.
- Free opencode models (`opencode-delegate`) are optional, for bulk mechanical extraction only (reading many price tables). You verify what they return.

## 3. Work a unit (source order for each gap)

1. **`WebSearch`**, several queries in parallel, Vietnamese and English (`<name> lần thứ`, `<name> <year> giá vé`, `<name> irace`, `<name> số người tham gia`).
2. **`curl -sL -A 'Mozilla/5.0'`** (or `WebFetch` for a quick read) on the promising hits. Look at price images yourself (download, then Read).
3. **Recipes and `npm run find-sources -- <race> [--field prices]`** for sites that have one (ActiUp, iRace, VnExpress Marathon, race sites in `config/sites.yaml`). A live URL on a recipe site is not added by hand: read it with `npm run agent-read -- prepare --race <url|slug|id>` (see `refs/agent-read`). **Always `--out .agent-read/<unit>/prepared`**: the folder `.agent-read/` is shared by parallel workers, and each unit stays inside its own subfolder.
4. **The event's own organizer or brand site**, even when a seller (ActiUp, iRace) is already known. A seller often shows only a from-price while the organizer's page lists every tier in text (IronKids/Sunrise Sprint: `ironman.com/races/im703-phu-quoc/...`). Look at price images on ticket pages before calling prices a dead end.
5. **Wayback** at every step: `https://web.archive.org/web/2id_/<url>`, CDX listing for a snapshot inside the sale window (`refs/race-research` step 1.5). A live page showing nothing proves nothing about what it once showed.

Rules that never bend (roadmap trust principles):
- **Every fact traces to a source.** A fact from a search snippet needs the page fetched and saved; a count with no quote is stored as `low` confidence. Facebook is a link, never a source.
- **A gap stays a gap** (`null`, never 0, never a guess, no edition number by arithmetic). Sources that disagree become a flag, not a silent pick.
- **Nothing is deleted or lost.** Save every fetched page, Wayback snapshot, CDX listing, price image and every `WebSearch` query with its full result under `.agent-read/<unit>/` (`search-log.md`, `pages/`, `images/`). Check `.agent-read-archive/` before fetching anything.
- **Stopping rule:** every ✗ is either filled from a source or logged in `.agent-read/<unit>/attempts.json` as a dead end with what was tried. `npm run gaps -- --race <x>` is how you know you are done. "Not found" only after digging (retry a failed fetch, Wayback, a second wording, a different outlet).
- `prices[].site` must equal one of the race's own `sources[].site`; `add` gives you that for free.
- **Shape prices for the price table** (course × phase): each tier needs the course's `distance` (a valid label such as `10km` or `Sprint`, not a category name) and a phase in its name (`Early Bird`, `Regular`, `Late`) or an explicit `kind` (`early`/`regular`/`late`) in a `prices` override. Tiers with distance `null` and no phase word collapse into one cell, and `group` (relay/team) tiers are not shown. The column header is the tier's own text. Ages have no field: put them in the override reason.
- **`reference` sources don't override a seller's fields**: a value only a reference source states (a city) needs a `set-many` override.
- **A location change needs its geo entry first.** `state/geo.json` is keyed by location; a new venue/city has no entry, so the edit loses the point. Geocode the new location, commit `state/geo.json` first (`--also`), then the location edit in a second flush; or re-apply the location afterwards. If the geocoder returns a wrong point (it can ignore the city), set `geo` by hand from a point already stored for the same place. Don't run `npm run geo` to look at things: it rewrites `state/geo.json`.
- **Don't use `renormalize --commit` for a batch**: in the pilot it re-added an orphan series entry and broke `validate`.
- Field details, value shapes and per-field rules: `refs/check-race/REFERENCE.md` (overrides, prices, location, geo), `refs/backfill-field/REFERENCE.md` (participants: what counts, quote and verify), `refs/check-organizer/REFERENCE.md` (organizer splits, links).

## 4. Stage, never commit

Write the unit's results as a bundle, `.staging/<unit>.json` (in the main checkout):

```json
{
  "unit": "hcmc-marathon",
  "summary": "audit hcmc-marathon: 2 missing editions, editions numbers",
  "ops": [
    { "op": "add", "url": "https://…organizer page or Wayback snapshot…", "reason": "organizer's 'Previous editions' page",
      "fields": { "name": "…", "date": "2017-01-15", "types": ["road_run"], "distances": ["5km","42km"], "venue": "…", "city": "…", "organizer": "…", "prices": [] } },
    { "op": "add", "attachTo": "hcmc-marathon-2019", "url": "https://web.archive.org/web/…/…", "reason": "Wayback of the sale window", "fields": { "name": "…", "date": "2019-01-13", "prices": [ { "distance": "42km", "tier": "Early Bird", "from": "01/09", "to": "30/09", "price": 1200000 } ] } },
    { "op": "set-many", "race": "hcmc-marathon-2018", "fields": { "seriesId": "hcmc-marathon", "edition": 5 }, "reason": "organizer's history page states edition 5" }
  ],
  "deadEnds": [ { "target": "hcmc-run-2015", "field": "participants", "tried": "3 searches, Wayback of hcmcmarathon.com 2015; no count stated" } ]
}
```

- `add`: a race or edition from a reference page (same fields as `npm run edit -- add`; `name` and `date` required). `attachTo` forces the source onto that existing race (a Wayback snapshot, or any page whose race you already know). Never reuse one URL as the source of two different editions.
- `set-many`: overrides on one existing race, several fields at once, with the reason and where it came from.
- `source`: a page already read, as a sync input `{ "op": "source", "input": { url, site, role, extracted, checkedAt } }` (an agent-read result).
- New series: add the entry to `data/series.json` (sorted by id; organizerId must exist) and commit it in the same commit as the races that use it: `npm run flush -- --also data/series.json`. A series with no races fails `validate`.
- Check your own bundle: `npm run flush -- --dry-run --unit <unit>` plans it and runs `validate` on a temporary tree. Fix a ✗ REJECTED before reporting.

## 5. Flush once, then report

When every unit is staged (or finished with dead ends only):

```bash
git pull -q
npm run flush -- --dry-run                       # every bundle: ✓ accepted, = nothing new, ✗ rejected with the reason
GITHUB_TOKEN=$(gh auth token) npm run flush      # ONE commit for all accepted bundles
```

- One flush is one commit, one Main run and one Discord line however many races are in it. Planning reads race files through the GitHub API (a `set-many` reads about 3 paths; `add` and source ops read more, an earlier measurement gave ~400), so batch rather than commit per race. The user asked for the update: commit.
- After the commit, check the pages: `npm run gaps -- --race <x>` for each target, and `npm run validate`.
- A rejected unit is left out; the rest still commit. Fix it and stage it again, or report it.
- Afterwards each unit's bundle and working folder are in `.agent-read-archive/<date>-<unit>/` with a `status.json`, and its claims are released. Never `rm -rf` these.
- Push: if the work also changed code or docs, commit those normally and `git push`.

**Report** per unit: races added (with sources), fields filled (with the source), dead ends (what was tried), rejected bundles and why, the commit, and anything the user must do (series `statedEditionCount`, a Facebook-only fact). Say plainly what stayed unknown.

## Old skills

`check-race`, `agent-read`, `race-research`, `backfill-field`, `check-organizer` and `opencode-read` live under `refs/` as reference documents. They no longer trigger on their own. Their scripts (`agent-read`, `check`, `edit`, `find-sources`, `backfill-verify`) are unchanged and are what this skill calls.

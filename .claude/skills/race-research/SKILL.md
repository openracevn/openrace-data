---
name: race-research
description: Deep, multi-source research on one race — a finder and completeness auditor, not a one-shot backfill. Find every edition (past and current) and every independent source (the race's own site, old ticket resellers like iRace/TicketBox/Raceez, news and blog coverage), add missing editions, and re-audit editions we already track — sources, price, date, distances — beyond what agent-read/check-race read from their one primary source. Use when the user names a race and asks to "study" it, find its full history, check how many editions it's really had, double-check it against other sources, or re-run research to deepen trust in what's already there. Facebook is never a source here, only a link. Not for a normal re-check of a race's current listing (use check-race) or for reading a recipe site's regular pages (use agent-read) — this skill calls those in when a found/audited race turns out to be on a site they cover.
---

# Research a race across the whole web

`check-race` and `agent-read` read **one race's current listing on one known site** (a recipe). This skill goes wider: given a race by name, it searches the open web for every edition that's ever been run and every independent account of it, so gaps in our data (missing past editions, an unverified price, a wrong venue) get filled or confirmed from sources outside the usual pipeline. It is manual/agent-driven research, not a recipe — there is no site to automate here, each source is different and read once.

**This is a finder, not a one-shot backfill.** Its job is to notice a race/edition exists and get it into the database — then, once found, hand off the actual full collection to `agent-read`/`check-race` whenever the race turns out to be on a site they already cover, since those read prices (including from images) properly and this skill's own `curl`-based fetching can't. Only for a source with no recipe at all (a dead reseller, an archived page) does this skill do the full collection itself.

**Every run should make the data more trustworthy than the last one**, not just look for what's new. Re-running this on a race you've already researched should re-walk every existing edition — not only check for a new one — since a later run may turn up a source that resolves an old gap or conflict (this is exactly how Andros's Edition 1 went from "doubted, unlinked" to "confirmed" mid-session, from a source found on a *later* pass).

This is slower and costs more of your usage per race than agent-read, because judgment (which source to trust, is this a new edition or the same one postponed) can't be delegated. Use it on request, per race — not as a batch job across the whole catalog.

Background: `.claude/docs/roadmap.md` (trust principles — every fact traces to a source, uncertainty becomes `flags`/`confidence`, never invented), `scripts/lib/reconcile.ts` (how sources are picked), `scripts/edit.ts` (the only way to write `data/races/*.json` by hand).

## Rules

- **Keep every source.** Every page you read becomes one `sources[]` entry (via `npm run edit -- add`, role `reference`) with its own `extracted`, never merged away. That's what lets the user double-check your work later.
- **Facebook is a link, never a source.** If a race has a Facebook page, it goes in `links` with `kind: "facebook"`. Don't try to fetch or extract facts from it.
- **Collect prices if the source has them; don't skip them.** But missing prices on an old edition are fine — `date` is the only required field. Never estimate a price or copy one from another edition.
- **Adding a `reference` source does not change what's shown**, for anything except prices. `reconcile.ts` picks scalar fields (name, date, venue, organizer, edition) from the first source by rank: `official` > `seller` > `reference` (`ROLE_RANK` in `scripts/lib/reconcile.ts`). So:
  - A **new** race (no existing seller/official source) — adding reference source(s) is enough; the first one's facts become the shown value.
  - An **existing** race — if your research should actually correct a field, you still need `npm run edit -- set <race> <field> <value> --reason "..."` (an override) after adding the source(s) that justify it. Otherwise the correction sits in `sources[]` unseen.
  - **Prices are the exception**: every source's tiers are unioned and tagged by site, so a reference source's prices show up without an override.
- **Never add a *live* URL that belongs to a recipe site** (`config/sites.yaml`, `recipe` not `none`) — `npm run edit -- add` refuses these anyway. If research turns up a race's own site or ActiUp/VM page we don't already track, hand it to `check-race`/`agent-read` instead, or add it to `config/sites.yaml` if it should be read automatically from now on.
  - **A Wayback Machine snapshot of that same URL is different and IS a formal source** (fixed 2026-09-26; `edit -- add` used to refuse these too, wrongly): a recipe only ever fetches the *live* page, so a snapshot holding content the live page has since dropped (an expired price table, a JS-only tab a plain fetch can't render) is genuinely new information, not a re-read. Always `add` it, don't just cite the URL in a `--reason` string — a `--reason` mention isn't a source a human can click into, it's prose buried in `overrides`. Prefix `--url` with the race's id/slug (`<race>@<wayback-url>`) so it attaches to that exact race instead of going through name/date matching (real risk otherwise: a thin/generic snapshot page can score as a near-duplicate of the wrong race, or fail to match and create a stray new one).
- **Only write what a source states.** Never guess an edition number, a date, or a price from pattern ("it's usually in May") — a gap stays a gap, and a genuine uncertainty (conflicting dates, a "planned" edition that may have been postponed) becomes a `flags` entry and `confidence: "conflicting"`, not a silent pick.
- Commits go straight to `main` (schedule is off). `main.yml` posts every change to Discord — that notification is the review step, so your reconciled judgment is enough to commit; you don't need to ask before committing well-sourced findings, only before something genuinely uncertain.
- Never hand-edit files in `data/`. Everything goes through `npm run edit -- add|set`.
- **Never reuse the same URL as the primary `--url` for two different editions.** `edit -- add` joins by "same page, same edition" first — a second `add` with a URL already used for another race **overwrites that race's fields** instead of creating a new one (found the hard way on Andros: a page that recaps an older edition in passing must not be cited as that edition's own source; only cite a page as the source for the edition it's actually, primarily about).
- **Don't infer an edition number from position or sequence** ("this is between Vol 6 and Vol 8, so it must be Vol 7") — that's the same guessing the rule above already forbids, just dressed as arithmetic. Only set `edition` when a source's own text states the number. If a wrong inferred edition already got written into a race's own `add` (not as an override), `unset` won't remove it — it only clears overrides. Correct it with `npm run edit -- set <race> edition null --reason "..."` (an explicit override to null).
- **Don't spawn parallel Claude subagents to research multiple editions at once.** A subagent here runs on Claude by default (not opencode's free models), so it raises your usage rather than saving it, and it reintroduces exactly the URL-collision and cross-edition consistency risks above — one editon's page can be the source of a fact about another, which only a single reconciling pass catches. What does parallelize for free: run **discovery and fetching as batched tool calls in one turn** (already fast, no extra cost), and for a large batch of sources, run a **few parallel opencode extraction workers** on separate output files (same split as `opencode-read`'s worker A/B) — that's real, free wall-clock savings. Commits stay sequential and Claude-only regardless of batch size.

## 1. See what we already have, and audit every existing edition (free)

Same as `check-race` step 1, but widen it to the whole series/organizer, not just one slug — and treat **every** matching race as needing a look, not just the ones with obvious gaps:

```bash
git pull -q
python3 -c "
import json
races = json.load(open('data/index.json'))
q = '<race name fragment, lowercase>'
for e in races:
    if q in e['name'].lower() or q in e['slug']:
        print(e['id'], e['slug'], e['date'], e['name'], e['sourceUrls'])
"
```

Read each matching file in `data/races/`. For each one, check against this list — any of these is a reason to keep researching that specific edition, not just note it and move on:

- **`prices: []`** — especially on a race whose date is upcoming or recent, where a price plausibly exists somewhere.
- **`date` missing or only approximate** (you know the month/year but not the day) — the one field that's never allowed to stay a guess.
- **`courses: []` / no distances** — the format/distance list is unknown even though the race clearly happened.
- **`edition: null`** while sibling editions in the same series *are* numbered — a source stating the number may exist even if you haven't found it yet.
- **`seriesId: null`** despite an obvious match to an existing series by name/organizer/venue.
- **`confidence: "single-sourced"`** — one source is thin; a second one (even just corroborating) is worth finding.
- **`confidence: "conflicting"` or non-empty `flags`** — an open disagreement a newer or different source might resolve.

Also check: is there a new edition this year or next that isn't tracked yet? That's still part of step 1, not the only part of it.

## 1.1. Hand off to agent-read/check-race when a recipe applies

Before doing anything yourself for a race or gap found in step 1, check whether its source is on a site `config/sites.yaml` already has a recipe for (ActiUp, VnExpress Marathon, a race-site — `recipe` not `none`). If so, **this skill's job for that race is done once it's found** — the actual collection (courses, and prices especially, which are often images or JS-rendered and this skill's plain `curl` fetch can't read) belongs to:

```bash
npm run agent-read -- prepare --race <url|slug|id>      # free — use this by default
# or, only if the user wants to spend Firecrawl credits:
npm run check -- --race <url|slug|id> --free --dry-run  # shows cost first, per check-race's own rule
```

This is why the 2024–2026 Andros races still had no prices after the first race-research pass: they're all on ActiUp (a recipe site), and this skill tried to read their price images itself with `curl` instead of handing off — `curl` just gets the static HTML, never the image, so the price silently came back empty. Don't repeat that: **a recipe-covered gap gets handed off, not DIY'd.**

Only fetch and extract a source yourself (steps 2–5 below) when **no recipe applies at all** — a dead ticket reseller, an archived page, a news article. And even then: if that source has a price image, download it and actually look at it (same as `agent-read`'s own rule — a wrong price is worse than no price, but no price when one was visible is a miss, not a safe default).

## 1.5. Always check Wayback Machine for the race's own official site

Do this **even when the live site looks empty or "Coming Soon"** — organizer sites get overwritten every year for the next edition, so a page like "Previous Editions" (with every past date, sometimes an exact edition count) often only survives in an old snapshot, not on the live site. This is usually the single best source available: it's the organizer speaking about its own history, not a third party's guess.

```bash
curl -s "http://archive.org/wayback/available?url=<the race's own domain>" | python3 -m json.tool   # closest snapshot, if any
curl -sL -A 'Mozilla/5.0' "http://web.archive.org/<snapshot url from above>" -o raw.html
```

Check the site's nav for a history/past-editions/results page and fetch that too, not just the homepage — that's usually where the real edition list lives. Do this early (step 1.5, before the wider web search in step 2) since it can answer most of step 2's questions (how many editions, which dates, edition numbers) in one page, from the best possible source. Also try Wayback on any *other* candidate URL that comes back dead or blocked during step 3 — don't give up on a source just because the live fetch fails.

## 2. Discover editions and sources (Claude, WebSearch — judgment, don't delegate)

Search in Vietnamese and English, varying the phrasing (organizers rarely use the same word twice):

```
<race name> lần thứ
<race name> mùa <n>
<race name> vol <n>
<race name> <year>
site:irace.vn <race name>
site:ticketbox.vn <race name>
site:timve365.vn <race name>
"<race name>" giải chạy
```

For each hit, note: claimed date, claimed edition/vol number, venue, organizer, and whether it's the race's own site, a reseller, or news/blog coverage. Watch for:
- **A "planned" edition that never happened, or happened later** (Covid postponements are common — Vietnam 2020–2022). Don't count a planned-then-moved date as two editions.
- **The same edition covered by several pages** (a reseller ticket page and a news recap) — these become multiple `sources[]` entries on the *same* race, not separate races.
- Conflicting dates or vol numbers across sources — keep both, this becomes a `flags` entry and `confidence: "conflicting"`.

Write down what you found before fetching anything, e.g. in a scratch note: one line per candidate edition with its best date guess and the URLs that support it.

## 3. Fetch each source (Claude, `curl` — not WebFetch) then delegate extraction

**Don't use `WebFetch` here.** It runs its own small model against your prompt and hands back an answer, not the raw page — which means *you're* the one extracting, just through a second model, and nothing is left for opencode to do. Pull raw content yourself with `curl` (`-sL -A 'Mozilla/5.0'`) into `.race-research/<slug>/raw/<n>-<short-name>.txt`, one file per candidate source, and don't read it closely yourself yet.

Then hand the whole batch to an opencode worker with a **detailed prompt** naming the exact files, the exact JSON shape, and the exact rules (see `worker-prompt.md` in this folder) — same pattern as `opencode-read`. This is mechanical (read a page, copy what it states into JSON) and cheap for you to verify against the raw file afterward, which is what makes it safe to delegate. Only fall back to reading a source yourself when `curl` gets nothing usable (JS-rendered page, blocked, dead link) — a single such case doesn't need its own opencode run; fold it into your reconciliation notes directly.

```bash
mkdir -p .race-research/<slug>/raw
# WebFetch or curl each candidate URL's content into raw/01-<site>.txt, raw/02-<site>.txt, ...
opencode run --auto -m opencode/muse-spark-1.3-contributor-free \
  "$(cat .claude/skills/race-research/worker-prompt.md)" \
  > .race-research/<slug>/worker.log 2>&1
```

## 4. Verify cheaply (Claude)

- `tail -20` the worker log for its status lines.
- For each extracted fact, spot-check against the raw source — this is fast because you're comparing a JSON value to text you already fetched, not reading it cold.
- Any price table: check every cell against the source yourself (same as agent-read step 2 — a wrong price is worse than no price).
- Where sources disagree, decide: same edition (multiple sources) or genuinely different editions (a real gap between dates, distinct vol numbers).

## 5. Write it (Claude only — commits, decisions)

**A missing edition** (no existing race file):

```bash
npm run edit -- add --url "<primary/best source>" --reason "<why this is the source>" \
  --json '{"name":"…","date":"YYYY-MM-DD","types":["road_run"],"distances":["5km","10km"],"venue":"…","city":"…","organizer":"…","prices":[...]}' \
  --dry-run
```

Then, for every *other* corroborating source found for the same edition, run `add` again with its URL (it joins the same race by date/name proximity — check the dry run's output to confirm it joined rather than creating a duplicate). Then set what a single `add` can't carry:

```bash
GITHUB_TOKEN=$(gh auth token) npm run edit -- set <slug> seriesId <series-id> --reason "same series as <other editions>"
GITHUB_TOKEN=$(gh auth token) npm run edit -- set <slug> edition <n> --reason "<source> states this is edition <n>"
```

**Cross-checking an existing race:**

- Add every new source found (`edit -- add`, role `reference`) — this always records the audit trail.
- If a source disagrees with what's shown and you judge it right, follow with `edit -- set <field> <value> --reason "<source> says X, existing seller source said Y; source is more reliable because …"`. State the disagreement in the reason so it's visible later.
- If you can't tell which is right, don't override. `flags` isn't a hand-settable field (`reconcile.ts` generates it, `edit.ts` doesn't accept it) — so add the source, put the disagreement in its `--reason`, and say so plainly to the user. A genuinely unresolved conflict is worth surfacing, not silently picking a side.

Drop `--dry-run` and prefix `GITHUB_TOKEN=$(gh auth token)` once the dry run looks right.

**Every `prices[].site` value must equal one of that race's own `sources[].site` values** — `validate.ts` rejects a price tagged with a site the race has no source for. This used to bite here because `edit -- add` refused a Wayback snapshot of a recipe-covered site as a formal source (fixed 2026-09-26 — see the recipe-site rule above; it's now `add`-able and tagged with the site it's a snapshot of, same as the live page would be). If you're setting `prices` as a `--set` override rather than getting them for free from an `add`ed Wayback source, still check `sources[].site` on the race first (`python3 -c "import json; print([s['site'] for s in json.load(open('data/races/<slug>.json'))['sources']])"`) and use one of those values. **Run `npm run validate` right after every `prices` write**, before moving to the next race or ending the session — a validate failure doesn't just reject that one commit, it makes GitHub Actions skip the `notify-api` job on *every subsequent push* (even unrelated ones), which silently stops the production API from syncing anything at all until someone notices and fixes it. This happened on 2026-09-25 (lamdong-trail 2025 prices tagged `site: "lamdong-trail"` with no such source) and stalled sync for ~8 minutes across several other commits before being caught by a user asking why a race's prices weren't showing on the site.

## Known tool limitations

- **Re-running `add` on the same URL only replaces the stored source if its `site` tag is unchanged** (`sync.ts` matches by `site` + `url` together). If `config/sites.yaml` gains a new recognized site *after* you've already added a source from it as plain `openrace`, re-running the same `add` call to pick up the new tag creates a **second, duplicate source entry** instead of replacing the first (both hold the same facts, so it doesn't change any shown value — just clutters `sources[]`). No clean command removes a stale source today. If you hit this, say so plainly rather than hand-editing the file; it's a real gap in `edit.ts`, not something to route around.

- **A second hand-added source on an existing race can silently create a duplicate race instead of joining it**, when both that source and an earlier one on the same race fall back to the generic `openrace` site tag, or when the new source's page is too thin/generic to clear the name-similarity threshold. `sync.ts`'s name-matching rule (step "another site's page for a race with nearly the same name on the same day") also explicitly **skips** a candidate that already has a source on the same site. Fixed 2026-09-26: `edit -- add --url "<race-id-or-slug>@<url>"` now forces the source onto that exact race by id, bypassing name/date matching entirely (mirrors `agent-read prepare --race <id>@<url>`) — use this prefix whenever you already know which race a source belongs to, which in practice is every case in this skill (you found the edition, you're just attaching one more source to it). This is the reliable fix; `hostOf()` unwrapping a Wayback URL to its archived site's tag (registering the race's own domain in `config/sites.yaml`, even `recipe: none`) still helps but is secondary now. **After any `add` on an existing race, check the output names the race you expected** (same slug/id) — if it prints a brand-new slug instead, it duplicated; revert (`git revert`, since these commit straight to `main`) rather than leaving the stray race behind.

- **Check `.agent-read-archive/` before re-fetching anything.** A batch's raw pages are archived there (`.agent-read-archive/<date>-<topic>/`, see the memory rule on archiving instead of deleting), including plain `curl`/Wayback fetches this skill saved outside the normal agent-read flow. Re-fetching a URL you already have archived wastes a request and risks a subtly different (or since-changed) copy replacing the one your commit was actually based on — read the archived file first (`.agent-read-archive/<date>-<topic>/<year>/page-2.html`, `.../wayback/<year>-<timestamp>.html`, ...) and only hit the network for a URL or a page section (e.g. a different tab) you don't already have saved.

- **Commits from `edit.ts`/`agent-read.ts`/`check.ts` go straight to `main` via the GitHub API (`scripts/lib/github.ts`), never through your local git.** Your local checkout won't show the commit — `git log` looks unchanged — until you `git pull`. Don't mistake this lag for a failed commit; check the command's own printed commit SHA, then `git pull` before your next local git command.

- **`registrationStatus` now includes `"cancelled"`** (distinct from `"closed"`, which just means registration ended) and **`data/series.json` entries have a `description` field** (hand-written, `null` by default) for exactly this kind of series-level finding — edition count, gaps, why a year is missing — that doesn't belong to any one race's `sources[]`. Update it (directly, like the rest of `series.json`) whenever a run changes the picture materially, the same way this pilot did after finding the organizer's own edition list. When a series' true edition count comes into focus this way, also fill **`statedEditionCount`** (integer, `1-200`, `null` by default) on the same `series.json` entry — it's the structured number the site displays, alongside the prose in `description`. Fill each race's own `edition` number too when you find it, but it stays optional (not every race's edition number is knowable) — `validate.ts` doesn't require it.

## 6. Clean up and report

```bash
rm -rf .race-research/<slug>
```

(gitignored, but same as agent-read: keep the folder around if the user wants an audit trail beyond the committed `sources[]`, otherwise remove it.)

Tell the user: how many editions found vs. tracked before, which are still gaps (unfindable — say so plainly, don't force a guess), what was delegated to opencode vs. done by hand, what was handed off to `agent-read`/`check-race` (and whether that handoff was actually run, or is left for the user to trigger), and anything flagged as conflicting.

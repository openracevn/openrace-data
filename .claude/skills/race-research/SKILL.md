---
name: race-research
description: Deep, multi-source research on one race — find every edition (past and current) and every independent source (the race's own site, old ticket resellers like iRace/TicketBox/Raceez, news and blog coverage), add missing editions, and cross-check races we already track beyond what agent-read/check-race read from their one primary source. Use when the user names a race and asks to "study" it, find its full history, check how many editions it's really had, or double-check it against other sources. Facebook is never a source here, only a link. Not for a normal re-check of a race's current listing (use check-race) or for reading a recipe site's regular pages (use agent-read).
---

# Research a race across the whole web

`check-race` and `agent-read` read **one race's current listing on one known site** (a recipe). This skill goes wider: given a race by name, it searches the open web for every edition that's ever been run and every independent account of it, so gaps in our data (missing past editions, an unverified price, a wrong venue) get filled or confirmed from sources outside the usual pipeline. It is manual/agent-driven research, not a recipe — there is no site to automate here, each source is different and read once.

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
- **Never add a URL that belongs to a recipe site** (`config/sites.yaml`, `recipe` not `none`) — `npm run edit -- add` refuses these anyway. If research turns up a race's own site or ActiUp/VM page we don't already track, hand it to `check-race`/`agent-read` instead, or add it to `config/sites.yaml` if it should be read automatically from now on.
- **Only write what a source states.** Never guess an edition number, a date, or a price from pattern ("it's usually in May") — a gap stays a gap, and a genuine uncertainty (conflicting dates, a "planned" edition that may have been postponed) becomes a `flags` entry and `confidence: "conflicting"`, not a silent pick.
- Commits go straight to `main` (schedule is off). `main.yml` posts every change to Discord — that notification is the review step, so your reconciled judgment is enough to commit; you don't need to ask before committing well-sourced findings, only before something genuinely uncertain.
- Never hand-edit files in `data/`. Everything goes through `npm run edit -- add|set`.

## 1. See what we already have (free)

Same as `check-race` step 1, but widen it to the whole series/organizer, not just one slug:

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

Read each matching file in `data/races/`. Note what's missing: which years have no file, whether `seriesId`/`edition` are set consistently, what `sources[]` already cover.

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

## 6. Clean up and report

```bash
rm -rf .race-research/<slug>
```

(gitignored, but same as agent-read: keep the folder around if the user wants an audit trail beyond the committed `sources[]`, otherwise remove it.)

Tell the user: how many editions found vs. tracked before, which are still gaps (unfindable — say so plainly, don't force a guess), what was delegated to opencode vs. done by hand, and anything flagged as conflicting.

---
name: check-race
description: Check, add, update, edit or verify a race in openrace-data. Use when the user gives a race URL (ActiUp, a race's own site, VnExpress Marathon, ...), a race slug or id, asks whether a race's data is correct or why a field is wrong, asks to (re)check, add or fix a race, to change a race's info by hand, or to add a race no site lists.
---

# Check a race (design v2)

openrace-data holds one JSON file per race edition (`data/races/<slug>-<year>.json`; the key is the `id` inside). Sites are read by `scripts/check.ts` with a **recipe** per site (`scripts/lib/recipes/`, listed in `config/sites.yaml`): the recipe fetches pages and APIs for free, and Firecrawl Parse reads the relevant HTML or OCRs price images. Background: `.claude/docs/design-v2.md`, `scripts/lib/recipes/README.md`.

## Rules

- **Firecrawl credits are the user's money.** A page or image read costs about 5 credits. Always run with `--free` first (it shows what would be read and the most it would cost), say the cost, and don't re-read to "double-check": reads are cached by content (`state/reads.json`), so an unchanged page costs nothing anyway.
- Commits go straight to `main`. The schedule is **off**; nothing runs unless triggered. Commit with `GITHUB_TOKEN=$(gh auth token)`.
- **Another session can be committing to `main` at the same time as you** (seen 2026-09-27: a concurrent run landed several unrelated `edit`/check commits within seconds of each other while a manual merge was in progress). `npm run edit`/`agent-read`/`check`'s commit path re-fetches the branch head from the GitHub API on every attempt and retries on conflict, so a single scripted commit is safe either way — but a *hand* edit to a race file or `data/index.json` (the merge-a-duplicate case below) sits as **uncommitted local changes**, and a plain `git pull` (or anything that resets/checks out the tree) while those are dirty can silently overwrite or lose them with no error. For any multi-step hand edit spanning more than one commit (a duplicate-race merge, a multi-field cleanup across editions), do it in a git worktree (`EnterWorktree`) so a concurrent puller on the main checkout can't touch your working copy; the actual commits still land on `main` via the GitHub API regardless of which checkout you run the script from.
- Never print secrets.
- Race fields are derived from each source's stored `extracted`, then **OpenRace overrides** go on top. Never hand-edit a race's fields in its file (the next read or `renormalize` undoes it). Fix the code (step 4) when a site is misread, or set an override (step 5). `slug` changes go through `npm run edit -- slug`.
- **Check prices by eye.** Open the page or price image (download it with curl and look at it) and compare every tier. This is free, and it's the only real check.

## 1. Find the race (free)

```bash
git pull -q
npm run find -- "<url, slug or id fragment>"
```

Read `data/races/<file>`. Each `sources[]` entry has the site, its role (`official` wins for date, courses and location; `seller` pages keep their own prices) and the raw `extracted` (facts, page reads, image reads with their URLs). `flags` lists what needs a look. `state/checks.json` has each page's last check.

## 2. Look at the source (free)

- **ActiUp:** `curl -s -H "Accept-Language: vi" https://api.actiup.net/v2/content/events/slug/<slug>` gives name, dates, place, organizer (`merchant_public_name`), `selling_type` and the description sections. Prices are usually an image in the "Chính sách giá vé" section. **Check `result.price_type` before treating empty `prices` as missing:** `price_type: "free"` means ActiUp itself says entry is free (no image to OCR) — the recipe (`scripts/lib/recipes/actiup.ts`) turns this into a real `{tier: "Miễn phí", price: 0}` tier via `facts.prices`, so re-read it (`agent-read`, free) rather than leaving `prices: []` or writing an override. `min_price: 0` with `price_type` unset/other does **not** mean free — ActiUp just doesn't know the fee there; leave that one as missing. (Found 2026-09-27: `mini-game-kun-fun-run-dong-thap-2026` and 10 other races had this exact gap — see `scripts/lib/recipes/README.md`.)
- **`ticket.irace.vn` (preferred when available, free, no image cost):** slugs are **not** shared across sites — don't guess `https://ticket.irace.vn/<actiup-slug>` and treat a 404 as "not on irace". Web-search `<race name> irace` (or `<race name> ticket.irace.vn`) to find its real slug first, then `curl -sL -A 'Mozilla/5.0' https://ticket.irace.vn/<found-slug>`. Its `#personal` table has the same tiers as ActiUp/irace.vn, but as text — no OCR needed.
- **Other sites:** `curl -sL -A 'Mozilla/5.0' <url>`. To see what the recipe would read: `npm run check -- --race <url> --free --dry-run`.
- **Price images:** download one and look at it (Read the file). Compare every tier: distance, label, audience (resident / non-resident), price, dates.

Report the differences field by field: ours vs the source. When sources disagree and neither is `official`, trust `ticket.irace.vn` over `irace.vn`'s write-up over ActiUp — ActiUp's own fields are often left as placeholder text (`TBU`, empty) by organizers, and irace.vn's blog-style page is often thinner than ticket.irace.vn's own event fields.

**A field (venue, city, price, ...) is missing, TBU or null on the known source — this is a hard stop, not a judgment call.** Do not write an override or infer the value from surrounding text (e.g. "the description names a province, so set city to that") until seven tiers have been worked (plan 013, free unless noted). Seeing `TBU` in ActiUp's own `place` field is not confirmation the value is unknown everywhere — it only means ActiUp doesn't have it:

```bash
npm run find-sources -- <race url|slug|id>                    # tiers 1-6: every missing field
npm run find-sources -- <race url|slug|id> --field prices      # one field only
```

This runs, in order — checking `.agent-read-archive/` first so nothing already fetched is re-fetched, then trying a Wayback snapshot of a tier before moving on, never skipping straight past an empty live fetch — irace (`ticket.irace.vn`/`irace.vn/su-kien`, free HTML text, preferred: no OCR), irace's Wayback, the race's own/organizer site (plus a same-site info/price subpage), that site's Wayback, ActiUp (an API read; its price is usually an image, saved here but not read by the script), and ActiUp's Wayback. Only when its summary says none of 1–6 resolved the field does tier 7 apply: web-search by hand (`WebSearch`, varying phrasing — `<race name> irace`, `<race name> lần thứ`, etc.), saving each promising hit into `.agent-read-archive/<date>-<race-slug>-source-check/web-search-hit-<n>/` and its queries/results into `search-log.md` there (the same folder `find-sources.ts` already wrote tiers 1–6 into).

Only after all seven tiers turn up nothing does "no source has this" become true, and only then does step 5 (override) or leaving the field as-is apply. Once a new source is found, attach it with the `agent-read` skill's `--race <existing-race-id-or-slug>@<new-url>` rather than a bare `--race <url>`, so a same-day near-duplicate name doesn't risk creating a second race instead of joining this one.

**`find-sources.ts` writes `attempts.json` itself for tiers 1–6** (one entry per tier actually tried, skipping a tier with no known URL for this race) — you only add entries by hand for tier 7 (web search), same shape:

```json
{"step": "web-search", "action": "WebSearch '<race name> irace'", "result": "found https://ticket.irace.vn/<slug>, no venue in #personal table" }
```

Its own printed summary — which tier resolved it, or "none of 1–6 — try a web search" — is the check for whether 1–6 are truly exhausted, not something to track by hand. This is the only record of what was checked and came up empty — without it, the next session can't tell "nobody checked irace.vn" from "irace.vn was checked and has nothing," and re-does the same dead-end search.

## 3. Read it again with Firecrawl (costs credits; say so first)

To read it for free instead (you read the pages and images yourself), use the `agent-read` skill: `npm run agent-read -- prepare --race <url|slug|id>`.

```bash
npm run check -- --race <url|slug|id> --free --dry-run                          # free: what would be read, max cost
npm run check -- --race <url|slug|id> --dry-run --preview /tmp/race              # paid, no commit; planned files in /tmp/race
GITHUB_TOKEN=$(gh auth token) npm run check -- --race <url|slug|id>              # paid, commit
```

- A slug or id reads **every** source of that race that is on a site with a recipe.
- A URL we don't have yet adds a race, or joins one: same page and edition, a page the race links to (or that links to it), or a similar name on the same day.
- Site-wide: `--site <key>` (add `--past` for races that already took place, `--limit N` for a small batch).
- The same from the Actions tab: **Check races** → site or race.

## 4. Fix wrong values (free once the code is fixed)

1. Find the cause in the source's `extracted`:
   - **The recipe picked the wrong pages or images:** `scripts/lib/recipes/<recipe>.ts` (or `default.ts`), with a test in `test/recipes.test.ts` against a saved page in `test/fixtures/`.
   - **The model misread the content:** the prompts and schemas in `scripts/lib/extraction.ts` (`PAGE_EXTRACTION`, `IMAGE_EXTRACTION`). Changing them makes the next run read again (the cache is keyed by version).
   - **The value was cleaned up wrongly:** `normalizeExtraction`, `normalizeTier`, `tierDate`, `tierKind`, `audienceOf` in the same file.
   - **The merge picked the wrong source:** `scripts/lib/reconcile.ts`.
   - **The wrong race matched:** `planSync` matching in `scripts/sync.ts`.
2. Add a test, then `npm run typecheck && npm test`. Real reads with hand-checked prices are in `test/answers.test.ts`: they must still pass.
3. `npm run renormalize` (dry run) shows which races change; `GITHUB_TOKEN=$(gh auth token) npm run renormalize -- --commit` applies it, with no reading.
4. If `scripts/lib/schema.ts` changed: `npm run schema`.

## 5. Set a value by hand (OpenRace override, free)

Use this when the user says what a field should be, or no source has it. Always record the reason.

```bash
npm run edit -- set <race> <field> '<json value>' --reason "<why, and where it's from>" --dry-run
GITHUB_TOKEN=$(gh auth token) npm run edit -- set <race> <field> '<json value>' --reason "<why>"
GITHUB_TOKEN=$(gh auth token) npm run edit -- unset <race> <field>
GITHUB_TOKEN=$(gh auth token) npm run edit -- slug <race> <new-slug>
```

Setting `prices` by hand: every entry's `site` must equal one of the race's existing `sources[].site` values, or `npm run validate` rejects the whole file — and a validate failure blocks GitHub Actions' `notify-api` job on *every* subsequent push, not just this one, silently stalling the production API's sync until someone notices. Check `sources[].site` on the race first, and run `npm run validate` right after any hand-set `prices`.

- Fields: name, types, date, endDate, seriesId, organizerId, organizer, edition, courses, location, prices, currency, registrationStatus, registrations, links.
- Values in canonical form (the schema checks them):
  - courses: `[{"label":"21km","meters":21097,"type":"road_run","elevationGain":null}]`
  - edition: `5` or `null`
  - location: `{"venue":"…","city":"…"}`
    - After a location edit, check the race got a point: `state/geo.json` has an entry per location; `"note": "no point found"` means no map on the site. Geocoding already drops "(…)" notes and retries without "Đường/Phường/Tỉnh…" prefixes, and rejects results whose name doesn't match the query. If it still fails, set the point by hand: `npm run edit -- <race> geo '{"lat":…,"lng":…}'`. After a geocoder fix, `npm run geo -- --retry-missing` re-looks up only the failed entries.
  - prices: `[{"distance":"21km","tier":"Early Bird","kind":"early","audience":null,"price":750000,"from":"2026-06-24","to":"2026-07-16","inferred":[],"site":"openrace"}]`
  - date: `"YYYY-MM-DD"`
- `seriesId` and `organizerId` must exist in `data/series.json` / `data/organizers.json`. Add entries there by hand, sorted by id. One organizer per entity: put the operating company in `organizerId` and partners/media/government in `coOrganizerIds` (override via `npm run edit -- set`), never a concatenated name. Reviewing organizer entities (splits, duplicates, links) is the `check-organizer` skill.
- An override wins over every source. If a source later changes that field, Discord shows `⚠️ <field>: sources now say … (override kept)`.

### Participants (past races)

Look in the official site's recap or results-announcement page, press releases and the organizer's social post. Recaps are usually published *after* the event, so an upcoming race legitimately has none. Record `count`, `approx` (`true` for "~2000", "over 5,000", "khoảng 3.000"), the verbatim `quote`, and the exact `sourceUrl` of the page that states it (a Wayback snapshot if the live page moved or was overwritten). **Never write a figure without a link** (the schema rejects it). Skip finishers-only and capacity/slots statements. Unknown stays absent, never 0. Set it with an override (step 5): `npm run edit -- set <race> participants '{"count":2000,"approx":true,"sourceUrl":"https://…","quote":"~2000 participants"}' --reason "<where>"`. `npm run gaps` lists past races with none, biggest series first.

## 6. Add a race no site lists (source `openrace`, free)

```bash
npm run edit -- add --url "<reference: organizer page / post>" --reason "<where it's from>" \
  --json '{"name":"…","date":"YYYY-MM-DD","types":["road_run"],"distances":["5km","10km"],"venue":"…","city":"…","organizer":"…","prices":[{"distance":"5km","tier":"Early Bird","from":"01/09","to":"30/09","price":250000}]}' --dry-run
```

Drop `--dry-run` and prefix `GITHUB_TOKEN=$(gh auth token)` to commit. If the race's site should be read automatically from now on, add it to `config/sites.yaml` instead (see `scripts/lib/recipes/README.md`).

## Types

road_run, trail_run, city_trail, obstacle_run, triathlon, duathlon, aquathlon, aquabike, swimrun, open_water_swim, pool_swim, swim, road_cycle, mtb, other.

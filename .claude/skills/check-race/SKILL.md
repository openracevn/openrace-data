---
name: check-race
description: Check, add, update, edit or verify a race in openrace-data. Use when the user gives an ActiUp or bibchung event URL, a race slug or id, asks whether a race's data is correct or why a field is wrong, asks to (re)check, add or fix a race, to change a race's info by hand, or to add a race no site lists.
---

# Check a race

openrace-data holds one JSON file per race (`data/races/<slug>.json`; the key is the `id` inside, listed in `data/index.json`). Races are scraped from **ActiUp** (primary for every field) and **bibchung** (a second place to buy, with a group discount: `groupPriceMin`) by `scripts/check.ts` through Firecrawl. Background: `.claude/docs/` (read only what the task needs).

## Rules

- **Firecrawl credits are the user's money.** Each page extraction costs 5 credits (1 scrape + 4 AI), so a race on both sites costs 10. Say the cost before scraping, don't repeat a scrape to "double-check", and prefer the free checks below.
- Commits go straight to `main` (the private org repo can't use auto-merge). The daily schedule is **off**; nothing runs unless triggered.
- Never print secrets. Commit with the user's gh login: `GITHUB_TOKEN=$(gh auth token)`.
- Race data is derived from each source's stored `rawExtracted`, then **OpenRace overrides** go on top. Never hand-edit a race file's fields directly (the next re-check or `renormalize` would undo it). To change a value, fix the extraction in code (step 4) when a source is misread, or set an override (step 5) when OpenRace knows better or no source has it. `slug` is the only field edited directly in the file.

## 1. Find the race (free)

```bash
git pull -q
python3 -c "import json,sys; q=sys.argv[1]; [print(e['id'], e['slug'], e['date'], e['name'], e['sourceUrls']) for e in json.load(open('data/index.json')) if q in e['id'] or q in e['slug'] or any(q in u for u in e['sourceUrls'])]" "<url, slug or id fragment>"
```
Then read `data/races/<slug>.json`. `state/checks.json` has each URL's last check and its outcome (`ok`, `rejected` + reason, `permanent`).

## 2. Check it against the sources (free)

- **ActiUp listing API** (exact date, end date, from-price, `selling_type` sold_out/selling, `close_registration_date`, organizer). It lists upcoming and past events, 12 per page:
  `curl -s "https://api.actiup.net/v2/content/events/paging?event_type=sports&limit=12&offset=<N>&price=&selling_type=&category_id=&event_time="`
  Find the item by `event_slug` (the last part of the ActiUp URL).
- **bibchung** pages render on the server, so `curl -sL -A 'Mozilla/5.0' <bibchung url>` gets the full text. Its price rows are `<tier> · <distance> · <regular price> · <bibchung price>`, and the page also has JSON-LD `SportsEvent` data.
- ActiUp event pages render in the browser, so `curl` only gets the title. Use the API above instead.

Report the differences field by field: ours vs the source, and which source wins (ActiUp first; bibchung only fills gaps).

## 3. Re-check with Firecrawl (costs credits; say so first)

```bash
npm run check -- --mode race --race <url|slug|id> --dry-run                    # prints the raw extraction + the plan, no commit
GITHUB_TOKEN=$(gh auth token) npm run check -- --mode race --race <url|slug|id>  # commit
```
- A slug or id re-checks **every** source URL of that race; pass a single URL to check one page.
- A URL we don't have yet adds a race, or joins an existing one when race day is within 1 day and the names are similar.
- `pageKind: "none"` means Firecrawl got an empty page (ActiUp sometimes renders late). It's logged as a transient failure; one manual retry is reasonable.
- The same thing from the Actions tab: **Check races** → mode `race`, paste the URL.

## 4. Fix wrong values (free once the code is fixed)

1. Find the cause in the raw extraction (`sources[].rawExtracted`, or the run log's `extracted <url>` line):
   - **The model misread the page:** prompt and field descriptions → `EXTRACTIONS` in `scripts/lib/extraction.ts`.
   - **The value is fine but was cleaned up wrongly:** `normalizeExtracted` / `normalizeDistance` / `resolvePlace` (`scripts/lib/places.ts`).
   - **The merge picked the wrong source:** `scripts/lib/reconcile.ts`.
   - **The wrong race matched:** `findMatch` / `nameSimilarity` in `scripts/sync.ts`.
2. Add a test case in `test/sync.test.ts`, then run `npm run typecheck && npm test`.
3. `npm run renormalize` (dry run) shows which races change, then `GITHUB_TOKEN=$(gh auth token) npm run renormalize -- --commit`. This re-derives every race from its stored extraction, with no scraping.
4. A prompt change only takes effect on the next scrape of that page.
5. If `scripts/lib/schema.ts` changed: `npm run schema`, and bump `SCHEMA_VERSION` only for breaking changes.

## 5. Set a value by hand (OpenRace override, free)

Use this when the user says what a field should be ("Tết Run has a 42km too, BTC confirmed"), or the sources don't have it. Always ask for or record the reason.
```bash
npm run edit -- set <race> <field> '<json value>' --reason "<why, and where it's from>" --dry-run   # preview
GITHUB_TOKEN=$(gh auth token) npm run edit -- set <race> <field> '<json value>' --reason "<why>"
GITHUB_TOKEN=$(gh auth token) npm run edit -- unset <race> <field>                                  # back to the source value
GITHUB_TOKEN=$(gh auth token) npm run edit -- slug <race> <new-slug>                                # change the slug (renames the file)
```
- `<field>` is one of: name, types, date, distances, location, priceMin, priceMax, groupPriceMin, currency, registrationStatus, registrationUrl, organizer, foreignerEligible.
- Values must already be in canonical form (the schema checks them, and the edit is refused otherwise):
  - distances: `["21km","42km"]`
  - location: `{"venue":"…","city":"Hanoi","region":"north"}`, with city as the English display name from `scripts/lib/places.ts`
  - prices: plain integer VND
  - date: `"YYYY-MM-DD"`
  - types: values from the list below
- An override wins over every source and survives re-checks. If a source later changes that field, Discord shows `⚠️ <field>: sources now say … (override kept)`; ask the user whether to keep the override or `unset` it.
- Several fields: run `set` once per field; each run is its own commit.

## 6. Add a race no site lists (source `openrace`, free)

```bash
npm run edit -- add --url "<reference: organizer page / post>" --reason "<where it's from>" --json '{"name":"…","date":"YYYY-MM-DD","types":["road_run"],"distances":["5km","10km"],"venue":"…","city":"…","priceMin":150000,"registrationUrl":"…","organizer":"…"}' --dry-run
```
Then run it again without `--dry-run`, with `GITHUB_TOKEN=$(gh auth token)`.
- The fields are extraction-shaped: they go through the same normalization as scraped data (Vietnamese city names are fine here, and distances get tidied). name and date are required.
- The slug comes from the name. Re-running `add` with the same `--url` updates that race.
- The reference URL must not be an ActiUp or bibchung event page; use step 3 for those.
- Hand-entered races are never scraped. If ActiUp lists the race later, a check of that page joins it (matched by date + name), and ActiUp becomes primary.

## 7. Confirm

- `npm run validate` must pass (it also runs in CI on every push).
- The push triggers `main.yml`: validate, Discord (each race line links to its sources and JSON), and the API resync (once `SYNC_WEBHOOK_URL` is set). Check it with:
  `gh run list --repo openracevn/openrace-data --workflow main.yml --limit 1`
- Commit code changes with a message that says what was wrong and why, ending with the Co-Authored-By trailer.

## Field meanings (short)

- `types`: road_run, trail_run, city_trail, obstacle_run, triathlon, duathlon, aquathlon, aquabike, swimrun, swim, road_cycle, mtb, other.
- `null` means unknown.
- `priceMin` on ActiUp is the "Chỉ từ" (from) price. `priceMax` and `groupPriceMin` come from bibchung.
- `confidence`: single-sourced / multi-sourced / conflicting (the sources disagree on race day).
- Races are never deleted, not even when they vanish from the sources. Past races stay; consumers filter on `date`.
- `overrides` records which fields OpenRace set and why; the fields already hold those values.
- Source `openrace`: a race entered by hand; its `url` is the reference it came from.

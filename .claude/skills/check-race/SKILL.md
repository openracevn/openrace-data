---
name: check-race
description: Check, add, update, edit or verify a race in openrace-data. Use when the user gives a race URL (ActiUp, a race's own site, VnExpress Marathon, ...), a race slug or id, asks whether a race's data is correct or why a field is wrong, asks to (re)check, add or fix a race, to change a race's info by hand, or to add a race no site lists.
---

# Check a race (design v2)

openrace-data holds one JSON file per race edition (`data/races/<slug>-<year>.json`; the key is the `id` inside). Sites are read by `scripts/check.ts` with a **recipe** per site (`scripts/lib/recipes/`, listed in `config/sites.yaml`): the recipe fetches pages and APIs for free, and Firecrawl Parse reads the relevant HTML or OCRs price images. Background: `.claude/docs/design-v2.md`, `scripts/lib/recipes/README.md`.

## Rules

- **Firecrawl credits are the user's money.** A page or image read costs about 5 credits. Always run with `--free` first (it shows what would be read and the most it would cost), say the cost, and don't re-read to "double-check": reads are cached by content (`state/reads.json`), so an unchanged page costs nothing anyway.
- Commits go straight to `main`. The schedule is **off**; nothing runs unless triggered. Commit with `GITHUB_TOKEN=$(gh auth token)`.
- Never print secrets.
- Race fields are derived from each source's stored `extracted`, then **OpenRace overrides** go on top. Never hand-edit a race's fields in its file (the next read or `renormalize` undoes it). Fix the code (step 4) when a site is misread, or set an override (step 5). `slug` changes go through `npm run edit -- slug`.
- **Check prices by eye.** Open the page or price image (download it with curl and look at it) and compare every tier. This is free, and it's the only real check.

## 1. Find the race (free)

```bash
git pull -q
python3 -c "import json,sys; q=sys.argv[1]; [print(e['id'], e['slug'], e['date'], e['name'], e['sourceUrls']) for e in json.load(open('data/index.json')) if q in e['id'] or q in e['slug'] or any(q in u for u in e['sourceUrls'] + e['linkUrls'])]" "<url, slug or id fragment>"
```

Read `data/races/<file>`. Each `sources[]` entry has the site, its role (`official` wins for date, courses and location; `seller` pages keep their own prices) and the raw `extracted` (facts, page reads, image reads with their URLs). `flags` lists what needs a look. `state/checks.json` has each page's last check.

## 2. Look at the source (free)

- **ActiUp:** `curl -s -H "Accept-Language: vi" https://api.actiup.net/v2/content/events/slug/<slug>` gives name, dates, place, organizer (`merchant_public_name`), `selling_type` and the description sections. Prices are usually an image in the "Chính sách giá vé" section. **Check `result.price_type` before treating empty `prices` as missing:** `price_type: "free"` means ActiUp itself says entry is free (no image to OCR) — the recipe (`scripts/lib/recipes/actiup.ts`) turns this into a real `{tier: "Miễn phí", price: 0}` tier via `facts.prices`, so re-read it (`agent-read`, free) rather than leaving `prices: []` or writing an override. `min_price: 0` with `price_type` unset/other does **not** mean free — ActiUp just doesn't know the fee there; leave that one as missing. (Found 2026-09-27: `mini-game-kun-fun-run-dong-thap-2026` and 10 other races had this exact gap — see `scripts/lib/recipes/README.md`.)
- **`ticket.irace.vn` (preferred when available, free, no image cost):** slugs are **not** shared across sites — don't guess `https://ticket.irace.vn/<actiup-slug>` and treat a 404 as "not on irace". Web-search `<race name> irace` (or `<race name> ticket.irace.vn`) to find its real slug first, then `curl -sL -A 'Mozilla/5.0' https://ticket.irace.vn/<found-slug>`. Its `#personal` table has the same tiers as ActiUp/irace.vn, but as text — no OCR needed.
- **Other sites:** `curl -sL -A 'Mozilla/5.0' <url>`. To see what the recipe would read: `npm run check -- --race <url> --free --dry-run`.
- **Price images:** download one and look at it (Read the file). Compare every tier: distance, label, audience (resident / non-resident), price, dates.

Report the differences field by field: ours vs the source. When sources disagree and neither is `official`, trust `ticket.irace.vn` over `irace.vn`'s write-up over ActiUp — ActiUp's own fields are often left as placeholder text (`TBU`, empty) by organizers, and irace.vn's blog-style page is often thinner than ticket.irace.vn's own event fields.

**A field (venue, city, price, ...) is missing, TBU or null on the known source — this is a hard stop, not a judgment call.** Do not write an override or infer the value from surrounding text (e.g. "the description names a province, so set city to that") until you've worked this checklist (plan 010, free unless noted). Seeing `TBU` in ActiUp's own `place` field is not confirmation the value is unknown everywhere — it only means ActiUp doesn't have it:
1. A subpage on the *same* site (e.g. `/thong-tin-cuoc-dua` — an info/price tab the recipe may not read; worth a recipe fix if found).
2. Web-search `<race name> irace` to get the real `ticket.irace.vn/<slug>` (never assume the ActiUp slug matches), then read its `#personal` table — real HTML, no OCR.
3. `irace.vn/su-kien/<slug>` (usually a text table too, `.eventon_desc_in`, found the same way — by search, never assumed).
4. ActiUp/irace.vn's old poster images last (Firecrawl OCR credits, or your own eyes).

Only after all four turn up nothing does "no source has this" become true, and only then does step 5 (override) or leaving the field as-is apply. Once a new source is found, attach it with the `agent-read` skill's `--race <existing-race-id-or-slug>@<new-url>` rather than a bare `--race <url>`, so a same-day near-duplicate name doesn't risk creating a second race instead of joining this one.

**Log every checklist run, hit or miss.** Write `.agent-read-archive/<date>-<race-slug>-source-check/attempts.json`, one entry per checklist step actually tried (skip steps that didn't apply, e.g. no subpage exists to check):

```json
[
  {"step": "subpage", "action": "curl .../thong-tin-cuoc-dua", "result": "not found" },
  {"step": "ticket.irace.vn", "action": "web search '<race name> irace'", "result": "found https://ticket.irace.vn/<slug>, no venue in #personal table" },
  {"step": "irace.vn/su-kien", "action": "web search '<race name> irace.vn su-kien'", "result": "no page found" },
  {"step": "poster images", "action": "read <image-url>", "result": "venue not shown" }
]
```

This is the only record of what was checked and came up empty — without it, the next session (or a future look at why a field is still missing) can't tell "nobody checked irace.vn" from "irace.vn was checked and has nothing," and re-does the same dead-end search. Write it even when the checklist finds nothing and the field is left blank; it's not conditional on ending in an override.

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
  - prices: `[{"distance":"21km","tier":"Early Bird","kind":"early","audience":null,"price":750000,"from":"2026-06-24","to":"2026-07-16","inferred":[],"site":"openrace"}]`
  - date: `"YYYY-MM-DD"`
- `seriesId` and `organizerId` must exist in `data/series.json` / `data/organizers.json`. Add entries there by hand, sorted by id.
- An override wins over every source. If a source later changes that field, Discord shows `⚠️ <field>: sources now say … (override kept)`.

## 6. Add a race no site lists (source `openrace`, free)

```bash
npm run edit -- add --url "<reference: organizer page / post>" --reason "<where it's from>" \
  --json '{"name":"…","date":"YYYY-MM-DD","types":["road_run"],"distances":["5km","10km"],"venue":"…","city":"…","organizer":"…","prices":[{"distance":"5km","tier":"Early Bird","from":"01/09","to":"30/09","price":250000}]}' --dry-run
```

Drop `--dry-run` and prefix `GITHUB_TOKEN=$(gh auth token)` to commit. If the race's site should be read automatically from now on, add it to `config/sites.yaml` instead (see `scripts/lib/recipes/README.md`).

## Types

road_run, trail_run, city_trail, obstacle_run, triathlon, duathlon, aquathlon, aquabike, swimrun, open_water_swim, pool_swim, swim, road_cycle, mtb, other.

---
name: agent-read
description: Read races for openrace-data without Firecrawl (free), with the agent reading the pages and price images itself. Use for backfills and batches when credits should be saved, e.g. "read the upcoming ActiUp races without Firecrawl", "backfill past races", "read these races by hand/agent", or when the user says not to spend credits but races still need prices, courses and types.
---

# Read races without Firecrawl (agent read)

In scheduled runs, Firecrawl reads each race's pages and price images (about 5 credits each). Here **you** are the reader instead, for free. Everything else is the same code: the site's **recipe** picks the pages and images, you write what Firecrawl would have returned, and the usual normalization, validation and commit do the rest (`scripts/agent-read.ts`). Background: `.claude/docs/design-v2.md` ("Readers: Firecrawl or an agent"), `scripts/lib/recipes/README.md`.

Any agent can follow this (Claude Code, Antigravity, ...). You need a shell in the repo, and a way to look at an image file.

## Rules

- **Free, but slow.** Nothing here spends Firecrawl credits. Work in batches of **5–10 races**, commit, then go on.
- **Only write what the page or image shows.** Copy numbers exactly. Never guess, never work out a price, never fill a gap from another race. A wrong price is worse than no price.
- **Follow the same instructions Firecrawl gets:** `<dir>/extraction.json` holds the prompt and JSON schema for pages (`page`) and for price images (`image`). The rules below are the ones that matter most.
- Commits go straight to `main` with `GITHUB_TOKEN=$(gh auth token)`. Never hand-edit files in `data/`.
- Races already read (by Firecrawl or an agent) are skipped by default. Don't re-read them unless the user asks (`--all`).
- **`ticket.irace.vn` (recipe `irace`) has no price images to OCR**: its price table is already text in `page-<n>.html` (`#personal`), read like any other page's `json`. Prefer it over ActiUp/irace.vn's price images when a race has (or can get) a `ticket.irace.vn` page — free either way, but no image to look at.
- **A race with no price/venue on its known source(s): check in this order** before treating it as "no source available" (plan 010):
  1. A subpage on the *same* site — the recipe may only read one page; look for an info/price tab (e.g. `/thong-tin-cuoc-dua`). Free. If found, it's worth fixing the recipe to read it, not just a one-off read.
  2. `ticket.irace.vn/<slug>` — free, a real HTML text table, no OCR.
  3. `irace.vn/su-kien/<slug>` — free, usually a text table too (`.eventon_desc_in`), but never auto-discovered; find it by search. Attaching it to a race you've already found by hand: `npm run agent-read -- prepare --race <existing-race-id-or-slug>@<new-url>` (see "Attaching a new source" below) — don't just `--race <url>` and hope the matching finds it.
  4. ActiUp / irace.vn's old poster images — last: costs Firecrawl OCR credits, or your own eyes on the image here.

## Attaching a new source to a race you've already identified

`commit`'s dry run flags an added race (`+`) with a same-day, similarly-named existing race it scored under the merge threshold for (`⚠️ possible duplicate of "..."`). When you already know — from steps above, or from that warning — that a new URL belongs to a race already in `data/index.json`, don't let the automatic name/date matching decide: attach it directly.

```bash
npm run agent-read -- prepare --race <existing-race-id-or-slug>@<new-url>
```

This reads the new URL as usual, but the source is forced onto that race's group at commit time, regardless of how its name or date compares. If the id/slug before `@` doesn't resolve, or a `matchId` doesn't match any race at commit time, the source is skipped with a clear reason instead of silently becoming a new race or falling through to the name/date guess.

## 1. Prepare (free)

```bash
git pull -q
npm run agent-read -- prepare --site actiup --limit 10          # the next 10 unread upcoming races on a site
npm run agent-read -- prepare --site actiup --past --limit 10   # past races too (backfill)
npm run agent-read -- prepare --race <url|slug|id>              # one race
npm run agent-read -- prepare --race <a> --race <b> --race <c>  # a hand-picked batch (repeat --race)
```

This clears and fills `.agent-read/` (gitignored), with one folder per race (`01-<slug>/`, ...):

| File | What |
| --- | --- |
| `page-<n>.html` | The page's relevant HTML, exactly what Firecrawl would read |
| `image-<n>.png/.jpg/...` | Price images the recipe picked, likeliest first (up to 4) |
| `task.json` | The source (url, site), `facts` from the site's own data (trusted over what you read: name, dates, venue, organizer, sale status), links, and the snapshot's fingerprint |
| `read.json` | **What you fill in**: `json` for every page and image. `ticket.irace.vn`/`irace.vn`'s price table is pre-filled as `{"prices": [...]}` (plan 010) — everything else starts `null` |

## 2. Read each race

### Look at the images

Images are often large. Make a copy you can view, and look at every one:

```bash
cd .agent-read/01-<slug>
for f in image-*; do sips -s format jpeg -Z 2000 "$f" --out "view-${f%.*}.jpg"; done     # macOS
# elsewhere: magick "$f" -resize '2000x2000>' "view-${f%.*}.jpg"
```

For a dense or very wide table, crop to the table and look again at full size. Some images turn out not to be price tables (shirt sizes, schedules): their `json` stays `{"prices": []}`.

### Page `json` (per `page-<n>.html`)

```json
{
  "pageKind": "sport",
  "types": ["road_run"],
  "name": "Giải chạy Run For The Heart - Chạy vì trái tim 2026",
  "date": "2026-12-06",
  "distances": ["2KM", "5KM", "10KM"],
  "courses": [
    { "distance": "2KM", "type": "road_run", "elevationGain": 65 }
  ],
  "edition": 5,
  "mapsUrl": "https://maps.app.goo.gl/example",
  "venue": "Công viên Yên Sở",
  "city": "Hà Nội",
  "organizer": "Gamuda Land Việt Nam",
  "currency": "VND",
  "registrationStatus": "open",
  "prices": []
}
```

- `pageKind`: `sport` (running, trail, triathlon, swimming, cycling), `non_sport` (concert, tour, hotel, conference) or `none` (login, error or empty page; then leave out everything else).
- `types`: every format offered: road_run, trail_run, city_trail, obstacle_run, triathlon, duathlon, aquathlon, aquabike, swimrun, open_water_swim, pool_swim, swim, road_cycle, mtb, other.
- `courses`: per distance, only what the page states: its format (for example, the 70km is `trail_run` while the 5km is `road_run`) and elevation gain (D+). Omit a field that isn't stated.
- `edition`: the edition number if the page states it ("lần thứ 5", "5th edition", "mùa 5"). Omit otherwise; never count editions yourself.
- `mapsUrl`: a Google Maps link or coordinates for the start/finish venue, exactly as on the page. Omit if none.
- Leave out any field the page doesn't state. `facts` in `task.json` already cover what the site states in structured form. Name as written, never translated. Dates as `YYYY-MM-DD`.
- `prices`: only amounts written in the page text. If prices are only in images, `[]`.
- **`ticket.irace.vn`/`irace.vn`'s `prices` is already pre-filled** from the page's own `<table>` (not typed by hand): check every row against `page-<n>.html`'s table before touching anything else, exactly like an image you looked at — a parser can misjudge a header or a merged cell same as a person can misread a photo. Then add the rest of the page's fields (`pageKind`, `name`, `date`, `types`, ...) around it as usual.

### Image `json` (per price image)

```json
{
  "prices": [
    { "distance": "10KM", "tier": "Early Bird", "from": "01/03", "to": "31/05/2026", "price": 1100000 }
  ],
  "distances": ["3KM", "10KM"],
  "currency": "VND"
}
```

One item per distance × tier. These rules come from real misreads (`scripts/lib/recipes/README.md`, lessons):

- **Read each row straight across.** A price belongs to the distance on its own row. Check the last row too: busy images shift rows (Vũng Tàu City Trail).
- **`tier`: the label as written**, typos included ("Supper Early Bird"). Slogans and decoration on the image are not tiers. Don't try to reword a kids/family variant to match how another source phrased the same combo ("2 adults + 1 kid" vs "2 người lớn + 1 trẻ em") — write exactly what this source says; `openrace-web` groups variant rows by parsed meaning downstream (see its `.claude/docs/price-tier-variant-grouping.md`), not by matching text across sources.
- **`price`: a plain number** ("1.100.000 VND" → `1100000`). Only amounts printed as prices. **Never compute one from a percentage**: a group table of percentages only ("Nhóm 20-99: 5%") gives no prices.
- **Group prices** (per person, by group size, printed as amounts): label them `"Group <size>"` ("Group 50+").
- **Bundles and teams** (combo of several tickets, relay team): keep that in the label ("Combo 1 (2 tickets) Early Bird", "Relay team Early Bird").
- **`audience`: only** when the table has separate prices for residents and non-residents (Việt Nam / Nước ngoài). "Cá nhân" (individual) is not an audience. Leave it out otherwise.
- **`from` / `to`: the tier's sale dates, as shown.** `YYYY-MM-DD` when the year is printed, otherwise `DD/MM`; never add a year. "đến 22/10" (until) is only `to`. No dates shown: leave both out. Never use race day.
- **Leave out** add-ons: photos, VIP upgrades, transfer or change fees, shipping, merchandise.

Write the page and image `json` into `read.json` (keep its `url`s). An image you looked at that holds no prices: `{"prices": []}`. Leaving an image's `json` as `null` means it wasn't looked at, and it's dropped. Every page must be filled in.

## 3. Check, then commit

```bash
npm run agent-read -- commit .agent-read                                     # dry run
GITHUB_TOKEN=$(gh auth token) npm run agent-read -- commit .agent-read --commit
```

The dry run prints each race after normalization: name, dates, types, courses, and every price with its kind (`super_early`, `early`, `regular`, `late`, `group`, `other`) and dates. **Compare it with the images once more**, then look at the kinds. `group` must only be group, combo and team prices, because the API's "from" price leaves them out. `✗` lines are races that can't be committed yet (a page not read, or not a sports event): fix their `read.json` or leave them out.

`--commit` makes one commit with the races and records each snapshot's fingerprint in `state/checks.json`. Scheduled Firecrawl runs then skip these races until their pages change. Main validates, resyncs openrace-api and posts to Discord.

This commit goes straight to `main` via the GitHub API (`scripts/lib/github.ts`), not your local git — `git log` in your checkout won't show it until you `git pull`. Trust the command's own printed commit SHA, not local git state.

Then `rm -rf .agent-read` and go on with the next batch.

## If something looks wrong afterwards

A wrong value in a committed race: fix the reading and commit again (`prepare --race <slug>`, fix `read.json`, commit). Or, if the source itself is wrong, set an override with the `check-race` skill (step 5). If the normalized prices differ from what you wrote in a way that repeats (a kind, a date, a dropped tier), the cause is in `scripts/lib/extraction.ts`: fix it there with a test, as the `check-race` skill says (step 4).

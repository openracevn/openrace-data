# Design v2: source-agnostic, self-maintaining race data

Agreed with the user on 2026-09-23/24. **Build status (2026-09-24):** steps 1–3 are built: schema, pipeline, and the ActiUp, VnExpress Marathon and default race-site recipes, with 82 of 82 prices right in paid checks. See `status.md`. It replaces the ActiUp-centred design in `decisions.md` where the two disagree (noted in "What changes from v1"). Build against this doc, and update it when a decision changes.

## Goals

1. **Backfill past races** (all of them, no year cutoff) for stats: which areas have more races, how prices move by year, and so on.
2. **An automated system** that finds new races and keeps known races fresh, on a schedule, with nobody reviewing commits.

Once the core fields are trustworthy, we build queries on top, e.g. "I'm in Hà Nội 15–25/11: which races are near?".

**Core fields:** race date, pricing (every tier with its dates), location, distances. Everything else comes second.

## Constraints (user decisions)

- **Any source, not just ActiUp.** Small company races mostly appear on aggregators (ActiUp, bibchung, 5bib, iRace...). Big annual races run their own sites (VnExpress Marathon, HCMC Marathon, Hạ Long...).
- **Scheduled runs use Firecrawl only.** No other API keys (no Claude API, no geocoding). An agent (Claude Code, Antigravity...) can do backfills by hand through a skill. Both paths must write the same format.
- **Budget:** about $20 in the first month (Firecrawl Hobby, 5,000 credits, for the backfill), then **≤ $5/month**, which in practice means the **Free plan: 1,000 credits/month** (pay-as-you-go top-ups need a paid plan). Minimize credits everywhere.
- **Scale:** up to 100–150 races a year.
- **Auto-commit everything.** The user doesn't review. They glance at Discord when they have time and fix mistakes by hand later. Checks before commit must do the reviewing.
- **Breaking openrace-api is fine** during this refactor. It gets updated once the data side is stable.
- **Location:** store what the site says (venue, city/province text). No lat/lng and no province normalization for now. *(Superseded 2026-09-24: v3 keeps the text and adds a `geo` block with a point, current and old admin codes and distances from places. See [plan 003](../plans/003-2026-09-24-schema-v3-geo-price.md).)*
- **Rebuild the data from scratch** with the new pipeline. Don't migrate the 5 existing race files.

## Data model

### Organizer → series → edition

All three can be filtered on.

- **Organizer:** the company or brand, e.g. Pulse Active (HCMC Marathon), VnExpress (VnExpress Marathon, Aquaman), Vietnam Mountain Marathon / Topas (VMM, Dalat Ultra Trail...).
- **Series:** a recurring event, e.g. "HCMC Marathon", "VnExpress Marathon Hà Nội", "Dalat Ultra Trail".
- **Edition = one race** (one race file). It's named by its **race-day year**, not the year it's announced or sold: HCMC Marathon 2027 is held on 17 Jan 2027 and was sold from June 2026 ("HCMC27").
- A one-off company race has an edition with no series. It may have no known organizer.

### Race (edition) fields, first cut

| Field | Notes |
| --- | --- |
| `id`, `slug`, `name` | As now (UUID key; slug may change) |
| `seriesId`, `organizerId` | Nullable |
| `types` | As now |
| `date` (+ `endDate` for multi-day) | Race day; the official site wins |
| `distances` | Official site wins |
| `location` | `{venue, city, raw}` as written by the source |
| `prices` | Tier list, see below |
| `registrations` | Every place to buy a ticket, see below |
| `links` | Every related URL, see below |
| `registrationStatus` | Derived from tier dates plus "sold out" / "hết vé" text. No extra scrape |
| `currency` | As the site gives it. No conversion |
| `overrides`, `sources`, `confidence`, timestamps | As now; `sources` carry the raw extractions (evidence) |

### Prices: every tier, with dates

```
prices: [
  { distance: "21km", tier: "Super Early Bird", kind: "super_early", audience: null, price: 660000,
    from: "2026-09-04", to: "2026-09-24", site: "vnexpress-marathon" },
  ...
]
```

- `audience` (added 2026-09-24): `resident`, `non_resident` or null, because HCMC Marathon prices every tier differently for residents and non-residents.

- `tier` keeps the label as written. `kind` is normalized: `super_early | early | regular | late | group | other`.
- Tier dates without a year ("08/7 - 18/7") take their year from the race date.
- The "current price" is worked out at read time from today's date. `priceMin`/`priceMax` can be derived for convenience.
- **Add-on fees are not entry prices:** race photos, change or transfer fees, VIP upgrades (all seen on `hcmcmarathon.com/21km/`). Keep them out, or store them separately as `extras` if ever needed.
- A seller's own discounted prices (bibchung group price) are tiers with `kind: group` and that `seller`.

### Registrations: every ticket seller

```
registrations: [
  { seller: "actiup",   url: "https://actiup.net/vi/event/lamdong-trail-2026" },
  { seller: "irace",    url: "https://ticket.irace.vn/lamdong-trail-2026" },
  { seller: "official", url: "https://hcmcmarathon.com/register/" }
]
```

**No seller is primary.** Each seller's prices sit in `prices` under that `seller`.

### Links: every related URL

```
links: [
  { url: "https://lamdongtrail.vn/", kind: "official", foundOn: "lamdongtrail.vn" },
  { url: "https://actiup.net/vi/event/lamdong-trail-2026", kind: "seller", foundOn: "lamdongtrail.vn" },
  { url: "https://drive.google.com/...", kind: "rules", foundOn: "actiup.net" }
]
```

- `kind` is one of `official | seller | facebook | rules | results | news`. `seller` links feed `registrations`.
- The `official` link is the source that wins for date, distances and location.
- **Links mostly go one way: official site → sellers.** Checked on 2026-09-24:
  - `lamdongtrail.vn` links to ActiUp, iRace, 5BIB and EnjoySport.
  - ActiUp's Lâm Đồng Trail 2026 page doesn't link back. Its page data has empty `organizer`/`website`/`fanpage` fields.
  - ActiUp's Pink Run page links only a Google Doc (the race rules).
- So official sites are found from:
  1. official sites we already watch, through their seller links (free, reliable);
  2. text on the ActiUp page that names a site;
  3. optionally, one Firecrawl Search per new race name (2 credits per 10 results), to be tested;
  4. by hand.

### When sources disagree

- **Facts that should match everywhere** (date, distances, location): **the official site wins**. The disagreement is marked ⚠️ on Discord.
- **Prices aren't merged across sellers.** Each seller keeps its own.

## Pipeline: recipes decide what to read, Firecrawl reads it

**Firecrawl doesn't need to understand a site's layout.** JSON extraction (an AI model reading page text with our schema) and Parse OCR work the same on any page. What differs per site is **which pages and images to read**, and that's the job of a **recipe**: a small piece of TypeScript in this repo, run by our script in GitHub Actions. Firecrawl never sees a recipe.

### A recipe answers three questions

1. **Where are the site's races?** A listing or API (ActiUp), hub links matching a pattern (VM `/<city>-<year>`), or a single race site.
2. **Which pages belong to one race?** One page, or the homepage plus distance/registration subpages (HCMC `/42km/ /21km/ /10km/`).
3. **Which images hold prices?** Chosen by section title (ActiUp "Chính sách giá vé"), file name (`FEE`, `BANG-GIA`, `EB`, `late`) or alt text, or none (VM: prices are text).

Sketch:

```ts
export default {
  async discover(fetchHtml) { /* free requests → race URLs */ },
  pages: (raceUrl) => [raceUrl],
  priceImages: (html) => [],
};
```

### The default recipe

Most sites get no recipe file, only a config entry:
- Follow links whose URL or text matches `cu-ly`, `km`, `gia`, `dang-ky`, `register`, `fee`, `thong-tin-cuoc-dua`.
- Extract from the **text first**.
- **Only if no prices come back,** OCR the images whose file name, alt text or heading matches price keywords.

A site gets its own recipe file only when the default guesses wrong.

### The site list (config data, not code)

One entry per site, e.g.:

```yaml
- url: https://hcmcmarathon.com/
  kind: race-site          # race-site | hub | seller
  series: hcmc-marathon
  check: quarterly
```

Adding a site means adding an entry. Seed list, from the user on 2026-09-24:

| Site | Kind | Notes |
| --- | --- | --- |
| actiup.net | seller | Main discovery source; listing API, see below |
| bibchung.pro | seller | Rendered on the server; group price per tier |
| vm.vnexpress.net | hub | About 15 races a year at `/<city>-<year>`; editions back to 2024; sister hub `aquaman.vnexpress.net` |
| vietnammtbseries.com/vi/series | hub | `/event/<slug-year>`, editions back to 2023, dates + venue as text |
| hcmcmarathon.com | race-site | Pulse Active; per-distance pages with a fee image |
| halongmarathon.com | race-site | WordPress; tier posters `BANG-GIA-EB-HBHM`, `Bang-gia-HBHMM-late-online` |
| lamdongtrail.vn | race-site | Prices as text (WooCommerce), `/cu-ly-<n>km/` pages, links to 4 sellers |
| runtolive.vn | race-site | 2027 announced; sells on its own `/mua-ve` + timve365 + truerace |

**IRONMAN (ironman.com) is left out** (user decision).

### A run, step by step

1. GitHub cron starts the Action, which runs the check script on GitHub's machine.
2. The script picks the **due** sites from the site list and state (`nextCheckAt` per site and race).
3. `discover()` uses **free** plain requests to produce race URLs. New ones are queued.
4. For each race: fetch `pages()` for free, then compute a **fingerprint** (a hash of the relevant text plus price image URLs).
5. **Fingerprint unchanged → nothing paid for.** Move on.
6. Changed or new:
   - Firecrawl JSON extraction on each page (5 credits).
   - If there are still no prices: download the chosen images, wrap each in a one-page PDF (`pdf-lib`), and send them to Firecrawl Parse with `mode: "ocr"` plus the JSON schema (about 5 credits each).
7. Merge into the race file, record `links`, validate, commit to main and post to Discord.

The fingerprint must cover **only the relevant part**. Hạ Long's homepage has a news feed and a countdown, so hashing the whole page would trigger a paid extraction every run. This is the biggest risk to the budget.

### Readers: Firecrawl or an agent

- **Scheduled runs:** Firecrawl (scrape + JSON, Parse OCR).
- **Backfills by hand:** an agent follows a skill. It uses the **same recipes** for URLs, pages and images, reads them itself (it can read images) at no Firecrawl cost, and writes the same race format. The skill must be clear enough for any agent (Claude Code, Antigravity...).

### Recipes are made by hand first

For each site, an agent studies it in a session using free requests and its own reading of the pages and images. It then writes:
- the recipe (or confirms the default works);
- **a saved test page with the known answer** (every date, distance and price tier, checked by hand).

After that comes **one paid end-to-end Firecrawl run** compared with the answer (about 5–20 credits per site). The test pages run in CI, so a recipe or prompt change can't quietly break prices, and a site changing its layout shows up as a failing health check.

**First four recipes, chosen for their different layouts:** ActiUp, VnExpress Marathon, HCMC Marathon, Hạ Long. Then Lâm Đồng Trail, Run To Live and vietnammtbseries, to see how many can use the default recipe.

## Unknown sites and unseen races

- **Unknown domains in links** (from pages we already read): try the default recipe automatically. Keep the result if it passes validation; otherwise Discord posts "needs a recipe: <site>".
- **Races linked from nowhere we watch:** add more aggregators (5bib, iRace, timve365, truerace, EnjoySport). Optionally run a monthly Firecrawl Search ("giải chạy 2027", "trail 2027"...), which costs about 10–20 credits.
- **Postponed:** Firecrawl Agent for unknown sites. The docs say dynamic pricing, "most agent runs consume a few hundred credits", a `maxCredits` cap, and "5 free daily runs". It's untested on our sites.
- **Accepted gaps:** Facebook-only races, prices behind a login (ActiUp `/tickets`), Zalo groups and Google Forms. We take what's public and add the rest by hand if it matters.
- **Monthly report on Discord:** new domains seen, how many were handled automatically, and which need a recipe.

## Schedule

- **One daily cron** decides what's due. Per-site cadence: ActiUp and other sellers weekly; hubs monthly; race sites quarterly, more often in the months before their usual race month. Manual runs stay (whole site, one race, dry run).
- Refreshes cost nothing while the fingerprint is unchanged.
- **Monthly credit cap in config.** Once reached, paid calls stop and Discord says so. Free checks keep running.

## Checks before auto-commit

- **Hard checks (block the commit):**
  - schema and sanity bounds;
  - tier dates in order, and before or on race day;
  - no tier with an absurd price;
  - no race date moving more than N days unless the official site says so.
- **Commit but mark ⚠️ on Discord:**
  - disagreement with the official site;
  - large price jumps;
  - a new domain;
  - a race with no prices 30 days before race day.
- **Health alerts:**
  - a site unreachable 2 runs in a row;
  - a page whose structure changed (e.g. ActiUp no longer including its data in the HTML);
  - a test page failing.
- Discord lines keep linking the sources, the price images and the race JSON, for quick checks by hand.

## Backfill (goal 1)

- **ActiUp's listing API** (`api.actiup.net/v2/content/events/paging`, public, no auth; see firecrawl.md) listed 301 events on 2026-09-23. Discovery is free, and old event pages usually stay up.
- **Hubs** list past editions (VM from 2024, vietnammtbseries from 2023).
- **Official single-race sites overwrite the past edition** (HCMC Marathon shows only 2026 results now). For those, try the **Wayback Machine** (free, no key). It has 2025 snapshots of `hcmcmarathon.com`, including `/10km-eng/`. It's untested whether the price images in them are readable.
- **Rough cost via Firecrawl:** about 15 credits per race. Via an agent session: free.

## Verified facts behind this design

- **Firecrawl Parse OCR works on price images** (2026-09-23): `price-pinkrun26.png` (ActiUp, Pink Run 2026) was wrapped in a one-page PDF (`sips` locally; `pdf-lib` in the Action) and sent to `POST /v2/parse` with `parsers: [{type: "pdf", mode: "ocr"}]` plus a JSON schema. **All 10 prices were correct** (2 distances × 5 tiers, with tier dates, currency VND). `creditsUsed: 5`. The OCR text had small accent errors in headings, but the numbers were exact.
- **Scrape can't read images** (docs checked 2026-09-23): markdown/HTML/JSON use page text; `images` returns URLs only; `screenshot` returns a picture. `parsers` supports only `pdf`. An image OCR parser (`"image"`, 1 credit per image) exists only in an open docs PR (firecrawl-docs#1437). Re-check it: once released, the PDF wrapping step can go.
- **ActiUp pages include their data in the HTML:** `start_date`, `categories`, `min_price`, and the description split into titled sections with image URLs (e.g. "Chính sách giá vé" → `price-pinkrun26.png`, `grouppolicy-pinkrun26.png`). The DOM id `event-description` isn't in the raw HTML (it's rendered in the browser); the embedded data is what to use.
- **VnExpress Marathon prices are plain text:** `vm.vnexpress.net/ha-noi-2026` has a table with 4 tiers (Super Early Bird 04/09–24/09, Early Bird 25/09–15/10, Regular 16/10–06/11, Late 07/11–19/11, all 2026) × 4 distances (5/10/21/42 km), plus a group discount table.
- **All 8 seed sites load with plain requests** (no blocking seen on 2026-09-24).
- **Firecrawl pricing** (2026-09-23): Free 1,000 credits/month; Hobby $19/month (or $16/month billed yearly) for 5,000 credits, extra 1,000 per $5; no rollover. Search: 2 credits per 10 results. Scrape: 1 credit per page, +4 for JSON.

## What changes from v1 (`decisions.md`)

| v1 | v2 |
| --- | --- |
| ActiUp primary for every field; bibchung fills gaps | No primary seller. The official site wins for date, distances and location; each seller keeps its own prices |
| `priceMin`/`priceMax`/`groupPriceMin` | `prices` tier list (group price = `kind: group`); min/max are derived |
| Sources = ActiUp + bibchung, hard-coded in `sources.ts` | A site list in config plus recipes; any number of sellers, hubs and race sites |
| Discovery via the Firecrawl links scrape of one listing page | Free plain requests (ActiUp listing API, hub pages); Firecrawl only reads changed or new content |
| Every known race re-extracted every 14 days | Re-extracted only when its fingerprint changes |
| Location normalized to English city + region | Location as the source writes it |
| No series or organizer | Organizer → series → edition |
| Contract changes additive only | Breaking changes allowed until openrace-api is updated |

## Build order

1. Schema: organizer/series/edition, `prices` tiers, `registrations`, `links`, location as written.
2. Pipeline: site list + recipe interface + default recipe + fingerprint state + Firecrawl reader (scrape JSON, Parse OCR with PDF wrapping) + credit cap.
3. Recipes and test pages for ActiUp, VnExpress Marathon, HCMC Marathon, Hạ Long. Each gets one paid check against its known answer.
4. Checks before commit, plus Discord ⚠️ and health alerts.
5. The agent skill for backfills (same recipes, same format).
6. Backfill of past races (Hobby month).
7. Daily cron on, drop to the Free plan.
8. Update openrace-api to the new contract.
9. Later: more sites, unknown-domain handling, monthly search, stats and queries.

## Postponed

Firecrawl Agent; lat/lng and province normalization; IRONMAN; Facebook-only races.

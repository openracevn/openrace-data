# Firecrawl: verified facts

## Design v2: what we use now (verified 2026-09-24)

- **`POST /v2/parse`** (multipart: `file` + `options` JSON) on content we fetched ourselves:
  - **HTML:** the cleaned relevant HTML of a page (`text/html` upload), with `formats: [{type: "json", schema, prompt}]`. 5 credits. Tested on VnExpress Hà Nội 2026: all 16 tier prices right.
  - **Images:** wrapped in a one-page PDF (pdf-lib), with `parsers: [{type: "pdf", mode: "ocr"}]` plus the JSON format. 5 credits. Tested on the Pink Run, HCMC Marathon and Pink Run group-price images: every price right.
  - Uploading beats `/v2/scrape` of the URL: Firecrawl reads exactly what we fingerprinted, and client-side pages can't come back empty.
- **Scrape can't read images.** `images` returns URLs only, and `parsers` accepts only `pdf` in the API reference. An `"image"` parser (1 credit per image) is in an open docs PR (firecrawl-docs#1437); once it ships, the PDF step can go.
- **Pricing:** Free is 1,000 credits per billing period. Hobby is $19/month (or $16/month billed yearly) for 5,000 credits, with extra 1,000 for $5. No rollover. Search is 2 credits per 10 results. Agent is dynamic, "most runs consume a few hundred credits", with 5 free runs a day (postponed).
- **Credit balance (free):** `GET /v2/team/credit-usage`.
- **ActiUp event detail API:** `GET https://api.actiup.net/v2/content/events/slug/<slug>`. It answers in **English unless `Accept-Language: vi`**. Fields: name, start/end date, place, `merchant_public_name`, `selling_type`, `close_registration_date`, `min_price`, and `details[]` (titled description sections). The listing's `limit` is capped at 30, and `offset` counts items.

The sections below are the v1 notes (scrape + JSON on ActiUp/bibchung URLs), kept for the history of those decisions.

Checked against docs.firecrawl.dev (`billing`, `features/monitoring`, the monitor API reference, and the webhook pages) on 2026-09-23. Re-check them before changing the ingestion path; the API is young and has been changing.

## What we use: `POST /v2/scrape`

- `formats: ["links", {type: "json", schema, prompt}]`, `waitFor: 2000` (ActiUp renders client-side), `maxAge: 0` (always a live fetch, never Firecrawl's cache).
- **Cost:** 1 credit per page, plus 4 for JSON, so **5 per extraction**. A links-only scrape costs 1. `map` costs 1 per call. No document returned means 0 credits; a 4xx/5xx page is still charged 1.
- **Rate limit on the current plan:** about 10 requests/min (429 "Rate limit exceeded"). `lib/firecrawl.ts` spaces requests 6.5 s apart and waits 60 s after a 429.
- `data.metadata.creditsUsed` reports the actual cost; `check.ts` sums it into the job summary.

## Why not Firecrawl Monitors (removed 2026-09-23)

- **One schedule per monitor**, not per page. There's no "every 14 days per race until race day".
- **A crawl monitor re-extracts every page it finds on every check.** Checking daily for new races would cost about 40 pages × 5 × 30 ≈ 6,000 credits/month, against about 100–200 for our links-only discovery.
- **`POST /v2/monitor/{id}/run` runs the whole monitor.** There's no single-page run.
- Monitor webhooks carry no extraction. `monitor.check.completed` has only ids and counts; the data is in `GET /v2/monitor/{m}/checks/{c}` → `pages[].snapshot.json`, and only for `changeTracking` JSON-mode targets. Signed with `X-Firecrawl-Signature: sha256=HMAC(raw body)`, which needs a 2xx within 10 s; retries come after 1, 5 and 15 min.
- Monitors fit a fixed set of pages on one schedule. Revisit them only if that becomes the need.

## ActiUp specifics

- **We use the Vietnamese pages** (`/vi/`), by decision on 2026-09-23. Event URLs are `https://actiup.net/vi/event/<slug>`, with an `/en/` twin that we ignore.
- The sitemap does **not** list event pages.
- **Discovery is verified** (2026-09-23, via the API):
  - Firecrawl renders `/vi/events/sports` and finds 12 events.
  - Each event page has a "Có thể bạn sẽ thích" block linking to other events. We deliberately don't follow it.
  - **ActiUp's listing API** (found in the page's JS bundle): `GET https://api.actiup.net/v2/content/events/paging?event_type=sports&limit=12&offset=N&price=&selling_type=&category_id=&event_time=`, public JSON with no auth. `result.paging` = `{current_page, total_item, total_page}`; each item has `event_slug`, `name` (English), `start_date`/`end_date`, `min_price`, `selling_type` (`selling`/`sold_out`), `open_/close_registration_date`, `merchant_public_name`, `short_place`, and `categories` (empty on upcoming events). On 2026-09-23: 301 events, 40 of them upcoming. It's undocumented and could change.
  - `/map` of actiup.net found ~41 event URLs across both locales, some of them past or non-sport events.
- **Every card also links to `/vi/event/<objectId>/tickets`.** That page is a login wall, with no prices or distances. It's excluded in `includePaths` and in `isEventPage`.
- **An event page shows:** name, date or date range ("21 - 22 tháng 11, 2026"), venue, organizer, a single **"Chỉ từ" (from) price**, and a free-text description. Distances appear only when the description mentions them, and there's no max price or foreigner rule. So we no longer ask for `priceMax` or `foreignerEligible`; they stay `null`.
- **Rendering is occasionally flaky:** about 1 in 20 scrapes returned an empty (~200-char) page. On such a page the model once invented a whole race (`registrationUrl: example.com`). The prompt now asks for `sport: "none"` in that case, and it did so on the next flaky page.
- The sports listing mixes running, triathlon (IRONKIDS, FesTRIval, Sunrise Sprint), swimming and cycling. **All sports are kept** (user decision, 2026-09-23) and classified into `types`. Only non-sport pages (`pageKind: non_sport`) and broken ones (`none`) are skipped.
- **ActiUp's own categories** (`/api/content/event/categories?category_type=sports`): Road Running, Trail Running, Marathon, Half Marathon, Triathlon, Aqualon/Aquathlon, Swim, Mountain Bike, Cross-Country, and some non-sport ones. Only the older `/api/…/paging` listing returns them, and only on past events: the last tagged one is from 2025-11, and none of the 40 upcoming races are tagged. The tags are also inconsistent ("Marathon" and "Road Running" used interchangeably). So we classify types ourselves; ActiUp's tags could seed a past-race backfill.

## bibchung.pro specifics (checked 2026-09-23 over plain HTTP)

- Next.js, but **rendered on the server**: a plain `curl` gets the full content. Unlike ActiUp, there's no empty-render problem.
- The listing `/events` has real paging (`/events?page=2`), and `sitemap.xml` lists every event (12 on 2026-09-23), with `/en/events/<slug>` twins.
- Event page `/events/<slug>`: name, date (`24/01/2027`), venue, description, schedule. It also has JSON-LD `SportsEvent` data (startDate/endDate, location).
- **The registration section lists a price row per tier and distance: regular price, then the bibchung price**, e.g. `EARLY BIRD · 07/09/2026 – 22/10/2026 · 21KM · 678.000 ₫ · 542.000 ₫`. That gives us distances, the price range and `groupPriceMin`.
- Slugs often match ActiUp's (`tet-run-mien-nam-2027`, `vietnam-festrival-2027`) but not always (`vungtau-citytrail-2026` vs `vung-tau-city-trail`), so we match races by date + name.

## Extraction test (2026-09-23): 10 pages, each scraped twice

- **Cost:** 5 credits per page for scrape + JSON. **Rate limit:** 10 requests/min on the current plan.
- **Result:** 8 running races, and both triathlons rejected. That test predates `types`; triathlons are now kept.
- **Drift:** on the second pass over unchanged pages, and after the fixes, 1 of 8 races would still commit: `lamdong-trail-2026` gained an `85km` distance, which is genuine model variance.
- **Drift fixes, all in code:**
  - `stabilize()` keeps the previous venue and organizer when only the wording changed.
  - An unknown city falls back to the venue's province.
  - Fields the page doesn't carry are no longer extracted.

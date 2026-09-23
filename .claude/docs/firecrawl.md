# Firecrawl: verified facts

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
  - Each event page has a "Có thể bạn sẽ thích" block linking to other events (e.g. `lamdong-trail-2026` and `global-gate-halong-esg-marathon-2026`, which aren't on the listing), so a crawl reaches more.
  - `/map` of actiup.net found ~41 event URLs across both locales, some of them past or non-sport events.
- **Every card also links to `/vi/event/<objectId>/tickets`.** That page is a login wall, with no prices or distances. It's excluded in `includePaths` and in `isEventPage`.
- **An event page shows:** name, date or date range ("21 - 22 tháng 11, 2026"), venue, organizer, a single **"Chỉ từ" (from) price**, and a free-text description. Distances appear only when the description mentions them, and there's no max price or foreigner rule. So we no longer ask for `priceMax` or `foreignerEligible`; they stay `null`.
- **Rendering is occasionally flaky:** about 1 in 20 scrapes returned an empty (~200-char) page. On such a page the model once invented a whole race (`registrationUrl: example.com`). The prompt now asks for `sport: "none"` in that case, and it did so on the next flaky page.
- ActiUp also lists triathlons (IRONKIDS, FesTRIval, Sunrise Sprint), cycling, swimming and attractions. The `sport` enum plus a name check (`MULTISPORT_NAME` in `extraction.ts`) filters them out.

## Extraction test (2026-09-23): 10 pages, each scraped twice

- **Cost:** 5 credits per page for scrape + JSON. **Rate limit:** 10 requests/min on the current plan.
- **Result:** 8 running races, and both triathlons rejected.
- **Drift:** on the second pass over unchanged pages, and after the fixes, 1 of 8 races would still commit: `lamdong-trail-2026` gained an `85km` distance, which is genuine model variance.
- **Drift fixes, all in code:**
  - `stabilize()` keeps the previous venue and organizer when only the wording changed.
  - An unknown city falls back to the venue's province.
  - Fields the page doesn't carry are no longer extracted.

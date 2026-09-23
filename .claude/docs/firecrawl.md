# Firecrawl: verified facts

Checked against docs.firecrawl.dev (`webhooks/overview`, `webhooks/events`, `webhooks/security`, `features/monitoring`, the v2 OpenAPI spec) on 2026-09-23. Re-check them before changing the ingestion path; the API is young and has been changing.

## Webhooks

- Payload envelope: `{ success, type, id, webhookId?, data, metadata, error? }`.
- **Signature:** header `X-Firecrawl-Signature: sha256=<hex>`, computed as HMAC-SHA256 over the **raw body** with the account webhook secret. There is no timestamp, so there is no replay protection beyond the HMAC itself.
- **Delivery:** the endpoint must return a 2xx within **10 s**. Failed deliveries are retried after 1 min, 5 min and 15 min, then marked failed.
- Monitor events: `monitor.page` (one per page, sent before the check is reconciled) and `monitor.check.completed`.
- The docs show `data` as an array, but the schema describes an object. `checkRefs()` in the Worker accepts both.

## The trap: webhooks carry no extracted data

- `monitor.check.completed` carries only `monitorId`, `checkId`, `status` and summary counts.
- `monitor.page` carries a diff plus an optional judgment, **not** the extraction.
- The full extraction is only in `GET /v2/monitor/{monitorId}/checks/{checkId}` → `data.pages[].snapshot.json`, and **only if** the monitor's target uses `scrapeOptions.formats: [{ type: "changeTracking", modes: ["json"], schema, prompt }]`.
- That endpoint accepts `?status=same|new|changed|removed|error&limit≤100&skip`. Pagination goes through `next` (top-level or under `data`).
- For JSON-mode monitors, `diff.json` is a per-field `{previous, current}` map keyed by JSON path. We ignore it and recompute diffs ourselves from the snapshot.

## Monitor config (what `create-monitor.ts` sends)

- `POST /v2/monitor` with `name`, `schedule` (`{text: "every 6 hours", timezone: "Asia/Ho_Chi_Minh"}`; the minimum interval is 5 min), and `targets` (1–50; types `scrape`, `crawl` or `search`).
- We use one `crawl` target: `url: https://actiup.net/vi/events/sports`, `crawlOptions: { includePaths: ["^/vi/event/[^/]+/?$"], limit: 500 }`.
- `webhook: { url, events: ["monitor.check.completed"] }`. Custom `headers` and `metadata` are also supported but unused.
- A `goal` (LLM judging) is optional for crawl targets and costs 1 credit per changed page. We don't set one.

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

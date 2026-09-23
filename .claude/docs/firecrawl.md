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
- We use one `crawl` target: `url: https://actiup.net/en/events/sports`, `crawlOptions: { includePaths: ["^/en/event/.+"], limit: 500 }`.
- `webhook: { url, events: ["monitor.check.completed"] }`. Custom `headers` and `metadata` are also supported but unused.
- A `goal` (LLM judging) is optional for crawl targets and costs 1 credit per changed page. We don't set one.

## ActiUp specifics

- Event URLs look like `https://actiup.net/en/event/<slug>` (with a `/vi/` twin).
- The sitemap does **not** list event pages, only static pages and `/en/events/sports` / `/en/events/attractions`.
- Listing pages are client-rendered Next.js; a plain `curl` finds no event links. Whether Firecrawl's crawl discovers them from the listing is **unverified**. Check the first check's page list.
- ActiUp also lists non-running events (cycling, swimming, attractions). The extraction's `isRunningRace` flag filters them out.

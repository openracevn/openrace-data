# Status (end of 2026-09-24)

Direction and the questions we're building toward: [roadmap.md](roadmap.md). Design v2 is being built (`design-v2.md`). The v1 race data was removed; data is rebuilt from scratch with the new pipeline.

## Built and verified

- **Schema v2:** price tiers with dates and audience (resident / non-resident), series and organizers, registrations, links, flags; location as written. JSON Schema in `schema/`.
- **Site list** `config/sites.yaml`:
  - read with a recipe: ActiUp, VnExpress Marathon, and 4 race sites (HCMC Marathon, Hạ Long, Lâm Đồng Trail, Run To Live);
  - recognized in links only: bibchung, 5BIB, iRace, EnjoySport, timve365, njuko, TrueRace, Vietnam MTB Series.
- **Recipes:**
  - `actiup`: public API, price-section images;
  - `vnexpress-marathon`: banner + ticket table only;
  - `default`: race sites, home + subpages + price images.
- **Reading:** Firecrawl Parse on our own cleaned HTML, or a price image wrapped in a PDF (OCR); about 5 credits each. Cached by content hash in `state/reads.json`. Unchanged snapshots are skipped by fingerprint.
- **Paid end-to-end checks** (2026-09-24), every price compared by eye with the page or image: **82 of 82 correct.**
  - Pink Run 2026 on ActiUp: 18 prices, including group prices.
  - VnExpress Hà Nội 2026: 16.
  - HCMC Marathon 2027: 48, including resident / non-resident.
  - Kept as `test/answers.test.ts`.
- **Free dry runs against the live sites work:** ActiUp lists 41 upcoming races (≤425 credits to read them all the first time), VM 15 (≤85), and each race site ≤20–50.
- **Agent reads (2026-09-24):** `npm run agent-read -- prepare | commit` and the `agent-read` skill (`.claude/skills/agent-read/SKILL.md`). An agent reads pages and price images itself, for free; same recipes, format, normalization and commit, and the fingerprint is recorded so Firecrawl runs skip the race. First used on Run For The Heart and Prenn Trail Summit 2026.
- **Workflows:**
  - `check.yml` has v2 inputs (site / race / past / limit / max credits / free / dry run). Manual only.
  - `main.yml` validates, resyncs openrace-api when `data/` changed, and posts to Discord.
- **openrace-api reads schema v2** (2026-09-24, openrace-api `65f6d00`): 300 races, 39 series and 113 organizers in production after a full resync (Main run 35907691347, 0 errors). `prices[]` plus a derived `priceFrom` (cheapest tier that isn't a group price); `/series` and `/organizers` endpoints. `region` is gone from the API.
- **Schema v3 and the API (2026-09-24, plans 003 and 004):** `courses[]` with meters, `edition`, tier `inferred`, `geo` (267 of 300 located), `state/freshness.json`. openrace-api reads v3: price on a date, near / from a place, sorting, freshness on every race, daily freshness cron. See [summary part 3](2026-09-24-summary-part-3.md). The 61-race geo fix (8719672) is in the API too (resynced after the user upgraded the Cloudflare plan).
- **The MCP server (2026-09-24, [plan 005](../plans/005-2026-09-24-mcp-server.md)), path step 5:** deployed, `openracevn/openrace-mcp`, stateless Streamable HTTP over a service binding to openrace-api. Five tools (`search_races`, `get_race`, `list_places`, `find_series`, `get_series`) answer the roadmap's six questions in one or two calls — checked live by `scripts/eval.ts` and by hand through the deployed server. `https://openrace-mcp.bmp.workers.dev` (`GET /` lists connect instructions and tools), inspector at `https://openrace-inspector.pages.dev`. openrace-api got a small companion change: an `X-MCP-Secret` bypass (`source = mcp-upstream` in the metrics, so a tool call isn't double-counted), and `src/lib/arg-summary.ts` (copied into both repos) writes `blob8`, a coarsened "what people ask" summary, on `/races` and every MCP tool call. Not yet done: step 5 of the plan itself ("try it with a real assistant" — a live Claude session asking the six questions in Vietnamese and English) and step 6 (turning that into a contract-changes list for openrace-api) — see the plan file for a running note on both.

## Data (2026-09-24)

- **Series from slugs across years:** 39 series, 92 races (commit 2f7a6bf). Renamed events aren't linked; set `seriesId` by hand with an override.
- **300 ActiUp races seeded with `--facts-only`** (0 credits; commit bf98deb, fix f459f9b): every sports event ActiUp lists, 2024–2027, 35 of them upcoming.
  - **What they have:** name, dates, venue, organizer (113 organizers), sale status, and links.
  - **What they don't have yet:** prices, courses and types (`other`), until a normal run reads them. `state/checks.json` marks them `facts`.
- **First paid batch (2026-09-24): 10 upcoming ActiUp races read, 100 credits** (commit ca25eed). Checked by eye against every price image. That found 5 error patterns, now fixed in normalization and replayed for free (9341f84, 9dd2444); see the lessons in `scripts/lib/recipes/README.md`. Known answers added: Sơn Trà City Trail, Quảng Trực, Đà Lạt Xanh 2026.
  - **Vũng Tàu City Trail 2026: prices set by hand** (override, commit 26545c4). The model shifted the image's rows. A re-read with the new prompt (10 credits) shifted them again. The override stays until someone removes it (`npm run edit -- unset vung-tau-city-trail prices`), so later price changes on ActiUp won't show.
  - Tết Run Miền Nam 2027: the Early Bird starts on 2026-10-22, but the image only says "until 22/10".
  - No prices on ActiUp: Kun Fun Run Đồng Tháp, 2027 Sunrise Sprint and IRONKIDS Đà Nẵng.
- 31 upcoming races are left (≤325 credits by the dry run). A normal run (`--site actiup`) reads the upcoming ones first, at about 10–15 credits per race. Past races wait for a paid month (`--past`).

## Firecrawl account

Free plan: 1,000 credits per billing period (23rd to 23rd). On 2026-09-24, 1,453 were left before testing; the tests used about 185; then the batch used 100 and the Vũng Tàu re-read 10 (about 1,160 left). The cap in `config/sites.yaml` (`monthlyCredits: 900`) counts calendar months (UTC).

## Next

- [ ] **race-research follow-up from the 2026-09-25 pilot** ([summary](2026-09-25-summary-race-research.md)): run `agent-read` on the 3 ActiUp-backed Andros races (2024/2025/2026) for their actual prices, which race-research correctly declined to fetch itself. (The `openrace`-tagged-source cleanup is done — 0 races left with that tag, dataset-wide.)
- [ ] **MCP server: [plan 005](../plans/005-2026-09-24-mcp-server.md)** (path step 5) — deployed and working (see above); left: try it with a real assistant in Vietnamese and English, and write up the contract list for openrace-api. Then the frontend, after the API contract has been through real use (it isn't on the roadmap path yet: add it when that plan is written).
- [ ] **Read the other 29 upcoming ActiUp races with the `agent-read` skill** (free, batches of 5–10). Firecrawl batches are on hold (user, 2026-09-24). Then VM (15 races) and the race sites the same way.
- [ ] Paid check of the default recipe on Hạ Long, Lâm Đồng Trail and Run To Live (≤20–50 each), with their prices added to `test/answers.test.ts`.
- [ ] Recipes: bibchung (group prices; server-rendered), vietnammtbseries (hub).
- [ ] Backfill past races (`--past`), on a paid month.
- [ ] Turn on the daily cron once the data is trusted.
- [x] **Schema v3 and the API: [plan 003](../plans/003-2026-09-24-schema-v3-geo-price.md), done and live 2026-09-24** ([summary](2026-09-24-summary-part-3.md)). Left for the user: review `config/places.yaml`, an ORS key (optional), 33 races without a point. Adds `courses[]` with meters, tier dates filled in, a `geo` block (point, current and old admin codes, driving distance from 13 places), `edition`, freshness per race (`state/freshness.json` → API), and API price on a date (`?at=`), `near`, `fromPlace` and sorting. It replaces "location as written, not normalized". 
- [ ] openrace-api: route tests in the Workers runtime.
- [ ] Paid check of the official race sites found in the ActiUp study (in `config/sites.yaml` with `recipe: none`), then switch them to `recipe: default`.

## Known gaps

- **Race sites are one edition at a time:** the site's current edition only. Past editions need the Wayback Machine or a seller's old page.
- **Only PNG and JPEG images can be OCR'd** (pdf-lib). WebP and GIF are skipped, with a note in the run report.
- **Series across renamed events** ("Chạy Vì Trái Tim" → "Run for the Heart") aren't detected.
- **Race names are as the site writes them**, so the same race can be named differently by different sites. The official site's name wins.

# Status (end of 2026-09-24)

Design v2 is being built (`design-v2.md`). The v1 race data was removed; data is rebuilt from scratch with the new pipeline.

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
- **Workflows:**
  - `check.yml` has v2 inputs (site / race / past / limit / max credits / free / dry run). Manual only.
  - `main.yml` validates and posts to Discord. **The openrace-api resync is paused** (`if: false`) until the API reads schema v2.

## Data (2026-09-24)

- **Series from slugs across years:** 39 series, 92 races (commit 2f7a6bf). Renamed events aren't linked; set `seriesId` by hand with an override.
- **300 ActiUp races seeded with `--facts-only`** (0 credits; commit bf98deb, fix f459f9b): every sports event ActiUp lists, 2024–2027, 35 of them upcoming.
  - **What they have:** name, dates, venue, organizer (113 organizers), sale status, and links.
  - **What they don't have yet:** prices, distances and types (`other`), until a normal run reads them. `state/checks.json` marks them `facts`.
- **First paid batch (2026-09-25): 10 upcoming ActiUp races read, 100 credits** (commit ca25eed). Checked by eye against every price image. That found 5 error patterns, now fixed in normalization and replayed for free (9341f84, 9dd2444); see the lessons in `scripts/lib/recipes/README.md`. Known answers added: Sơn Trà City Trail, Quảng Trực, Đà Lạt Xanh 2026.
  - **Vũng Tàu City Trail 2026: prices set by hand** (override, commit 26545c4). The model shifted the image's rows. A re-read with the new prompt (10 credits) shifted them again. The override stays until someone removes it (`npm run edit -- unset vung-tau-city-trail prices`), so later price changes on ActiUp won't show.
  - Tết Run Miền Nam 2027: the Early Bird starts on 2026-10-22, but the image only says "until 22/10".
  - No prices on ActiUp: Kun Fun Run Đồng Tháp, 2027 Sunrise Sprint and IRONKIDS Đà Nẵng.
- 31 upcoming races are left (≤325 credits by the dry run). A normal run (`--site actiup`) reads the upcoming ones first, at about 10–15 credits per race. Past races wait for a paid month (`--past`).

## Firecrawl account

Free plan: 1,000 credits per billing period (23rd to 23rd). On 2026-09-24, 1,453 were left before testing; the tests used about 185. On 2026-09-25, the batch used 100 and the Vũng Tàu re-read 10 (about 1,160 left). The cap in `config/sites.yaml` (`monthlyCredits: 900`) counts calendar months (UTC).

## Next

- [ ] **Next session (ask first; the user is saving credits):** read the other 31 upcoming ActiUp races for prices, distances and types, in small batches (`--site actiup --limit 10`, about 10–15 credits per race). Then VM (15 races, ≤85 credits), then the race sites.
- [ ] Paid check of the default recipe on Hạ Long, Lâm Đồng Trail and Run To Live (≤20–50 each), with their prices added to `test/answers.test.ts`.
- [ ] Recipes: bibchung (group prices; server-rendered), vietnammtbseries (hub).
- [ ] Agent skill for backfills without Firecrawl: same recipes, the agent reads pages and images and writes `extracted`, then `npm run sync`.
- [ ] Backfill past races (`--past`), on a paid month.
- [ ] openrace-api: read schema v2, then re-enable `notify-api` in `main.yml`.
- [ ] Turn on the daily cron once the data is trusted.
- [ ] Paid check of the official race sites found in the ActiUp study (in `config/sites.yaml` with `recipe: none`), then switch them to `recipe: default`.

## Known gaps

- **Race sites are one edition at a time:** the site's current edition only. Past editions need the Wayback Machine or a seller's old page.
- **Only PNG and JPEG images can be OCR'd** (pdf-lib). WebP and GIF are skipped, with a note in the run report.
- **Series across renamed events** ("Chạy Vì Trái Tim" → "Run for the Heart") aren't detected.
- **Race names are as the site writes them**, so the same race can be named differently by different sites. The official site's name wins.

# Status (2026-09-24)

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

## Firecrawl account

Free plan: 1,000 credits per billing period (23rd to 23rd). On 2026-09-24, 1,453 were left before testing; the tests used about 150. The cap in `config/sites.yaml` (`monthlyCredits: 900`) counts calendar months (UTC).

## Next

- [ ] First real committed runs, in small batches: `--site actiup --limit 10`, then VM, then the race sites. About 10–15 credits per ActiUp race the first time.
- [ ] Paid check of the default recipe on Hạ Long, Lâm Đồng Trail and Run To Live (≤20–50 each), with their prices added to `test/answers.test.ts`.
- [ ] Recipes: bibchung (group prices; server-rendered), vietnammtbseries (hub).
- [ ] Agent skill for backfills without Firecrawl: same recipes, the agent reads pages and images and writes `extracted`, then `npm run sync`.
- [ ] Backfill past races (`--past`), on a paid month.
- [ ] openrace-api: read schema v2, then re-enable `notify-api` in `main.yml`.
- [ ] Turn on the daily cron once the data is trusted.
- [ ] Review the ActiUp 20-race study (`.claude/docs/study/`, written by another agent) and merge its findings.

## Known gaps

- **Race sites are one edition at a time:** the site's current edition only. Past editions need the Wayback Machine or a seller's old page.
- **Only PNG and JPEG images can be OCR'd** (pdf-lib). WebP and GIF are skipped, with a note in the run report.
- **Series for ActiUp races** aren't detected yet (only the organizer, from `merchant_public_name`).
- **Race names are as the site writes them**, so the same race can be named differently by different sites. The official site's name wins.

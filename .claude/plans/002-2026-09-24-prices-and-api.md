# Plan for 2026-09-24: read upcoming prices, then update openrace-api

**For:** the next Claude Code session.
**Read first:**
- `.claude/docs/status.md`
- `.claude/docs/2026-09-24-summary.md`
- `scripts/lib/recipes/README.md`

## Where we start

- 300 ActiUp races (2024–2027), created from ActiUp's API only (`--facts-only`). They have name, dates, venue, organizer, sale status and links. **No prices, distances or types yet.**
- 39 series and 113 organizers.
- About 1,270 Firecrawl credits left in the billing period (23/09–23/10, Free plan).
- The openrace-api resync is paused (`main.yml`, `notify-api` has `if: false`).

## Rules

- **Say the cost before every paid run**, and run with `--free` first: it shows what would be read and the most it would cost.
- **Batches of 10 races.** After each batch, check the Discord post and a few races by eye (open the price image and compare every tier) before the next batch.
- **Commit with the user's gh login:** `GITHUB_TOKEN=$(gh auth token)`.
- **If a batch shows a pattern of wrong prices,** stop: fix the code (recipe, prompt or normalization), add the race to `test/answers.test.ts`, then `renormalize`. Don't just re-read.

## Part 1: prices for the 35 upcoming ActiUp races

1. `npm run check -- --site actiup --free --dry-run` shows how many races are left to read and the most it would cost (expect ≤ ~425).
2. First batch:
   ```bash
   GITHUB_TOKEN=$(gh auth token) npm run check -- --site actiup --limit 10
   ```
   About 10–15 credits per race. The facts-only races are read first, because they have no fingerprint yet.
3. Check the batch:
   - Discord lists prices and flags per race.
   - For 3 races, compare every price with the image by eye (download it with curl and look at it), including tier dates, `audience` and group prices.
   - Check that races with no price section on ActiUp (the study found VPBank Hanoi, Techcombank, Global Gate Hạ Long) end up with no prices, not invented ones.
4. Repeat until all upcoming races are read, or stop at ~600 credits left.
5. Add one or two hand-checked races to `test/answers.test.ts` (save their source as `test/fixtures/read-*.json`).

**Watch for:**
- **`--limit` applies before the unchanged/facts filter.** If a batch reads fewer than 10, the listing order put already-read races first. That's fine, just run again.
- **Past races (`--past`) are left out.** They wait for a paid month.

## Part 2 (if credits allow): VM and the race sites

- **VnExpress Marathon:** `--site vnexpress-marathon --free --dry-run`, then the paid run. 15 races, ≤85 credits.
- **Race sites:** HCMC Marathon, Hạ Long, Lâm Đồng Trail, Run To Live. ≤20–50 each. HCMC's reads are already cached in `state/reads.json`, so it should be nearly free.
- **Matching:** check that VM and race-site races match their ActiUp races (same race, not duplicates). The race should end up with both sources, a `flags` entry if their dates disagree, and the official site's date winning.

## Part 3: update openrace-api to schema v2

This is a separate repo (openrace-api, a Cloudflare Worker). Read its code first; don't assume its layout.

1. **Contract changes it must handle** (`schema/*.schema.json`, `SCHEMA_VERSION` 2):
   - `prices[]` tiers (`distance`, `tier`, `kind`, `audience`, `price`, `from`, `to`, `site`) replace `priceMin`/`priceMax`/`groupPriceMin`. If the API or frontend needs a "from" price, derive it (the cheapest non-group tier, or the current tier by today's date).
   - New fields: `endDate`, `seriesId`, `organizerId`, `registrations[]`, `links[]`, `flags[]`.
   - `location` is `{venue, city}` as written; there's no `region` any more.
   - `sources[]` use `site` / `role` / `extracted` instead of `name` / `rawExtracted`.
   - New files: `data/series.json` and `data/organizers.json`. `data/index.json` entries have `seriesId` and `linkUrls`.
2. Update its storage and endpoints, and its tests, against the current `main` of openrace-data.
3. Deploy, then re-enable the resync in openrace-data's `main.yml`: restore `if: needs.changes.outputs.data_changed == 'true'` on `notify-api`.
4. **Full resync:** Actions → Main → Run workflow (validates `main` and calls the API). It must report no rejected files.
5. Update `.claude/docs/status.md`, `infrastructure.md` and the memory note (the resync is no longer paused).

## Done when

- Every upcoming ActiUp race has prices, or is known to have none on ActiUp.
- Batch results were checked by eye, and at least one more race is in `test/answers.test.ts`.
- openrace-api serves schema v2 and the resync is back on, or, if Part 3 didn't fit, the plan says what's left.
- Docs, and a day summary for 2026-09-24, are written.

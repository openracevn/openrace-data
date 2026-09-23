# Status (2026-09-23)

## Done

- Repo `openracevn/openrace-data` (renamed from `openracevn/data`; the git remote is updated).
- Ingestion is `check.yml` + `scripts/check.ts` (GitHub Actions + Firecrawl scrape API). The Worker and Monitor are removed.
- Extraction tested live on ActiUp's VI pages (see firecrawl.md).
- `npm run check` verified live in dry-run mode:
  - `daily` with a cap of 6: 5 races added and a triathlon rejected, 31 credits. That was before all sports were kept and `types` was added; the new extraction is not live-tested yet.
  - `race` with a URL: 1 race, 5 credits.
  - Bad input (unknown id, tickets URL, unknown mode) exits 1 with a clear message.
- `DISCORD_WEBHOOK_URL` Actions secret set.

## Data (2026-09-23)

- **First load:** 4 ActiUp races, via Actions (`7dce052`); Tết Run's distances fixed with `renormalize`.
- **bibchung** added as the second source; migration added `groupPriceMin: null` and index name/date.
- **The daily schedule is OFF** (user decision, 2026-09-23). Every run is manual until the data is trusted.

## Not done / not verified

- [ ] Create a fine-grained PAT, then set the `OPENRACE_BOT_TOKEN` Actions secret.
- [ ] Set the `FIRECRAWL_API_KEY` Actions secret.
- [ ] First real (committing) run: Actions → Check races → `daily`. The first run bootstraps about 20–40 races, which takes more than one day at the 40-page cap.
- [ ] Confirm that the checker's commit triggers `main.yml` and that the first Discord message looks right.
- [ ] `SYNC_WEBHOOK_URL`, once openrace-api exists.

## Known gaps

- **Removed events.** An event that disappears from ActiUp keeps its file. A refresh of its page would error (404) and be retried every 3 days until race day. Decide whether to mark it `closed` or flag it.
- **Distance drift.** The model sometimes lists a distance from the description text and sometimes doesn't, which can cause an occasional `distances` commit.
- **Multi-day dates.** "21 - 22 tháng 11" stores the 21st, even if the race itself is on the 22nd.
- **Discovery reach.** Discovery reads only the listing page, which shows 12 of ActiUp's ~40 upcoming sports events. The site's page buttons are client-side, with no URL parameter. ActiUp's listing API (`api.actiup.net/v2/content/events/paging?event_type=sports&limit=12&offset=N`, public JSON) lists all 301 sports events (40 upcoming); switching discovery to it is proposed. Until then, a manual `race` run with a URL adds a missing race.
- **Race matching** is heuristic (±1 day + name similarity ≥ 0.5). A wrong match would merge two races; watch the Discord `+bibchung` lines.

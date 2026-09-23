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

## API readiness (2026-09-23)

- Done: `schemaVersion` + JSON Schema in `schema/`; sanity bounds; a resync payload with changed race ids.
- Still open before going public: load the rest of the upcoming races (~35); a read-only token for openrace-api.
- The bibchung prompt was re-tested on Tết Run: prices are now correct (678,000 / 678,000 / group 542,000); the organizer is still the event name, and the code guard drops it.

## Not done / not verified

- [x] `OPENRACE_BOT_TOKEN` Actions secret set.
- [x] First real runs, checker commits triggering `main.yml`, and Discord messages (2026-09-23).
- [ ] `SYNC_WEBHOOK_URL` and `SYNC_SECRET`, once openrace-api is deployed. `notify-sync` already sends the header and loops until the API reports `remaining: 0` (2026-09-23).

## Known gaps

- **Removed events stay** (decided). A refresh of a vanished page errors (404) and is retried every 3 days until race day, at 1 credit each, since a failed scrape still costs the base credit.
- **Distance drift.** The model sometimes lists a distance from the description text and sometimes doesn't, which can cause an occasional `distances` commit.
- **Multi-day dates.** "21 - 22 tháng 11" stores the 21st, even if the race itself is on the 22nd.
- **Discovery reach.** Discovery reads only the listing page, which shows 12 of ActiUp's ~40 upcoming sports events. The site's page buttons are client-side, with no URL parameter. ActiUp's listing API (`api.actiup.net/v2/content/events/paging?event_type=sports&limit=12&offset=N`, public JSON) lists all 301 sports events (40 upcoming); switching discovery to it is proposed. Until then, a manual `race` run with a URL adds a missing race.
- **Race matching** is heuristic (±1 day + name similarity ≥ 0.5). A wrong match would merge two races; watch the Discord `+bibchung` lines.

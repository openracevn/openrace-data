# openrace-data

The source of truth for [OpenRace](https://openrace.vn): endurance sports events in Vietnam (road and trail running, triathlon and other multisport, swimming, cycling), stored as one JSON file per race, with git history as the audit trail.

This repo is the **data layer only**. It does not serve an API and it has no database. It holds JSON files, ingests updates, and records every change as a commit.

## Architecture

```
 check.yml (GitHub Actions: daily 07:17 VN, or run by hand)
   │ 1. discover: scrape the ActiUp listing for links, extract only unknown event pages
   │ 2. refresh: re-extract known races every 14 days until race day; past races never
   │ 3. Firecrawl scrape + JSON extraction → normalize → diff against main HEAD
   │ 4. one commit via GitHub API (race files + index + state/checks.json)
   ▼
 openracevn/openrace-data  (this repo, main)
   │ push to main
   ├──▶ validate (every push, except check-log-only pushes)
   ├──▶ notify-api      POST SYNC_WEBHOOK_URL   (only if data/ changed, after validate)
   └──▶ notify-discord  races added/updated     (only if data/ changed)
                 │
                 ▼
 openrace-api (separate repo, later): Worker + D1, public API → openrace-mcp, frontend
```

| Repo | Role |
| --- | --- |
| **openrace-data** (this) | SSOT: JSON files, ingestion, git history |
| openrace-api (later) | Cloudflare Worker + D1. Reads this repo and serves the public API |
| openrace-mcp, frontend (later) | Consume the API |

MVP scope: a single source (ActiUp, actiup.net) with no cross-source verification. The schema is already multi-source, so reconciliation can be added later without migrating existing data.

## Layout

```
data/
  races/<id>.json        one file per race (id = UUID)
  index.json             [{ id, slug, lastModified, sourceUrls }] for cheap listing
state/
  checks.json            when each source page was last scraped, and the outcome
scripts/
  check.ts               the race checker (discover / refresh / one race)
  sync.ts                diff/commit core: planSync (pure) + syncToGitHub
  sync-cli.ts            commit hand-made extractions (dry run by default)
  validate.ts            CI: schema + index + check-log consistency
  notify-discord.ts      push summary to Discord (GitHub Action)
  notify-sync.ts         tell openrace-api to resync (GitHub Action)
  lib/                   schema (zod), extraction schema + normalization, check
                         schedule, Firecrawl client, places, slugs, GitHub I/O
test/                    node:test suite
.github/workflows/       check.yml (scheduled), main.yml (push to main), ci.yml (PRs)
```

## Race record

```jsonc
{
  "id": "955725b2-ff80-4643-8ef9-9540ba23ab3a", // UUID = filename, never changes
  "slug": "tay-ho-half-marathon-2026",          // frontend URL slug, may change
  "name": "Tay Ho Half Marathon 2026",
  "types": ["road_run"],                        // one or more formats, see below
  "date": "2026-11-15",
  "distances": ["5km", "10km", "21km"],
  "location": { "venue": "Tay Ho Lake", "city": "Hanoi", "region": "north" },
  "priceMin": 300000,
  "priceMax": 800000,
  "currency": "VND",
  "registrationStatus": "open",               // open | closing_soon | sold_out | closed
  "registrationUrl": "https://…",
  "organizer": "…",
  "foreignerEligible": true,
  "sources": [
    {
      "name": "actiup",
      "url": "https://actiup.net/vi/event/…",
      "lastCheckedAt": "2026-09-23T10:00:00.000Z",
      "lastChangedAt": "2026-09-20T08:00:00.000Z",
      "rawExtracted": { /* verbatim Firecrawl JSON extraction */ }
    }
  ],
  "confidence": "single-sourced",
  "createdAt": "…",
  "updatedAt": "…"
}
```

The schema lives in `scripts/lib/schema.ts` (zod). Notes:

- **`null` means unknown.** `venue`, `city`, `region`, `priceMin`, `priceMax`, `registrationStatus`, `registrationUrl`, `organizer` and `foreignerEligible` are `null` when the source doesn't state them. We never guess a value such as `open` or `false`. ActiUp event pages only show a "from" price (`priceMin`) and say nothing about foreign runners, so `priceMax` and `foreignerEligible` are always `null` for now.
- **`sources` is always an array** and **`confidence` is always present**, even with a single source. Canonical fields are *derived* from `sources[].rawExtracted` by `scripts/lib/reconcile.ts`, so adding a second source means changing `reconcile` (and adding new `confidence` values), not rewriting files.
- **Normalization** (`scripts/lib/extraction.ts`): standard distances are snapped (`21.1K` and `Half Marathon` both become `21km`), city names are mapped to an English display name plus a region (`TP. Hồ Chí Minh` becomes `Ho Chi Minh City` / `south`), and dates and prices are coerced. As a result, LLM wording drift between checks doesn't register as a change.
- **`types`** (filterable, one or more per race): `road_run`, `trail_run`, `city_trail` (urban trail), `obstacle_run`, `triathlon` (swim+bike+run), `duathlon` (run+bike+run), `aquathlon` (swim+run), `aquabike` (swim+bike), `swimrun`, `swim`, `road_cycle`, `mtb`, `other`. Distance classes (marathon, half, ultra) are not types: filter on `distances`. The model picks the types; names containing "City Trail", "Triathlon"/"Ironman", "Duathlon", "Aquathlon" or "Swimrun" force the matching type.
- **Identity:** `id` is a random UUID. It's the file name and the key everywhere, and it never changes. `slug` is for frontend URLs and can be changed freely, by hand or by a future slug scheme; ingestion keeps whatever slug a race has. A new race starts with the source's own slug (ActiUp's `/vi/event/<slug>`), with a `-2` suffix if another race already uses it. The source URL maps to the race through `index.json`'s `sourceUrls`, so a renamed race keeps its file.

## Ingestion (`scripts/check.ts`)

`.github/workflows/check.yml` runs the checker every day and on demand. It calls the Firecrawl scrape API directly, with no Firecrawl Monitor and no webhook. The reason is that a monitor has one schedule for all its pages and would re-extract every page on every run.

| Mode | What it scrapes | When |
| --- | --- | --- |
| `daily` | `discover` + `refresh` | the scheduled run |
| `discover` | The listing `https://actiup.net/vi/events/sports` for links (1 credit), then every `/vi/event/<slug>` page on it that we don't know yet | by hand, to pick up a new race now |
| `refresh` | Known races whose date hasn't passed and that were last checked 14+ days ago (3+ days after a failed check). Past races are never checked | by hand |
| `race` | One race, by id or ActiUp URL, whatever its schedule | by hand |

Rules (`scripts/lib/checks.ts`):

- **State.** `state/checks.json` records each scraped URL's last check and outcome. It sits outside `data/`, so a run that changes no race commits only the log, which triggers no Discord message and no API resync.
- **Rejected pages.** A page that isn't a sports event (concert, tour, hotel, conference) is marked `permanent` and never re-checked automatically. Every sport is kept. Other failures (a flaky render, a race with no date yet, a scrape error) are retried after 3 days.
- **Budget.** Each extraction costs 5 credits (1 scrape + 4 JSON). `--max-scrapes` (default 40) caps a run. Leftovers wait for the next run, oldest check first.
- **Rate limit.** Requests are sequential, 6.5 s apart, and a 429 waits 60 s before retrying.
- **Commits.** Everything goes into **one commit per run** through the Git Data API. If `main` moved meanwhile, the run re-plans on the new head (up to 3 attempts). An unchanged race writes nothing.

Only `/vi/event/<slug>` pages count as events. The `/vi/event/<id>/tickets` pages are a login wall, and the `/en/` twins would duplicate races.

### Setup

Repo secrets (Settings → Secrets and variables → Actions):

| Secret | What |
| --- | --- |
| `FIRECRAWL_API_KEY` | Firecrawl API key |
| `OPENRACE_BOT_TOKEN` | Fine-grained PAT with **Contents: read and write** on this repo only. It must not be the built-in `GITHUB_TOKEN`: pushes made with that token don't trigger `main.yml`, so validation and Discord would be skipped |
| `DISCORD_WEBHOOK_URL` | Discord channel webhook (optional) |
| `SYNC_WEBHOOK_URL` | openrace-api resync endpoint (optional; leave unset until the API exists) |

Run by hand: Actions → **Check races** → Run workflow → pick a mode (and a race for `race`). Tick *dry run* to see the plan without committing. Locally, `--dry-run --preview <dir>` also writes the planned files to `<dir>`.

## GitHub Actions

| Workflow | Trigger | Does |
| --- | --- | --- |
| `check.yml` | daily 00:17 UTC (07:17 in Vietnam), or by hand | the race checker above |
| `ci.yml` | pull request | typecheck, tests, `validate` |
| `main.yml` | push to `main` (ignored when only `state/` changed) | Runs `validate`. When the push touched `data/`, also runs **notify-api** (after validation passes; POSTs `{event, repository, ref, before, after, pushedAt}` to `SYNC_WEBHOOK_URL`) and **notify-discord** (a summary of races added, updated and removed, plus which fields changed, built from the git diff) |

If `DISCORD_WEBHOOK_URL` or `SYNC_WEBHOOK_URL` is unset, its step logs "skipping" and passes.

## Local commands

```bash
npm install && cp .env.example .env      # FIRECRAWL_API_KEY; GITHUB_TOKEN only for committing
npm test
npm run typecheck
npm run validate
npm run check -- --mode daily --max-scrapes 5 --dry-run    # live scrape, no commit
npm run check -- --mode race --race <id|slug|url> --dry-run
npm run sync -- inputs.json [--commit]   # commit hand-made extractions
npm run renormalize [-- --commit]        # re-apply normalization to stored extractions (no scraping)
```

## Limits to know

- **Scheduled runs can start 5–30 minutes late**, and GitHub may drop some under heavy load. The next daily run catches up.
- **Private repo:** Actions minutes count against the account allowance (2,000 min/month on Free). A daily run takes about 1–5 minutes.
- **Distances vary between checks.** The model sometimes lists a distance from the description text and sometimes doesn't, which can cause an occasional `distances` commit.
- **Multi-day events store the first day** of the range ("21 - 22 tháng 11" becomes the 21st).

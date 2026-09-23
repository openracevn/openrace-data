# Decisions

## Kept from the original spec (don't simplify)

- **`sources` is always an array and `confidence` is always set**, even with one source. They're the hooks for multi-source reconciliation and the "verified" badge. Canonical fields are derived from `sources[].rawExtracted` by `reconcile()`, so a second source means changing `reconcile.ts` and adding `confidence` values. Adding enum members needs no data migration.
- **One commit per ingestion run**, made through the GitHub API (Octokit Git Data API), never local git.
- **No change means no commit.** An extraction that normalizes to the same canonical fields writes nothing.
- **No DB and no API in this repo.**

## Departures from the spec, and why

| Spec said | We did | Why |
| --- | --- | --- |
| Firecrawl Monitor → webhook → Cloudflare Worker | **GitHub Actions `check.yml` + Firecrawl scrape API**; the Worker and Monitor are removed | User request, 2026-09-23: new races daily, known races every 14 days until race day, never after, and manual runs per race or for discovery. Monitors have one schedule per monitor, re-extract every page each check (~10× the credits), and can't run a single page (see firecrawl.md) |
| `registrationStatus` is one of 4 values | Also allows `null` | We don't invent `open` when the page doesn't say. The same goes for venue, prices, organizer, etc. `null` means unknown |
| `index.json` = slugs + lastModified | Plus `sourceUrls` | Lets ingestion map URL → slug without reading every file, so renamed races keep their id |
| Discord on every push to main | Discord only when the push touches `data/` | User request, 2026-09-23 |
| (unspecified) | ActiUp **Vietnamese** pages only (`/vi/event/<slug>`); names are stored as written, not translated | User request, 2026-09-23. One locale means no duplicates between the `/en/` and `/vi/` twins |
| `priceMax`, `foreignerEligible` extracted | Kept in the schema but not asked of ActiUp, so they're always `null` | ActiUp event pages don't show them; the model invented values and flipped them between runs |
| Running races only | **All sports events**, each with `types` (road_run, trail_run, city_trail, obstacle_run, triathlon, duathlon, aquathlon, aquabike, swimrun, swim, road_cycle, mtb, other) | User decision, 2026-09-23: the frontend filters by format. `types` is an array because events mix formats. Name rules force obvious types ("City Trail", "Triathlon"/"Ironman", …). Marathon/half/ultra are distances, not types |
| Resync webhook after every commit | Only when `data/` changed **and** validation passed | Keeps invalid data from reaching the API |

## Other choices

- **Identity (user decision, 2026-09-23):** `id` is a random UUID. It's the file name and the API key, and it never changes. `slug` is separate and **may change**, for SEO; a slug scheme will be designed later. For now a new race takes the source's slug (ActiUp `/vi/event/<slug>`), plus a `-2` suffix if that slug is taken. Ingestion never overwrites an existing slug. `validate` enforces unique slugs. Source URL → id goes through `index.json.sourceUrls`.
- **Source URLs are canonicalized**: no query string, hash, `www.` or trailing slash.
- **Normalization** exists to suppress LLM drift between checks. It snaps standard distances (`21.1K`/`Half Marathon` → `21km`), maps cities to an English display name plus region, and coerces `DD/MM/YYYY` dates and `"350.000đ"` prices. If you see noisy commits, fix them here rather than in the diff logic.
- **Only canonical fields drive changes.** A `rawExtracted` difference that normalizes to the same canonical values is not a change, so `rawExtracted` and `lastCheckedAt` only refresh when a file is written anyway.
- **Invalid existing files make ingestion throw** instead of being silently overwritten. The run goes red and the next run tries again.
- **Concurrent runs:** `check.yml` has a concurrency group, and `updateRef(force:false)` returns a 422 if `main` moved anyway (e.g. a manual push). We re-plan on the new head, up to 3 attempts.
- **The check log (`state/checks.json`) is separate from race data.** Race files change only when canonical fields change, so "when was this last scraped" can't live in them without a commit and a Discord post on every check. `state/` is outside `data/`, so `main.yml` skips pushes that only touch it (`paths-ignore`).
- **Schedule rules** (`lib/checks.ts`):
  - A known race is refreshed every **14 days** until race day (inclusive, in Vietnam's date). After race day it's never checked again.
  - A failed check is retried after 3 days.
  - A "not a sports event" page (`pageKind: non_sport`) is never re-checked automatically. A manual `race` run overrides that.
  - A run extracts at most 40 pages (`--max-scrapes`), stalest first.
- **Discovery doesn't re-extract known pages.** It scrapes the listing for links only and extracts just the unknown URLs. It doesn't follow links from race pages (user decision, 2026-09-23: listing only).
- **The Discord summary comes from `git diff`**, not from commit messages, so it's accurate for manual edits and merges too. Values are shown inline for `date`, `priceMin`, `priceMax`, `registrationStatus` and `foreignerEligible`.
- **`notify-discord` doesn't wait for `validate`**, so a bad data push still gets announced.

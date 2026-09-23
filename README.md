# openrace-data

The source of truth for [OpenRace](https://openrace.vn): running races in Vietnam (road, trail, marathon), stored as one JSON file per race, with git history as the audit trail.

This repo is the **data layer only**. It does not serve an API and it has no database. It holds JSON files, ingests updates, and records every change as a commit.

## Architecture

```
 Firecrawl Monitor ── monitor.check.completed ──▶ worker/ (Cloudflare Worker)
 (crawls actiup.net,                               │ 1. verify HMAC signature
  JSON-mode extraction)                            │ 2. fetch new/changed pages of the check
                                                   │ 3. diff against data/ at main HEAD
                                                   │ 4. one commit via GitHub API (Octokit)
                                                   ▼
                                      openracevn/data  (this repo, main)
                                                   │ push to main (touching data/)
                              ┌────────────────────┼─────────────────────┐
                              ▼                    ▼                     ▼
                         validate            notify-api              notify-discord
                     (schema + index)   POST SYNC_WEBHOOK_URL     summary of races
                                        (after validate passes,   added/updated and
                                         only if data/ changed)   fields changed
                                                   │
                                                   ▼
                              openrace-api (separate repo, later): Worker + D1, public API
                                                   │
                                                   ▼
                                      openrace-mcp, frontend (later)
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
  races/<slug>.json      one file per race
  index.json             [{ id, lastModified, sourceUrls }] for cheap listing
scripts/
  sync.ts                diff/commit core: planSync (pure) + syncToGitHub
  sync-cli.ts            run a sync by hand (dry run by default)
  validate.ts            CI: schema + index consistency
  notify-discord.ts      push summary to Discord (GitHub Action)
  notify-sync.ts         tell openrace-api to resync (GitHub Action)
  create-monitor.ts      one-off Firecrawl Monitor setup
  lib/                   schema (zod), extraction schema + normalization,
                         place/region table, slugging, reconciliation, GitHub I/O
worker/                  ingestion Worker (the webhook receiver only)
test/                    node:test suite
.github/workflows/       ci.yml (PRs), main.yml (push to main)
```

## Race record

```jsonc
{
  "id": "tay-ho-half-marathon-2026",          // = filename, stable forever
  "name": "Tay Ho Half Marathon 2026",
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
      "url": "https://actiup.net/en/event/…",
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

- **`null` means unknown.** `venue`, `city`, `region`, `priceMin`, `priceMax`, `registrationStatus`, `registrationUrl`, `organizer` and `foreignerEligible` are `null` when the source doesn't state them. We never guess a value such as `open` or `false`.
- **`sources` is always an array** and **`confidence` is always present**, even with a single source. Canonical fields are *derived* from `sources[].rawExtracted` by `scripts/lib/reconcile.ts`, so adding a second source means changing `reconcile` (and adding new `confidence` values), not rewriting files.
- **Normalization** (`scripts/lib/extraction.ts`): standard distances are snapped (`21.1K` and `Half Marathon` both become `21km`), city names are mapped to an English display name plus a region (`TP. Hồ Chí Minh` becomes `Ho Chi Minh City` / `south`), and dates and prices are coerced. As a result, LLM wording drift between checks doesn't register as a change.
- **Identity:** a new race gets `slug(name) + year` (e.g. `tay-ho-half-marathon-2026`, with a `-2` suffix on collision). After that, the source URL maps to the id through `index.json`'s `sourceUrls`. A race that gets renamed keeps its file.

## Ingestion (`worker/`)

Firecrawl Monitor webhooks don't carry the extracted data. Per the [event reference](https://docs.firecrawl.dev/webhooks/events), `monitor.check.completed` carries only `monitorId`, `checkId` and summary counts, and `monitor.page` carries a diff. So the Worker works like this:

1. Accepts `POST /webhooks/firecrawl` and verifies `X-Firecrawl-Signature: sha256=<HMAC-SHA256(raw body, FIRECRAWL_WEBHOOK_SECRET)>`, which is Firecrawl's [signing scheme](https://docs.firecrawl.dev/webhooks/security). This is the shared-secret check: the secret is your account's webhook secret, and nothing extra goes over the wire.
2. Handles only `monitor.check.completed` and acknowledges anything else with 200.
3. Calls `GET /v2/monitor/{monitorId}/checks/{checkId}?status=new|changed` (paginated) and takes each page's `snapshot.json`, which is the full JSON-mode extraction.
4. Runs `syncToGitHub`, which reads `index.json` plus the affected race files at `main` HEAD, plans the changes and writes **one commit per delivery** (Git Data API: tree, commit, fast-forward ref update). If `main` moves meanwhile, it re-plans on the new head (up to 3 attempts).
   - new race: creates the file
   - changed canonical fields: rewrites the file, bumps `updatedAt` and that source's `lastChangedAt`, and lists the changed fields in the commit message
   - no change: writes nothing and makes no commit (`lastCheckedAt` only advances when a file is written anyway)
5. Firecrawl wants a 2xx within 10s. The Worker returns the real result if it finishes within 8s, so a failure returns 500 and Firecrawl retries. Otherwise it returns 202 and finishes in `waitUntil`. Retries are safe because an unchanged extraction produces no commit.

Not handled yet: pages with status `removed` (ignored for now; the race file stays as is) and cross-source reconciliation.

### Setup

```bash
npm install
cp .env.example .env                       # fill in values

# Worker
npx wrangler secret put FIRECRAWL_WEBHOOK_SECRET --config worker/wrangler.toml
npx wrangler secret put FIRECRAWL_API_KEY        --config worker/wrangler.toml
npx wrangler secret put GITHUB_TOKEN             --config worker/wrangler.toml
npm run worker:deploy

# Firecrawl Monitor (review the dry run first)
npm run monitor:create
npm run monitor:create -- --create
```

`GITHUB_TOKEN` must be a fine-grained PAT (or GitHub App token) with **Contents: read & write** on this repo. Commits pushed with the Actions `GITHUB_TOKEN` do not trigger workflows, so that token would silently skip the notifications.

The monitor crawls `https://actiup.net/en/events/sports` and keeps `/en/event/…` pages. ActiUp renders its listings client-side and leaves event pages out of its sitemap, so check the first crawl's results and adjust `ACTIUP_START_URL` / `includePaths` if needed.

## GitHub Actions

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | pull request | typecheck, tests, `validate` |
| `main.yml` | every push to `main` | `validate` on every push. When the push touched `data/`: **notify-api** (after validation passes, POSTs `{event, repository, ref, before, after, pushedAt}` to `SYNC_WEBHOOK_URL`) and **notify-discord** (summary of races added/updated/removed and which fields changed, built from the git diff). Code-only pushes send nothing. |

Repo secrets: `DISCORD_WEBHOOK_URL`, `SYNC_WEBHOOK_URL`. If either is unset, its step logs "skipping" and passes. Leave `SYNC_WEBHOOK_URL` empty until openrace-api exists.

## Local commands

```bash
npm test                 # unit tests (planner, normalization, signature check)
npm run typecheck
npm run validate         # schema + index consistency for data/
npm run sync -- inputs.json [--commit]   # replay extractions; dry run unless --commit
npm run worker:dev       # local Worker (secrets in worker/.dev.vars)
```

## Limits to know

- Each changed race costs one GitHub read. That's fine on Workers Paid (1000 subrequests per request). On the free plan (50), checks with more than about 40 changed races will fail and get retried. If that happens, move to Paid or a Queue.
- Work that outlives the 8s response window runs in `waitUntil`, which Cloudflare caps at 30s after the response.

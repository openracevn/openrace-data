# Infrastructure

## Components

| Component | Where it runs | Code | Job |
| --- | --- | --- | --- |
| Race checker | GitHub Actions (`check.yml`: **manual only for now**; daily cron is commented out) | `scripts/check.ts` | Finds new ActiUp races, re-checks the ones that are due, commits to GitHub |
| Firecrawl | Firecrawl (hosted API) | `scripts/lib/firecrawl.ts` | Scrapes and renders pages, and does the LLM JSON extraction (`/v2/scrape`), for ActiUp (primary) and bibchung (group-purchase prices) |
| Data repo `openracevn/openrace-data` (private) | GitHub | `data/`, `state/` | SSOT: `data/races/*.json` + `data/index.json`; the check log is `state/checks.json`; git history is the audit trail |
| Main workflow | GitHub Actions | `.github/workflows/main.yml` | Validates pushes to `main`; when `data/` changed, notifies the API and Discord |
| CI workflow | GitHub Actions | `.github/workflows/ci.yml` | Typecheck, tests and `validate` on pull requests |
| Discord channel | Discord | `scripts/notify-discord.ts` | Human-readable change feed |
| openrace-api | Cloudflare Worker + D1 (not built) | separate repo | Will receive the resync webhook and serve the public API |

## Data flow

```
check.yml  (cron daily, or workflow_dispatch: mode = daily|discover|refresh|race)
  │ npm run check -- --mode …
  │  1. read data/index.json, race files, state/checks.json from the checkout
  │  2. discover: scrape the listing for links (1 credit); queue unknown /vi/event/<slug> pages
  │     refresh: queue known races with date ≥ today (VN) and last check ≥ 14 days ago
  │     race: queue the one race asked for
  │  3. extract each page (5 credits), sequentially 6.5 s apart
  │  4. syncToGitHub: planSync against main HEAD + merge the check log → ONE commit
  │     (createTree → createCommit → updateRef force:false; retry ×3 if main moved)
  ▼
openracevn/openrace-data main   (commit authored with the OPENRACE_BOT_TOKEN PAT, so it triggers main.yml)
  ▼
main.yml  (skipped entirely when only state/** changed)
  ├─ changes          did the push touch data/?
  ├─ validate         typecheck, tests, validate
  ├─ notify-api       needs changes+validate, only if data/ changed → POST SYNC_WEBHOOK_URL
  └─ notify-discord   needs changes only, only if data/ changed → Discord summary from git diff
```

## Code map

| Path | Role |
| --- | --- |
| `scripts/check.ts` | CLI: picks the pages to scrape, scrapes them, commits; writes the Actions job summary |
| `scripts/lib/checks.ts` | Check-log schema and schedule rules: `isRefreshDue` (14 days, until race day), `isCandidate` (unseen pages, or retry after 3 days; permanent rejections are skipped), `vietnamDate` |
| `scripts/lib/firecrawl.ts` | `/v2/scrape` client: `links()` (1 credit), `extract()` (5 credits); pacing and retry on 429/5xx |
| `scripts/lib/schema.ts` | zod schema for races and the index, `CANONICAL_FIELDS`, `serialize` (stable 2-space JSON + newline) |
| `scripts/lib/extraction.ts` | `EXTRACTION_SCHEMA` / `EXTRACTION_PROMPT`; `normalizeExtracted` → canonical fields, incl. `types` (name rules + model) |
| `scripts/lib/diff.ts` | `changedFields`, and `stabilize` (ignores venue/organizer rewording) |
| `scripts/lib/places.ts` | Vietnamese city/province → English display name + region; tries each comma-separated part |
| `scripts/lib/reconcile.ts` | sources[] → canonical fields (per field, first source with a value: ActiUp, then bibchung) + confidence (single-/multi-sourced, conflicting) |
| `scripts/lib/sources.ts` | Per source: hosts, listing URLs, the event-page test (`/vi/event/<slug>` only) |
| `scripts/lib/slug.ts` | `canonicalSourceUrl` (the initial race slug comes from `SOURCES[x].slugOf`) |
| `scripts/lib/github.ts` | Octokit: read files at a commit, write many files as one commit |
| `scripts/sync.ts` | `planSync` (pure: groups a run's pages per race, matches new pages to races from other sources by date + `nameSimilarity`), `syncToGitHub` (I/O + retry + `extraFiles` for the check log), `formatCommitMessage` |
| `scripts/renormalize.ts` | Re-derive canonical fields from stored `rawExtracted` after rule changes (no scraping) |

## Tooling

- Node ≥ 22, TypeScript 7 (`tsc`), `tsx` for scripts, `node:test` for tests. Imports use `.ts` extensions.
- Actions use `actions/checkout@v7` and `actions/setup-node@v7`; jobs run Node 22.
- The Cloudflare Worker and Firecrawl Monitor setup existed until 2026-09-23 and were removed; see decisions.md.

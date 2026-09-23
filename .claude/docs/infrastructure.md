# Infrastructure

## Components

| Component | Where it runs | Code | Job |
| --- | --- | --- | --- |
| Firecrawl Monitor | Firecrawl (hosted) | set up by `scripts/create-monitor.ts` | Crawls ActiUp on a schedule, extracts race JSON, sends `monitor.check.completed` webhooks |
| Ingestion Worker `openrace-ingest` | Cloudflare Workers | `worker/` | Verifies the webhook, fetches changed pages, commits to GitHub |
| Data repo `openracevn/data` | GitHub | `data/` | SSOT: `data/races/*.json` + `data/index.json`; git history is the audit trail |
| Main workflow | GitHub Actions | `.github/workflows/main.yml` | Validates every push to `main`; on `data/` changes, notifies the API and Discord |
| CI workflow | GitHub Actions | `.github/workflows/ci.yml` | Typecheck, tests and `validate` on pull requests |
| Discord channel | Discord | `scripts/notify-discord.ts` | Human-readable change feed |
| openrace-api | Cloudflare Worker + D1 (not built) | separate repo | Will receive the resync webhook and serve the public API |

## Data flow

```
Firecrawl Monitor (crawl https://actiup.net/en/events/sports, keep /en/event/*)
  │  POST monitor.check.completed   (X-Firecrawl-Signature: sha256=HMAC(body))
  ▼
Worker  POST /webhooks/firecrawl
  │  1. verify HMAC with FIRECRAWL_WEBHOOK_SECRET          → 401 if bad
  │  2. GET api.firecrawl.dev/v2/monitor/{m}/checks/{c}?status=new|changed
  │     take pages[].snapshot.json (full JSON-mode extraction)
  │  3. planSync against main HEAD (reads index.json + affected race files)
  │  4. one commit: createTree → createCommit → updateRef(force:false)
  │     retry up to 3x if main moved (422)
  │  respond with the real result within 8s (500 → Firecrawl retries),
  │  else 202 and finish in waitUntil
  ▼
openracevn/data main
  │  push (PAT-authored, so it triggers Actions)
  ▼
main.yml
  ├─ changes          did the push touch data/?  (first push / unknown before → yes)
  ├─ validate         typecheck, tests, validate  (every push)
  ├─ notify-api       needs changes+validate, only if data/ changed → POST SYNC_WEBHOOK_URL
  └─ notify-discord   needs changes only, only if data/ changed → Discord summary from git diff
```

## Code map

| Path | Role |
| --- | --- |
| `scripts/lib/schema.ts` | zod schema for races and index, `CANONICAL_FIELDS`, `serialize` (stable 2-space JSON + newline) |
| `scripts/lib/extraction.ts` | `EXTRACTION_SCHEMA` / `EXTRACTION_PROMPT` sent to Firecrawl; `normalizeExtracted` → canonical fields |
| `scripts/lib/places.ts` | Vietnamese city/province → English display name + region (north/central/south) |
| `scripts/lib/reconcile.ts` | sources[] → canonical fields + confidence (MVP: highest-priority source wins) |
| `scripts/lib/sources.ts` | host → source name, event-page URL test (`/(en\|vi)/event/…`) |
| `scripts/lib/slug.ts` | `raceSlug(name, date)`, `canonicalSourceUrl` |
| `scripts/lib/github.ts` | Octokit: read files at a commit, write many files as one commit |
| `scripts/sync.ts` | `planSync` (pure, testable), `syncToGitHub` (I/O + retry), `formatCommitMessage` |
| `worker/src/firecrawl.ts` | HMAC verify, check-page fetch with pagination |
| `worker/src/index.ts` | HTTP handler and the 8s respond-or-background logic |

The Worker bundles code from `scripts/`, so anything imported there must stay runtime-neutral: no `node:` imports and no `Buffer`. Node-only code goes in the CLI entry points (`sync-cli.ts`, `validate.ts`, `notify-*.ts`, `create-monitor.ts`) and `lib/env.ts`.

## Tooling

- Node ≥ 22, TypeScript 7 (`tsc`), `tsx` for scripts, `node:test` for tests.
- Two typecheck projects: the root `tsconfig.json` (Node types) and `worker/tsconfig.json` (Workers types).
- Imports use `.ts` extensions (`allowImportingTsExtensions`).
- Wrangler 4. The Worker bundle is about 950 KiB (155 KiB gzipped), mostly Octokit and zod.
- Actions use `actions/checkout@v7` and `actions/setup-node@v7` on Node 24; jobs run Node 22.

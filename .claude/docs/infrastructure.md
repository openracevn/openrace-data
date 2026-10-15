# Infrastructure

## Components

| Component | Where it runs | Code | Job |
| --- | --- | --- | --- |
| Schedule 1: discovery (plan 027) | GitHub Actions `schedule-1.yml`, daily, cron 00:07 Vietnam with a 02:07 retry (GitHub starts it hours late) | `scripts/check.ts --discover` | Free: lists the sellers with a recipe (ActiUp, iRace) daily and the hubs and race sites with a recipe on Monday of even ISO weeks, records unchanged pages as checked, refreshes free facts on changed pages, creates new races from facts, and puts new and changed pages on `state/todo.json`. On Monday it adds every source page of every upcoming race. Once a day (a retry does nothing). 0 credits |
| Schedule 2: details (plan 027) | GitHub Actions `schedule-2.yml`, when Schedule 1 finishes (fallback cron 03:07 Vietnam) | `scripts/check.ts --todo` | Reads every page on the to-do list with Firecrawl (past races dropped, an unchanged page from the read cache for free), any site with a recipe, no per-run cap, `scheduledMonthlyCredits` per month; a page leaves the list once read, and one that fails 3 times goes to the digest. Commits, waits for Main, then starts openrace-web's Deploy (`repository_dispatch data-updated`) |
| Race checker (button) | GitHub Actions `check.yml`, by hand with inputs | `scripts/check.ts` | A site, a race, or every site with a recipe now; full monthly cap |
| Monday digest | GitHub Actions `digest.yml`, Mondays 09:00 in Vietnam (cron, so hours late) | `scripts/notify-stale.ts`, then `scripts/notify-weekly.ts` | The data digest: freshness share, the to-do list and what Schedule 2 couldn't read, races that need a Claude `update-race` session, the week's and month's credits. Then the weekly numbers |
| Firecrawl | Firecrawl (hosted API) | `scripts/lib/firecrawl.ts` | Scrapes and renders pages, and does the LLM JSON extraction (`/v2/scrape`), for ActiUp (primary) and bibchung (group-purchase prices) |
| Data repo `openracevn/openrace-data` (public, not promoted; the API reads it without a token) | GitHub | `data/`, `state/` | SSOT: `data/races/*.json` + `data/index.json`; the check log is `state/checks.json`; git history is the audit trail |
| Main workflow | GitHub Actions | `.github/workflows/main.yml` | Validates pushes to `main`; when `data/` changed, notifies the API and Discord. One job (each job bills a minute and reinstalls dependencies; the repo hit the free-minutes cap on 2026-09-29 at ~21 pushes a day) |
| CI workflow | GitHub Actions | `.github/workflows/ci.yml` | Typecheck, tests and `validate` on pull requests; a newer push to the same PR cancels the older run |
| Discord channel | Discord | `scripts/notify-discord.ts` | Human-readable change feed |
| openrace-api | Cloudflare Worker + D1, `https://openrace-api.bmp.workers.dev` | separate repo (`../openrace-api`), deployed by hand (`pnpm run deploy`) | Receives the resync webhook, pulls changed race files plus series and organizers, answers openrace-mcp. **Internal since 2026-10-12 (plan 025):** every route except `/internal/*` answers 404 without `X-MCP-Secret`; the public URL stays only for the sync webhook (`X-Sync-Secret`). Daily cron 00:30 UTC |
| openrace-mcp | Cloudflare Worker, `https://openrace-mcp.bmp.workers.dev/mcp` | separate repo (`../openrace-mcp`), deploys on push to `main` | **The product and the only public way in.** Calls openrace-api through the service binding `API` with `X-MCP-Secret`. Serves `/` (docs), `/llms.txt` (about, how to connect, license), `/health`, `/dash` (usage) |
| openrace-web | Cloudflare Worker static assets, `https://openrace-web.bmp.workers.dev` | separate repo (`../openrace-web`), deployed by its `deploy.yml` on push and once a day after Schedule 2 (`repository_dispatch` with `OPENRACE_BOT_TOKEN`) | The website, back 2026-10-13 after the 2026-10-12 archive. Every page is rendered ahead of time (`pnpm mirror`) and served as a static file, so a view runs no code (the free plan's CPU limit took the old Worker down, error 1102). A tiny Worker handles only search, filter counts and filtered list URLs. Rendering reads openrace-api's public URL with `X-MCP-Secret`; the Worker uses the service binding. Pages are a snapshot until the next run. KV `openrace-web-inc-cache` is no longer used |

## Data flow

```
schedule-1.yml (daily, 17:07 UTC)              ──completed──▶  schedule-2.yml (or 20:07 UTC fallback)
  │ npm run check -- --discover (free)            │ npm run check -- --todo (paid)
  │  1. read data/index.json, race files and state/ (todo.json too) at main HEAD (GitHub API)
  │  2. S1: each due site's listing (ActiUp API, iRace home, hub/race-site pages), free;
  │     S2: the pages on state/todo.json, past races dropped
  │  3. snapshot each page (free HTTP) and fingerprint it; never-read pages and the soonest
  │     race day first
  │  4. S1, per page: unchanged → checked; changed or new → free facts refreshed, on the
  │     to-do list; Monday: every upcoming race's pages on the list too.
  │     S2, per page: cached → read for free; else Firecrawl, 5 credits per page or image,
  │     6.5 s apart; read → off the list; failed → failures+1 (3 → the digest)
  │  5. syncToGitHub: planSync against main HEAD + merge the check log and the list → ONE
  │     commit (createTree → createCommit → updateRef force:false; retry ×3 if main moved)
  ▼
openracevn/openrace-data main   (commit authored with the OPENRACE_BOT_TOKEN PAT, so it triggers main.yml)
  ▼
main.yml  (skipped entirely when only state/** changed; ONE job, steps in this order, since 2026-09-29)
  ├─ detect changes   did the push touch data/? anything outside data/, state/, .claude/, *.md?
  ├─ npm ci           once
  ├─ notify discord   only on push, only if data/ changed → Discord summary from git diff (before validate; retries a 429, and a failed post doesn't stop the steps below)
  ├─ typecheck+test   skipped when the push only touched data/, state/, .claude/ or *.md
  ├─ validate
  ├─ notify api       only if data/ changed, after the steps above pass → POST SYNC_WEBHOOK_URL
  └─ alert discord    only if a step above failed (plan 025)
```

**Monday digest:** `digest.yml` (Mondays 09:00 in Vietnam) runs `npm run notify:stale`: freshness share of the non-final races (final recomputed from the index's dates at read time), the to-do list by reason with the most it could cost, the pages Schedule 2 failed to read 3 times, races that need a Claude session (`update-race`, with the reason), and the week's and month's credits (`state/credits.json` keeps a day key per Vietnam day for 62 days). `npm run notify:stale -- --dry-run` prints it any day: it is the answer to "what needs attention today".

**Weekly numbers:** `digest.yml` then runs `npm run notify:weekly`: one Discord message with MCP tool calls, caller keys and clients per week and the completeness score against a week before, read from openrace-mcp's public `/weekly.json`. These are the numbers OpenRace is measured by (roadmap: not page views).

**End-to-end check:** `npm run e2e` (`scripts/e2e-check.ts`, plan 025) checks the whole chain against the deployed Workers: the API is closed (404) but its webhook answers, the MCP server is up, every tool answers the roadmap questions, and races in this checkout match what `get_race` returns. No secrets, no writes, ~20 MCP calls. Run it on an up-to-date `main` after any change to the API, the MCP server or the sync.

## Traps

- **A site's series hint can orphan a series entry.** `config/sites.yaml` gives halongmarathon.com `series: ha-long-heritage-marathon`, but the race's `seriesId` is overridden to `halong-bay-heritage-marathon`. Until 2026-10-13, every sync that touched that source re-added the hint's series to `data/series.json` with no race in it, and `validate` went red (API notify skipped). `planSync` now adds a series only when a planned race actually carries it (`test/sync.test.ts`).

- **A script's "Committed `<sha>`" doesn't touch your local checkout.** `check.ts`, `agent-read.ts` and `edit.ts` all write through `scripts/lib/github.ts` (Octokit `createTree`/`createCommit`/`updateRef` against GitHub directly), not local git. `git status`/`git log` in your working copy stay exactly as they were until you `git pull` — reading a race file locally right after a "Committed" message will show the pre-commit content and can look like the write silently failed.
- **The API notify step is gated on `validate` (typecheck + `npm test` + `npm run validate`), and the gate fails closed and quiet.** If `validate` is red for any reason — even one unrelated to the data just pushed — `notify-api` shows as `skipped`, not `failed`, in the Actions run, and the API just never hears about the change. A single broken test can silently stop every data push from reaching production until someone runs `gh run list --branch main` and notices. Recovery once `validate` is green again: `gh workflow run main.yml` (workflow_dispatch resyncs current `main` without needing a new commit) — a rerun of the old failed run (`gh run rerun`) replays the *old* broken tree and won't help.

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
| `scripts/lib/changes.ts` | Races added/updated/removed between two commits (git diff), shared by both notifications; `splitMessages` for Discord's 2000-char limit |
| `scripts/lib/jsonschema.ts` + `scripts/schema.ts` | Generate `schema/*.schema.json` from the zod schemas |
| `scripts/edit.ts` | Hand edits: set/unset overrides (`planEdit`), add openrace races; one commit through `commitToGitHub` |
| `scripts/renormalize.ts` | Re-derive canonical fields from stored `rawExtracted` after rule changes (no scraping) |

## Tooling

- Node ≥ 22, TypeScript 7 (`tsc`), `tsx` for scripts, `node:test` for tests. Imports use `.ts` extensions.
- Actions use `actions/checkout@v7` and `actions/setup-node@v7`; jobs run Node 22.
- The Cloudflare Worker and Firecrawl Monitor setup existed until 2026-09-23 and were removed; see decisions.md.

# Status (end of 2026-09-23)

## Live and verified

- **Repo** `openracevn/openrace-data` (private, Free org plan: no branch protection or auto-merge, so commits go straight to `main`).
- **Ingestion:** `check.yml` / `npm run check`, Firecrawl scrape + JSON, for ActiUp (primary) and bibchung (group price). It runs in Actions or locally (`GITHUB_TOKEN=$(gh auth token)`). **The daily schedule is OFF** (user decision); every run is manual.
- **Hand edits:** `npm run edit` (overrides, hand-entered `openrace` races), `npm run renormalize` (re-derive without scraping). The single-race workflow is in `.claude/skills/check-race`.
- **On each push touching `data/`:** `validate` → Discord (links to sources + JSON per race) → openrace-api resync (`https://openrace-api.bmp.workers.dev/internal/sync`, `X-Sync-Secret`). All verified on 2026-09-23. The first real resync replied "5 unchanged" for a push that only added `overrides: {}`, which is consistent with the API ignoring unknown keys.
- **Manual resync:** Actions → Main → Run workflow validates `main` and calls the API, without a commit (no Discord message).
- **Files are `data/races/<slug>-<year>.json`** (renamed from `<uuid>.json` on 2026-09-23; always end with the race year; `index.json` has each `file`); change a slug with `npm run edit -- slug`.
- **Data:** 5 races (4 upcoming + Lâm Đồng Trail 2024); Tết Run has both ActiUp and bibchung. No overrides and no hand-entered races yet.
- **Contract:** `schemaVersion` 1, `schema/*.schema.json`, sanity bounds. Everything added since has been additive.
- **Secrets set in Actions:** FIRECRAWL_API_KEY, OPENRACE_BOT_TOKEN, DISCORD_WEBHOOK_URL, SYNC_WEBHOOK_URL, SYNC_SECRET.
- **bibchung prompt:** re-tested on Tết Run. Prices are correct (678,000 / 678,000 / group 542,000); the organizer comes back as the event name, and a code guard drops it.

## Next

- [ ] Load the remaining upcoming races (~35 on ActiUp, 12 on bibchung) in small manual batches (`--mode discover --max-scrapes N`), checking Discord after each.
- [ ] Turn the daily schedule back on (uncomment the cron in `check.yml`) once the data is trusted.
- [ ] Discovery sees only the first 12 ActiUp events. Consider using ActiUp's listing API (all 40 upcoming, free) for discovery; see firecrawl.md.
- [ ] Rotate the Discord webhook (its URL was pasted in a chat session) and update `.env` plus the Actions secret.
- [ ] Token expiry: OPENRACE_BOT_TOKEN and openrace-api's read token are personal fine-grained PATs. When one expires, checks (or the API sync) fail until it's replaced. Consider GitHub Apps later.

## Known gaps

- **Removed events stay** (decided). A vanished page is retried every 3 days until race day (1 credit per failed scrape).
- **Distance drift.** The model sometimes picks a distance up from the description text and sometimes doesn't, which can cause an occasional `distances` commit.
- **Multi-day dates.** "21 - 22 tháng 11" stores the 21st.
- **ActiUp empty renders.** About 1 in 10 scrapes of an ActiUp page comes back empty (`pageKind: none`, still costs credits); it's retried after 3 days or by hand.
- **Race matching** across sources is heuristic (±1 day + name similarity ≥ 0.5). Watch the Discord `+bibchung` lines.

# Status (2026-09-23)

## Done

- Repo pushed to `openracevn/data`, branch `main`:
  - `ecb517f` initial setup
  - `e865154` actions bumped to v7
- Main workflow green. Code-only pushes correctly skip both notifications.
- `DISCORD_WEBHOOK_URL` secret set (see secrets.md).
- Verified locally:
  - 12 unit tests: planner, normalization, HMAC.
  - Worker under `wrangler dev`: 401 on a bad signature, 200 on ignored events, 500 when Firecrawl rejects the key.
  - Discord message format, against a local listener.
  - `validate` on generated data.

## Not done / not verified

- [ ] Create a GitHub fine-grained PAT, then set the three Worker secrets.
- [ ] `npm run worker:deploy` (not deployed yet, so there's no Worker URL).
- [ ] `npm run monitor:create`: review the dry run, then `--create`.
- [x] Discovery and extraction checked through the API (see the extraction test in firecrawl.md).
- [ ] First real **monitor** check: confirm the crawl follows the related-event links and that `snapshot.json` is populated.
- [ ] First real Discord message (nothing has been posted to the channel yet).
- [ ] `SYNC_WEBHOOK_URL`, once openrace-api exists.
- [ ] Nothing has run end to end against real Firecrawl and GitHub.

## Known gaps

- **`removed` pages are ignored.** A race that disappears from ActiUp keeps its file unchanged. Decide whether to mark it `closed`, flag it, or leave it.
- **Credits.** A monitor check re-scrapes every event page at about 5 credits each: 30–50 pages × 4 checks/day ≈ 600–1000 credits/day. Pick a plan or schedule before `monitor:create`.
- **Distance drift.** The model sometimes lists a distance from the description and sometimes doesn't, which would cause occasional `distances` commits.
- **Multi-day dates.** "21 - 22 tháng 11" stores the 21st, even if the race itself is on the 22nd.
- **Workers subrequest limit.** Each changed race costs one GitHub read. The free plan caps at 50 subrequests, so a check with more than ~40 changed races fails. Use Workers Paid (1000) or move to a Queue.
- **`waitUntil`** is capped at 30 s after the response.
- **Multi-day events** store only the first race day.
- **`confidence`** only ever produces `single-sourced`.

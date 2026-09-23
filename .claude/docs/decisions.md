# Decisions

## Kept from the original spec (don't simplify)

- **`sources` is always an array and `confidence` is always set**, even with one source. They're the hooks for multi-source reconciliation and the "verified" badge. Canonical fields are derived from `sources[].rawExtracted` by `reconcile()`, so a second source means changing `reconcile.ts` and adding `confidence` values. Adding enum members needs no data migration.
- **One commit per webhook delivery**, made through the GitHub API (Octokit Git Data API), never local git.
- **No change means no commit.** An extraction that normalizes to the same canonical fields writes nothing.
- **No DB and no API in this repo.**

## Departures from the spec, and why

| Spec said | We did | Why |
| --- | --- | --- |
| Custom shared-secret header | Verify Firecrawl's `X-Firecrawl-Signature` HMAC | That's Firecrawl's real mechanism. It's stronger (covers the body) and needs no extra config |
| Extract race fields from the webhook payload | Fetch the check's pages and use `snapshot.json` | Monitor webhooks don't contain extractions (see firecrawl.md) |
| `registrationStatus` is one of 4 values | Also allows `null` | We don't invent `open` when the page doesn't say. The same goes for venue, prices, organizer, etc. `null` means unknown |
| `index.json` = slugs + lastModified | Plus `sourceUrls` | Lets ingestion map URL → slug without reading every file, so renamed races keep their id |
| Discord on every push to main | Discord only when the push touches `data/` | User request, 2026-09-23 |
| Resync webhook after every commit | Only when `data/` changed **and** validation passed | Keeps invalid data from reaching the API |

## Other choices

- **Identity:** a new race gets `raceSlug(name, date)` (name folded to ASCII, plus the year if the name lacks it), with a `-2`, `-3` suffix on collision. After that the source URL is authoritative through `index.json.sourceUrls`. **Race ids never change**, because they're the file names and the API's keys.
- **Source URLs are canonicalized**: no query string, hash, `www.` or trailing slash.
- **Normalization** exists to suppress LLM drift between checks. It snaps standard distances (`21.1K`/`Half Marathon` → `21km`), maps cities to an English display name plus region, and coerces `DD/MM/YYYY` dates and `"350.000đ"` prices. If you see noisy commits, fix them here rather than in the diff logic.
- **Only canonical fields drive changes.** A `rawExtracted` difference that normalizes to the same canonical values is not a change, so `rawExtracted` and `lastCheckedAt` only refresh when a file is written anyway.
- **Invalid existing files make ingestion throw** instead of being silently overwritten. A 500 makes Firecrawl retry, and the error lands in Worker logs.
- **Worker response timing:** it races the work against 8 s. It returns the real result (a 500 triggers Firecrawl's retries), or 202 and continues in `waitUntil`. Retries are idempotent.
- **Concurrent deliveries:** `updateRef(force:false)` returns a 422 when `main` has moved, and we re-plan on the new head, up to 3 attempts.
- **The Discord summary comes from `git diff`**, not from commit messages, so it's accurate for manual edits and merges too. Values are shown inline for `date`, `priceMin`, `priceMax`, `registrationStatus` and `foreignerEligible`.
- **`notify-discord` doesn't wait for `validate`**, so a bad data push still gets announced.

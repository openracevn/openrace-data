---
name: backfill-field
description: Backfill one field (today: participants) across many races in openrace-data without Firecrawl or opencode, using your own WebSearch and a verify script. Use when the user says "backfill participants", "find participant counts for past races", "fill the participants gap", or when `npm run gaps` lists past races with no participant count or low-confidence counts.
---

# Backfill one field across many races (the fast lane)

Plan 017. Free: your own `WebSearch` and plain page fetches. No Firecrawl, no opencode. Written for `participants`; the steps hold for any field a page states in a sentence.

## What counts

"Participants" = people who **registered, paid or attended** that edition, one figure, the latest, post-race over pre-race. Never: targets ("dự kiến", "hướng tới", "expected"), capacity or slots ("giới hạn"), finisher-only counts, a different edition's number, Facebook. Unknown stays unknown; never store 0.

## Steps

1. **Worklist:** `npm run gaps`, section "Past races with no participant count" (biggest series first). "Participant counts with low confidence" is the upgrade list.
2. **Search:** about 10 races per batch, in parallel, one `WebSearch` per race (`<race name> <year> số người tham gia`), a second wording only for misses. Only a number in a result **title** can be quoted verbatim; a number seen only in a search summary goes in **without a quote** (stored as `low`).
3. **Write candidates** to a scratch file: `[{"race":"<slug>","url":"<page>","count":9100,"quote":"<verbatim title or sentence>"}]`.
4. **Verify (dry, free):** `npx tsx scripts/backfill-verify.ts <file>`. It fetches each page and rejects: link not loading, the edition's year missing from the page, the count not in the quote, the quote not verbatim on the page or title, targets/capacity/finishers wording, Facebook. Fix or drop rejects; never loosen the script to let one through.
5. **Apply:** `GITHUB_TOKEN=$(gh auth token) npx tsx scripts/backfill-verify.ts <file> --apply`. Each accepted count is stored as a `reference` source through `npm run edit -- add` (a real commit; say so first). Sites read automatically (a recipe) are refused by `edit add`: use their normal read instead.
6. **Report** the hit rate per batch (found / searched) and **stop** for the user to look before the next batch.

## Confidence (derived, never set by hand)

high: a quote from an `official` source, or two quoted sources within 25%. medium: a quote from a `reference` or `seller`. low: no quote. Sources more than 25% apart get the `participants-conflict` flag.

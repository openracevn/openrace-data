> Reference for the `update-race` skill (plan 019). This used to be the `backfill-field` skill and no longer triggers on its own; `update-race` calls into it. Its scripts and steps are unchanged.

# Backfill one field across many races (the fast lane)

Plan 017. Free: your own `WebSearch` and plain page fetches. No Firecrawl, no opencode. Written for `participants`; the steps hold for any field a page states in a sentence.

## What counts

"Participants" = people who **registered, paid or attended** that edition, one figure, the latest, post-race over pre-race. A figure the organizer or its media partner (e.g. VnExpress) states flatly ("đón 10.000 runner") counts even when the article predates the race, if no post-race figure turns up; store it and replace it when a post-race one appears (roadmap change log 2026-09-29). Never: explicit targets ("dự kiến", "hướng tới", "expected"), capacity or slots ("giới hạn"), finisher-only counts, a different edition's number, Facebook. Unknown stays unknown; never store 0.

## Steps

0. **Read `.claude/docs/participants-backfill-log.md` first** (races already run, and why the misses have no count; don't search those twice) and **append each batch to it** at the end: stored, not stored with the reason and what to try next. `npm run gaps` still lists the misses, so "next 5" means the next 5 races in the worklist that are **not in the log** (neither stored nor "searched, not stored" nor "skipped on purpose"); retry a logged miss only when the user asks or its "next thing to try" is now doable.
1. **Worklist:** `git pull`, then `npm run gaps`, section "Past races with no participant count" (biggest series first). "Participant counts with low confidence" is the upgrade list.
2. **Search:** about 10 races per batch, in parallel, one `WebSearch` per race (`<race name> <year> số người tham gia`), a second wording only for misses. Only a number in a result **title** can be quoted verbatim; a number seen only in a search summary goes in **without a quote** (stored as `low`).
3. **Write candidates** to a scratch file. `race` is the `slug` inside the JSON, which can differ from the filename (`the-lakes-race-mua-3-2020.json` has slug `the-lakes-race-mua-3`; a wrong one is rejected as "no such race"): `[{"race":"<slug>","url":"<page>","count":9100,"quote":"<verbatim title or sentence>"}]`.
4. **Verify (dry, free):** `npx tsx scripts/backfill-verify.ts <file>`. It fetches each page and rejects: link not loading, the edition's year missing from the page, the count not in the quote, the quote not verbatim on the page or title, targets/capacity/finishers wording, Facebook. Fix or drop rejects; never loosen the script to let one through.
   **Before calling a race "not found", dig** (batch 1 missed two counts that were there): (a) a fetch failure (`status 0`) is not a missing number, so retry the live page; (b) try the Wayback copy, `https://web.archive.org/web/2id_/<url>`, and **a Wayback link is an accepted source**: when the live page fails or loops (status 0, a 308 redirect loop) but the archived copy verifies, put the `web.archive.org/web/2id_/<original url>` link in the candidate's `url` and store it (Pocari Sweat Run 2019 and 2020 were stored this way); note it in the log; (c) a number seen only in a search summary is worth one page read of the likely sources (related articles and recaps often state it) before calling a miss; (d) search once more with different wording and a different outlet (a post-race recap often sits on a third site). Pre-race articles are not rejected for their date alone. Rejections for a partial count ("hơn 3.000 … hai cự ly"), a target ("dự kiến") or a wrong year are right: find a better source, don't relax the check. Only then report "not found", and name what was tried.
5. **Apply:** `GITHUB_TOKEN=$(gh auth token) npx tsx scripts/backfill-verify.ts <file> --apply`. Each accepted count is stored as a `reference` source through `npm run edit -- add` (a real commit; say so first). Sites read automatically (a recipe) are refused by `edit add`: use their normal read instead.
6. **Report** the hit rate per batch (found / searched) and **stop** for the user to look before the next batch.

## Reading pages

macOS `grep` chokes on Vietnamese UTF-8. To look inside a page, use `fetchPage` and `htmlToText` from `scripts/lib/backfill-verify.ts` in a throwaway `tsx` script (delete it after; don't commit it).

## Confidence (derived, never set by hand)

high: a quote from an `official` source, or two quoted sources within 25%. medium: a quote from a `reference` or `seller`. low: no quote. Sources more than 25% apart get the `participants-conflict` flag.

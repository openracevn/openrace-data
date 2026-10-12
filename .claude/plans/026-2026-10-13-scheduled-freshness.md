# Plan 026: Fresh without effort. Scheduled checks that spend nothing, paid reads only where they pay off

Date: 2026-10-13. Status: **draft, awaiting the user's answer on one decision** (Firecrawl in scheduled runs, section "Roadmap fit"). Spans openrace-data only (scripts, workflows, docs). No API or MCP change.

## Roadmap fit

- **Path step 3, "Fresh without effort"**, the part that is still open: "then the daily cron once the data is trusted". The cron has been off since design v2; `check.yml` is manual only. Status's Next list has "Turn on the daily cron once the data is trusted" and plan 025 carried over "a daily free discovery job" and "a Discord digest of races that need a full read".
- **Trust principle 2 (fresh, and visibly fresh)** is what this serves. Principle 6 (automated, not reviewed) is how: validation, the known-answer tests and the fingerprint rules do the reviewing. Principle 1 holds: a scheduled run only writes what a source said, through the same `sync.ts` path as today.
- **Principle 5 (we learn how organizers publish):** scheduled paid reads run only on recipes that have a known-answer test (`test/answers.test.ts`: ActiUp, VnExpress Marathon, HCMC Marathon) or a deterministic parser with fixtures (iRace's price table). The other `recipe: default` sites stay `check: manual` until each has had its paid check by eye.
- **Constraint, budget:** everything here runs on the Firecrawl Free plan, GitHub Actions on a public repo (free, unlimited minutes) and free fetches. $0/month. No Claude API in scheduled runs; a Claude Code scheduled routine was considered and turned down (section "Not in this plan").
- **Tension to decide, change log 2026-09-29 (plan 019):** "Firecrawl is opt-in, used only when the user asks." That rule was written for interactive sessions, where Claude's own search and page reads are better and free. In a scheduled run there is no Claude, and Free-plan credits don't roll over: credits not spent by the 23rd are lost. So the plan's weekly paid run spends up to a cap of **600 credits/month** of the 1,000, leaving 400 for manual asks. **This needs the user's yes, and a change-log line:** "Scheduled runs may spend Firecrawl credits up to the scheduled cap in `config/sites.yaml`; interactive sessions still ask first." Without the yes, steps 1–3 (all free) are still worth building and the weekly paid run stays a manual button.

## Where we are (2026-10-13)

| | |
| --- | --- |
| Races | 387, 44 not final (ActiUp is a source on 34 of 38 upcoming, iRace on 7) |
| Freshness of the 44 | 39 stale, 1 due, 4 fresh. Last data commit: 2026-09-29 |
| Missing | At least 5 upcoming ActiUp races not on file (plan 024, 2026-10-12) |
| Firecrawl | 110 credits spent in September, 0 in October; cap 900/calendar month |
| Scheduled today | `main.yml` daily resync 07:40 VN, `stale.yml` Monday digest, `weekly.yml` Monday numbers. **Nothing checks or discovers on a schedule.** |

What the checker already does well, and the plan leans on: snapshots are free HTTP; an unchanged fingerprint is skipped and still counts as a check; reads are cached by content hash; a monthly cap and a per-run cap; per-site cadence (`isSiteDue`); one commit per run; Discord alert after 2 failed runs on a site.

What it can't do yet:

1. **Known races never refresh for free.** `--facts-only` skips any page that has a fingerprint, and `--free` defers a changed page entirely. So a date move, a sale closing, a race turning free or a new "from" price on ActiUp (all in its free API) only reach the data through a paid read or a Claude session.
2. **iRace prices need Firecrawl in the checker** although `parsePriceTable` already reads the HTML table deterministically (plan 010) for `agent-read`.
3. **Races are read in listing order,** not soonest first, so a cap can starve the races whose sale windows are about to flip.
4. **The Monday digest only names stale races.** It doesn't say which pages changed and are waiting for a read, or what that would cost, so a Claude session starts by rediscovering the list.
5. `notify-stale` reads `final` as written at the last commit; with no commits for two weeks, races that already took place still count as stale.

## Design: three lanes, cheapest first

**Lane A, daily, free (0 credits).** `npm run check -- --refresh` on ActiUp and iRace (the two sellers carrying 41 of the 44 open races), and on every other site when its cadence is due:

- discover (listing API / home page), snapshot each upcoming race (free HTTP);
- **new page:** create the race from facts (as `--facts-only` does today) and mark it `pending` (needs a read);
- **unchanged fingerprint:** record the check (the race is honestly fresh: the source was looked at and said the same);
- **changed fingerprint:** keep the stored page extraction, replace `facts` with the fresh ones (name, date, endDate, venue, organizer, registrationStatus, fromPrice, free price), record the check, and set `pending: <new fingerprint>` on the page so lane B reads it. `fromPrice` changing is the cheap signal that a tier flipped;
- iRace: when `parsePriceTable` returns a clean table (every row has a distance and a round VND price), store it as `facts.prices` and don't mark the page pending. Falls through to pending on anything else;
- one commit (data + state), only when something changed. Bookkeeping-only commits touch `state/` and skip `main.yml` as today.

**Lane B, weekly, paid within a cap.** `npm run check` on due sites, `--max-credits 150`, pending and soonest race day first, only recipes on the trusted list. Reads clear `pending`. Stops at the scheduled monthly cap (new `scheduledMonthlyCredits: 600` next to `monthlyCredits: 900`). Deferred races stay pending and appear in the digest with their estimated cost.

**Lane C, a Claude `update-race` session, every two weeks or when the digest says so.** Only what the first two lanes can't do: judgment work (series and editions, organizer splits, participants, a price image the OCR shifted, a race with no source on any recipe site). The Monday digest is the session's input, so the session is short and batched (one flush, one commit).

Why this split is the cheap one: Claude usage is the scarce resource; Firecrawl Free credits are free and expire; HTTP is free. So facts go through HTTP, price images through Firecrawl, judgment through Claude, and never the other way round (a Claude image read is the most expensive way to read a poster, plan 009).

## Schedule (Vietnam time)

| When | What | Cost |
| --- | --- | --- |
| Daily 07:50 (00:50 UTC, after D1's write quota resets at 00:30 and the backup resync at 00:40) | Lane A `refresh.yml` | 0 credits, ~2 Actions minutes |
| Tuesday 08:00 | Lane B `check.yml` cron, `--max-credits 150` | ≤150 credits, ≤600/month |
| Monday 08:00 | `stale.yml` digest, extended (step 5) | 0 |
| Monday 08:10 | `weekly.yml` numbers, plus freshness share | 0 |
| Every 2 weeks, by the user | Lane C `update-race` on the digest | one Claude session |

Expected credits: 34 upcoming ActiUp pages, a few change per week (4–8 × ~10 credits), plus 5–10 new races a month × ~15: **250–450 credits/month**, under the 600 cap and well under the 1,000 free. First run after two idle weeks: up to ~200, spread over two Tuesdays by the per-run cap. Dollar cost of the whole plan: $0.

## Steps

0. **Roadmap and status.** Change-log line for the decision above (only if the user says yes). Status: "daily cron on" moves from Next to Built when step 7 is done.
1. **`check.ts --refresh` (lane A).** The four cases above. `state/checks.json` entries get `pending?: string` (the changed fingerprint) and `pendingSince?`. `--refresh` implies free; `--facts-only` stays for seeding. Unit tests on the four cases with the existing recipe fixtures.
2. **iRace free prices.** `irace.ts` puts a clean `parsePriceTable` result in `facts.prices` (`reconcile.ts` already prefers facts over model output). A test with the saved `#personal` and `#bang-gia` fixtures; a table with a missing distance or a non-round price is not clean.
3. **Ordering and caps.** Sort refs pending-first, then by race day. `scheduledMonthlyCredits` in `config/sites.yaml`, applied when `--scheduled` (set by the workflow) is on; manual runs keep `monthlyCredits`. A trusted-recipe list in `scripts/lib/recipes/index.ts` (`trusted: true` on actiup, vnexpress-marathon, irace, and `default` only for `hcmc-marathon`); a scheduled run skips paid reads on untrusted recipes and says so in the summary.
4. **Workflows.** New `refresh.yml` (daily cron + `workflow_dispatch`, same `concurrency: check-races` group). `check.yml` gets the Tuesday cron with `max_credits: 150` and `--scheduled`; its inputs stay for manual runs. Both use the PAT so commits trigger `main.yml`.
5. **Digest.** `notify-stale` becomes the Monday data digest: stale races, pages pending a read (with the estimated cost and whether lane B will take them or they need Claude), new races with no prices, and the freshness share (fresh / due / stale of the non-final races). Compute `final` from the index's dates at read time (fixes gap 5). `notify-weekly` adds the same freshness share next to completeness, since freshness is one of the four numbers the roadmap measures by.
6. **Catch-up, by hand, before the crons go on.** `check -- --refresh --dry-run` and read the plan; run it live (creates the 5+ missing races, refreshes dates and status, 0 credits). Then `check -- --max-credits 100 --dry-run --preview`, compare 3 races' prices by eye against their images, then live. Then one `update-race` session on what's left pending. Done when the digest shows 0 stale and every pending page is either read or listed with a reason.
7. **Turn the crons on.** Watch the first two weeks: credits per run in the job summary, Discord lines, the Tuesday run's deferred count. Add the `state/credits.json` month to the weekly numbers so overspend is visible.

## Not in this plan

- **A Claude Code scheduled routine (`/schedule`) running `update-race`.** It would break "no Claude API in scheduled runs" and spend the limited Claude usage on work lanes A and B do for free (the plan 019 pilot used ~300k tokens for 4 races). Lane C stays a session the user starts, with the digest as its brief.
- **Firecrawl Monitors, the Hobby plan, Firecrawl Search for discovery** (10–20 credits/month; revisit if ActiUp and iRace listings miss races the digest never hears about).
- **Recipes for bibchung, 5BIB, Vietnam MTB Series,** and the paid checks of the 9 `recipe: none` race sites. Each paid check is ~20–50 credits and a human eye; one or two per month fit in the 400-credit manual reserve.
- **Cross-source read skipping** (don't OCR ActiUp's poster when iRace's table for the same race is fresh). Worth ~5–20 credits per shared race, 7 races today. Add it if lane B keeps hitting its cap.
- **A `--queue` for commits across sessions** (plan 018): lane C already commits once per session through `flush`.

# Plan 027: Two daily schedules, done before 07:00 Vietnam, paid reads for data quality

Date: 2026-10-15 (written), build in the next session. Status: **built 2026-10-15, before the trial (the user's call), except step 4; trial run Friday 2026-10-16** (`.github/workflows/trial.yml`). See "Built" at the end. Spans openrace-data (scripts, workflows, docs) and one small Cloudflare Worker for the timing. No API or MCP change.

## Roadmap fit

- **Path step 3, "Fresh without effort".** Replaces plan 026's shape (daily free refresh, Tuesday paid read, per-site cadence) with two daily schedules that work from one to-do list.
- **Trust principles 2 and 6** are what this serves: every upcoming race is checked every week (cancelled, date, location, prices), and validation still does the reviewing before a commit. Principle 1 holds: a schedule only writes what a source said, through `sync.ts`.
- **Constraint changed (the user, 2026-10-15):** the budget constraint and the 2026-10-13 line (600 scheduled credits a month, trusted sites only) are lifted for scheduled Firecrawl reads. The aim is data quality, and to measure how many credits a month that really takes. Not unlimited: a monthly ceiling still holds (`config/sites.yaml`), set from what the trial measures. Roadmap change log, 2026-10-15.
- **No Claude or OpenRouter API.** Firecrawl reads the page and extracts with our schema; nothing in the schedules calls another model. Added later only for a field the trial shows Firecrawl getting wrong.

## The design (agreed 2026-10-15)

Only these run on a timer. All times Vietnam (UTC+7).

| When | Run | Does |
| --- | --- | --- |
| Daily 04:00 | **Schedule 1: discovery** (free) | ActiUp and iRace every day; the race sites that don't list there (VnExpress Marathon, HCMC Marathon, Hạ Long, Lâm Đồng, Run To Live, any new `kind: race-site` or `hub` with a recipe) every 2 weeks, on Monday of even ISO weeks. New races go on the to-do list. |
| Right after Schedule 1 (05:00 fallback) | **Schedule 2: details** (paid) | Reads every race on the to-do list with Firecrawl: new races from Schedule 1 every day, and **every upcoming race on Monday**. Checks it is still on (cancelled, postponed), date, location, distances, prices. Past races are never checked. Commits once. |
| Monday 09:00 | **Digest** (Discord) | As today, plus the week's credits and what Schedule 2 couldn't resolve. Weekly numbers go in the same slot. |

Both schedules are finished before 07:00. Each posts its result to Discord.

### The to-do list

`state/todo.json`, committed by Schedule 1 and emptied by Schedule 2:

- `{ url, raceId?, reason: "new" | "weekly" | "changed", addedAt }` per page.
- Schedule 1 adds `new` (a page not on file) and `changed` (a fingerprint changed on a free snapshot).
- On Monday Schedule 1 adds `weekly` for every source page of every upcoming race (`final` false and race day ≥ today).
- Schedule 2 removes an entry once it is read, or leaves it with a `failures` count; after 3 it goes to the digest.

This replaces per-site cadence (`isSiteDue`, `check: weekly|monthly|quarterly`) and the `pending` field in `state/checks.json`.

### Timing

GitHub starts this repo's crons 4 to 7.5 hours late (observed 2026-10-02 to 10-14), so a cron can't make 07:00. A Cloudflare Worker with a cron trigger (free plan, on time) calls `workflow_dispatch` on `schedule-1.yml` at 04:00 and on `digest.yml` at 09:00 Monday. `schedule-2.yml` starts on `workflow_run` when Schedule 1 completes; the Worker also dispatches it at 05:00 and it does nothing if today's run already happened. Needs a fine-grained token with `actions: write` on openrace-data, stored as a Worker secret.

### What goes away

- `refresh.yml`, `check.yml`'s Tuesday cron (it stays a manual button), `main.yml`'s daily cron (pushes already start it), `stale.yml` and `weekly.yml` crons (dispatched by the Worker).
- openrace-web's two daily rebuilds: one rebuild after Schedule 2 instead (`repository_dispatch` from Schedule 2, or Main on a data push).
- The `trusted` gate on scheduled paid reads. `trusted` stays as a recorded fact; untrusted sites get read, and the weekly quality check (below) is what makes a site trusted.

### Credits

- `scheduledMonthlyCredits` rises to what the trial suggests, and the per-run cap goes. Firecrawl's plan may need to go up from Free (1,000 a month); the user pays.
- Estimate before the trial: about 44 upcoming races, 1 page plus up to 2 price images each, so about 250 to 650 credits per Monday pass, plus new races on other days. The trial replaces this with a measured number.

### Data quality

- Every week, a session checks a sample of what Schedule 2 committed against the live pages (free, Claude's own reads), and records a known answer per site in `test/answers.test.ts`. A misread becomes a code fix and a test (principle 5).
- Cancelled or postponed races set `status` (the schema has it) from a quoted source line.

## Steps (next session)

1. Roadmap and config: confirm the ceiling from the trial; `scheduledMonthlyCredits`, drop the run cap.
2. `state/todo.json` and its schema; `check.ts` gets `--discover` (Schedule 1) and `--todo` (Schedule 2) in place of `--refresh` / `--scheduled` / site cadence. Tests.
3. Workflows: `schedule-1.yml`, `schedule-2.yml` with Discord summaries; remove the old crons; web rebuild after Schedule 2.
4. Cloudflare Worker `openrace-cron` (04:00, 05:00 fallback, Monday 09:00), token as a secret.
5. Delete `trial.yml`. Update `status.md`, `infrastructure.md`, the digest's text.
6. First week: watch every run, check the sample, set the ceiling.

## Trial, Friday 2026-10-16

`.github/workflows/trial.yml`, built from today's scripts so the two schedules can be tested before the refactor:

- **Schedule 1 (trial):** `check --refresh --site <site>` on all 7 sites with a recipe (actiup, irace, vnexpress-marathon, hcmc-marathon, halong-marathon, lamdong-trail, run-to-live). Free.
- **Schedule 2 (trial):** `check --site <site>` (paid reads of new and changed pages) on all 7 sites, committed. halong-marathon, lamdong-trail and run-to-live failed the 10-13 check by eye; the user chose to commit them anyway, so the next session checks what they wrote against the live pages and fixes or reverts.
- Credits: capped by the existing monthly cap (900; 215 spent in October, so up to 685).
- Each schedule posts a summary to Discord. Main posts its usual data announcement for each commit.
- Cron 00:07 Vietnam Friday (17:07 UTC Thursday), retry at 02:07; the retry does nothing if the first run went through. Expected in Discord well before 09:00, but GitHub doesn't guarantee start times; if nothing has arrived, start it by hand from the Actions tab (Trial run, Run workflow).

What to read from the trial in the next session: credits per site and per page, pages read vs skipped as unchanged, what changed in the data, and what the three untrusted sites committed, against their live pages.

## Built (2026-10-15)

The user asked to build it the day before the trial, keep the trial, and skip the Worker for now.

- **Code:** `scripts/lib/todo.ts` (the list, `discoverySites`, `weeklyPages`, `readDoneToday`), `check.ts --discover` (`--refresh` kept as its old name while `trial.yml` uses it) and `--todo`, `--force` to run either again the same day. A page read in any run leaves the list. `--scheduled`, `isSiteDue`, `check:` in `config/sites.yaml` and `pending` are gone; `state/checks.json`'s 41 upcoming pending or never-read pages went on the list. `state/credits.json` also keeps a key per Vietnam day (62 days) for the digest's week. Freshness `cadence` (the API shows it) is `weekly` for any race with a source on a recipe site, else `manual`. Tests: `test/todo.test.ts`, `test/check-order.test.ts`, `test/digest.test.ts`.
- **Workflows:** `schedule-1.yml` (cron 00:07 Vietnam, retry 02:07), `schedule-2.yml` (`workflow_run` on a scheduled Schedule 1, not a button run, fallback 03:07; then waits for Main and sends `repository_dispatch data-updated` to openrace-web, whose two daily crons are gone; a `web_only` button rebuilds the site alone), `digest.yml` (Monday 09:00: digest, then weekly numbers). Removed: `refresh.yml`, `stale.yml`, `weekly.yml`, the crons of `check.yml` and `main.yml`. Neither schedule runs on 2026-10-16 (the trial's day) unless started by hand.
- **Credits:** `scheduledMonthlyCredits: 900`, the whole cap, until the trial and the first week give a number. The trial may spend up to 685 of October's remaining credits, so Schedule 2 may hit the cap before November: pages then stay on the list (not counted as failures) and the run says so.
- **Site rebuild:** the dispatch got a 404 on 2026-10-15: `OPENRACE_BOT_TOKEN` can't see the private openrace-web. Until the user gives it Contents: read and write on openrace-web, openrace-web keeps one daily cron (12:00 Vietnam) as a fallback, and Schedule 2's rebuild step fails with a Discord alert. Test with Schedule 2's `web_only` button, then drop the web cron.
- **Not built:** step 4, the Cloudflare Worker. Without it the crons start hours late and the 07:00 target isn't guaranteed. To add: a Worker with cron triggers dispatching `schedule-1.yml` (04:00), `schedule-2.yml` (05:00) and `digest.yml` (Monday 09:00), a fine-grained token (Actions: read and write on openrace-data) as its secret, then the crons go.
- **Next session:** read the trial (credits per site and page, what changed, the three untrusted sites against their live pages), delete `trial.yml` and the `--refresh` name, set the ceiling, and watch the first week (step 6).


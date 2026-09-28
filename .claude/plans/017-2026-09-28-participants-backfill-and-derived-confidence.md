# Plan 017: participants: a fast backfill lane and a derived confidence

Status: **approved 2026-09-28. Stages A, B and C built 2026-09-28. Batch 1 stored 6 counts (Techcombank 2017, 2018, 2019, 2022; Ha Long 2019, 2020); Ha Long 2015-2018 and the 2015 half have no findable count. Not yet: API deploy (`db:migrate:remote`, `deploy`), the web/MCP follow-up, and running the first backfill batches.**

## Roadmap fit

Serves the question **"How big is this race, and which series is the biggest?"** (roadmap table, *Building*) and path step 4 (stats from the data, which need a backfill).

- **Principle 1 (every fact traces to a source):** a count is stored as what a source said (`sources[].extracted.participants`), with a working link. A number with no link is never stored.
- **Principle 3 (honest about uncertainty):** a count found only in a search summary is still stored, but its `confidence` is `low`. Unknown stays `null`, never 0. A count for a different edition is never stored.
- **Principle 6 (automated, not reviewed):** a script checks every candidate (link loads, edition's year on the page, count in the quote, quote verbatim) before anything is written.
- **Roadmap changes (confirmed by the user, 2026-09-28):** "participants" means the number of people who **registered, paid or attended** that edition. Capacity, slots, finisher-only counts and targets ("dự kiến") stay out. The change log and the non-goals wording are updated with this plan.
- **Constraints:** no paid service (my own `WebSearch` and free page fetches only, no Firecrawl, no opencode). Breaking openrace-api is allowed; this change is small.

## What changes

`participants` becomes `{count, sourceUrl, quote?, confidence}`:

| Field | Meaning |
| --- | --- |
| `count` | Integer ≥ 1 of people who registered, paid or attended (any of these, one figure per edition, the latest, post-race over pre-race). |
| `sourceUrl` | The page that states it. Required. |
| `quote` | Verbatim text from that page or its title. Present **only when verified**. |
| `confidence` | **Derived on every write, never set by hand**: see the rule below. |

`approx` is dropped: every count is a press or organizer figure, so every count is approximate, and the API and site show them all as "about". The old `approx: true` on the 4 Ha Long counts goes away with it.

### Confidence rule (derived in `reconcile`)

The source the count comes from decides it, plus agreement between sources:

- **high**: a verified quote from an `official` source (the race's own site, or an organizer hub), or two sources whose counts are within 25% of each other, each with a verified quote.
- **medium**: a verified quote from a `reference` or `seller` source (a news article, a reseller's recap).
- **low**: no quote. The number came from a search summary; the link is real, loads and is the right edition, but the exact phrasing was not checked.

Sources that disagree by more than 25% keep the existing `participants-conflict` flag. `gaps` lists `low` counts as an upgrade worklist.

## Stage A: openrace-data (the schema and the lane)

- `scripts/lib/schema.ts`: `ParticipantsSchema` loses `approx`, gains derived `confidence`. `upgrade` step drops `approx` from existing files.
- `scripts/lib/extraction.ts`: `participants` fact loses `approx`; the extraction prompt states the accepted and ignored wordings.
- `scripts/lib/reconcile.ts`: `pickParticipants` picks official, then the latest source; derives `confidence` by the rule.
- `scripts/gaps.ts`: new section "participants with low confidence" (informational).
- Tests: `test/participants.test.ts` updated, plus cases for each confidence level and the drop of `approx`.
- Existing data: the 4 Ha Long counts (saved as overrides) become real sources through `npm run edit add` (role `reference`), and their overrides are unset.
- `npm run schema` regenerates the JSON schema.

## Stage B: openrace-api (and later openrace-web / openrace-mcp)

- Migration: drop `participants_approx`, add `participants_confidence`. `schema.drizzle.ts`, `schema.zod.ts`, sync schema and services, series aggregates.
- Web and MCP show every count as "about", and may show low confidence as such. Follow-up, after the API is deployed.

## Stage C: the `backfill-field` skill (the fast lane)

One field across many races, without opencode or Firecrawl:

1. **Worklist:** `npm run gaps`, biggest series first.
2. **Search:** my own `WebSearch`, about 10 races per batch in parallel, one query each (`<race> <year> số người tham gia`), a second wording only for misses. Only a number in a result title can be quoted; a number found only in a search summary is `low`.
3. **Verify script (`scripts/backfill-verify.ts`):** for each candidate, fetch the page and check the link loads, the edition's **year** is on the page (a wrong edition is rejected), the count appears in the quote, and the quote is verbatim on the page or its title. Rejected: targets ("dự kiến", "expected", "hướng tới"), capacity ("giới hạn", "slots"), finishers-only, Facebook.
4. **Apply:** through `npm run edit add` (role `reference`) so it lands as a source; batched.
5. **Report** the hit rate per batch; stop between batches for the user to look.

## Not in this plan

- Finisher counts, capacity, and per-runner data (non-goals).
- Displaying confidence on the site (Stage B follow-up).
- Backfilling other fields; the skill is written generically so it can be reused.

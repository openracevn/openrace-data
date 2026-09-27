# Plan 012: `scripts/gaps.ts` — a missing-data report

## Roadmap fit

Serves trust principle 3 ("Honest about uncertainty. Disagreements and gaps become
`flags` and `confidence`, not silent guesses. An unknown value is `null` and is never
treated as zero or cheap.") by making the gaps that already live in the data (nulls,
empty arrays, existing `flags`, year holes in a series) visible as a standing report,
instead of a one-off hand query. No tension with any trust principle, constraint or
non-goal: it's read-only, local JSON only, no Firecrawl or Claude cost to run.

## Why

The user asked "what if I want to know races missing data — no prices, no location, no
race date, no org? or series that are missing an edition?" A first hand-rolled query
(inline `node -e`, not committed) answered it once but showed the raw counts are
mostly noise:

```
no prices:            275 / 353
no location.city:     296 / 353
no location.venue:     27 / 353
no organizerId:        25 / 353
no seriesId:          203 / 353
```

Most of these are expected `null`s, not bugs — a one-off race has no `seriesId` by
design, `city` is often just unfilled while `venue` (free text) already carries the
place, and a future race legitimately has no `prices` yet if the organizer hasn't
published them. A useful report has to apply a rule that separates a real gap from an
expected null, per race field:

- **Location**: only a real gap if *both* `location.city` and `location.venue` are
  null — either one alone is normal.
- **Organizer**: `organizerId` null is always worth listing; it's usually knowable.
- **Prices**: split by whether the race is upcoming or past. Confirmed with the user:
  flag *any* future-dated race (date >= today) with an empty `prices` array, not just
  ones within some near-term window — a far-future race with no prices yet is still
  worth knowing about. A past race with no prices is informational only (may have
  been free, or never priced), listed separately, not as a gap.
- **Date**: `date` is a required field in `RaceSchema` (`scripts/lib/schema.ts:260`,
  not nullable) — no race can be missing it, so this check is a no-op / sanity assert,
  not a real category.
- **Existing flags**: `flags: string[]` and `confidence` (`scripts/lib/schema.ts:282,285`)
  already record gaps the reconcile step found (e.g. sources disagree, no prices close
  to race day). The report should surface any race with a non-empty `flags` or
  `confidence !== "high"` rather than re-deriving that signal.
- **Series year gaps**: for series with 2+ editions, a hole in the year sequence
  between the earliest and latest edition. A hand run today found exactly three, all
  missing 2021 (`andros-the-lakes-race`, `halong-bay-heritage-marathon`,
  `vnexpress-marathon-quy-nhon`) — almost certainly COVID cancellations, not missing
  data, but worth a `race-research` sanity check rather than assuming.

## Changes

- `scripts/gaps.ts` (new): read-only report over `data/races/*.json` and
  `data/series.json`, modeled on `renormalize.ts`'s console style (grouped counts +
  sample list per category). No `--commit`, nothing to write; always exits 0 (it's a
  report, not a CI gate like `validate.ts`).
  - Load races the same way `validate.ts` does (`readdirSync(RACES_DIR)`,
    `RaceSchema.safeParse(upgradeRace(...))`).
  - Categories, each printed as a count + a short sample list (first ~10):
    1. No usable location (`location.city` and `location.venue` both null)
    2. No `organizerId`
    3. No prices, upcoming (`date >= today`, `prices.length === 0`)
    4. No prices, past (informational, separate heading)
    5. Non-empty `flags` or `confidence !== "high"` (echoes existing reconcile output)
    6. Series with a year gap: group races by `seriesId`, take the distinct set of
       `date`'s year per series, and report any series where the range between min and
       max year has a missing value in between.
- `package.json`: add `"gaps": "tsx scripts/gaps.ts"` next to `validate`/`renormalize`.
- `.claude/docs/README.md` or `status.md`: one line noting the new report exists and
  what it's for, so a future session doesn't re-derive this from scratch.

## Open questions

- None blocking. The upcoming-prices window was confirmed with the user: any future
  date counts, no 60-day cutoff.

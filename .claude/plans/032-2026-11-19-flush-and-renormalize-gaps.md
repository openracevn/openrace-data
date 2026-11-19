# 032: Flush and renormalize gaps found in plan 031

Written: 2026-11-19. Status: Done 2026-11-19
Related: plan 031, plan 019 (update-race), plan 029 (duplicate check), `scripts/flush.ts`, `scripts/sync.ts`, `scripts/renormalize.ts`

## Roadmap fit

Serves path step 1, **trusted data**: a commit that passes its own dry run must not break `validate` on main (a broken main stops the API sync), and every race should get its map point. Code only: no paid reads, no LLM API, nothing scheduled. No tension with the trust principles, constraints or non-goals.

## Goal

Fix four tool gaps that plan 031 hit, so a batch that passes `flush --dry-run` commits the same tree it validated, a staged `add` keeps the series it names, and `renormalize` can be used to apply geocodes without re-adding races.

## 1. `flush --also` validates one tree and commits another

**Seen:** commit `1444cb4` (plan 031 wave A) passed `flush --dry-run`, then failed `validate` on main: 6 races carried `seriesId "manulife-danang-international-marathon"` with no entry in `data/series.json`. Fixed by `199c9a8` a few minutes later.

**Cause:** the merge order differs.
- Dry run / validation (`scripts/flush.ts:69`): `validateTree({ ...also, ...files })`. The planned `data/series.json` (with the series sync infers from slugs, `lib/series.ts`) wins over the `--also` copy.
- Commit (`scripts/sync.ts:809`): `{ ...plan.files, ...extra }`. The `--also` copy wins and drops the inferred entries.
- Also: the dry run plans on the local checkout (where `data/series.json` is already the edited copy), the commit plans on the GitHub head (without it).

**Fix:** one rule in both places. Plan on top of the `--also` files (`overlayStore(store, also)`) and commit `{ ...also, ...plan.files }`, so planned additions to `series.json` / `organizers.json` land on the edited copy instead of being overwritten. Add a test: a batch with `--also data/series.json` adding series A, plus a bundle whose new races infer series B; the committed `series.json` has both and `validate` passes.

## 2. A staged `add` ignores `seriesId` in its fields

**Seen:** `vietnam-highlands-trail-by-utmb-2027` was added with `fields.seriesId` set and came out with no series; it needed a follow-up `set-many` (`b608d9f`). Same for the Đà Nẵng editions, which got the inferred `manulife-…` series instead of the one named.

**Fix:** either honour `seriesId` (and `organizerId`, `edition`) in an `add`'s fields as overrides on the new race, or reject them with a clear message ("put seriesId in a set-many after the add"). Update SKILL.md section 4 to match.

## 3. `renormalize` re-adds a race

**Seen:** `npm run renormalize` (dry run) on 2026-11-19 lists 44 races whose only change is `geo` (the geocodes from `074fa87`), plus `+ giai-ban-marathon-quoc-te-viet-nam-2025-tai-tro-boi-herbalife` (a new id on every run).

**Cause (to confirm):** `vietnam-international-half-marathon-2025` (date 2025-01-01) holds an ActiUp source whose stored extraction says `date: 2026-01-01`. On replay that source matches no race and becomes a new one. SKILL.md already warns against `renormalize --commit` for a batch (it re-added an orphan series in the plan 019 pilot); this may be the same class of bug.

**Fix:** when replaying, attach each stored source to the race that holds it (`matchId` = the race's id), never match by date/name. Then run `renormalize --commit` once to give the 41 past races their map points, and check `npm run gaps` (geo 90% → ~99%).

**Data to check in the same session:** `giai-ban-marathon-quoc-te-viet-nam-2024`, `vietnam-international-half-marathon-2025` and `-2026` are all dated 1 January, which looks like a placeholder from ActiUp. Find the real race days (update-race).

## 4. Touching a race is the only way to apply a new geocode

**Seen:** after committing `state/geo.json`, races got their point only when a later commit touched them (`a70d802` re-applied 3 locations by hand). Item 3 covers the bulk case; also consider having `flush` re-derive `geo` for races whose location key gained an entry in an `--also state/geo.json`.

## Optional, if the owner wants it

`npm run gaps` lists 47 "merged-looking" organizer names; plan 031 found the top 10 are all single entities (legal names with " - ", "&", commas). An allow-list (a `oneEntity: true` flag in `data/organizers.json` or a list in `gaps.ts`) would let a checked name leave the list.

## Done when

- The test for item 1 passes, and a real batch with `--also data/series.json` plus inferred series commits a tree that `validate` accepts.
- Item 2 behaves as documented in SKILL.md.
- `npm run renormalize` dry run lists only `geo` changes (no `+` lines); after `--commit`, `validate` is green and geo is ~99%.

## Outcome (2026-11-19)

1. **Fixed.** `planBatchWithAlso` (`scripts/lib/flush.ts`) plans on top of the `--also` files and returns `{ ...also, ...plan.files }`; `scripts/flush.ts` uses it for both the dry run and the commit (no more `extraFiles`). Test "keeps both the --also series and the series the plan infers" fails on the old order and passes now.
2. **Honoured.** An `add`'s `seriesId`, `organizerId`, `coOrganizerIds` are applied as overrides on the race it lands on (`edition` was already kept as a fact). Test added; SKILL.md section 4 updated.
3. **Fixed.** `renormalize` passes `matchId: race.id` for every stored source. The dry run lost its `+ giai-ban-marathon-…-herbalife` line. The 44 geo-only changes were already gone: `e56e812` (plan 031 wave B) had re-composed those races and applied the geocodes. `renormalize --commit` (`5aadf0d`) wrote the one change left (`vietnam-ultra-marathon-2026` links → official); a second dry run says "No changes"; validate green.
   - Geo stays at 90% (380/422): the 42 races without a point have no `state/geo.json` entry for their location (venue-only strings, no city). That needs geocoding, not renormalize.
   - **Data check:** the 1 January dates are real. VIHM is a New Year's Day race every year (baolaocai.vn: "Sáng 1/1/2025", "Ngày 1/1 … VIHM 2026"; 2024 "đến ngày 1/1/2024"). `b0d1a7e`: 2024 edition joined series `vietnam-international-half-marathon`; 2025 got edition 3 ("trong năm thứ 3 tổ chức"). The 2023 first edition is not on record ("Như hai mùa đầu tiên").
4. **Not built.** With `renormalize` safe, it is the bulk tool for applying new geocodes; `flush` doesn't re-derive geo by itself.
- Also: the existing test "merges two operations on one race" asserted an exact override list and broke when `hcmc-marathon-2025` got an `organizerId` override in `e56e812`; it now checks only the two keys it is about.
- Optional organizer allow-list: not done (owner's call).

### Follow-up: geocoding (2026-11-19)

- The geocoder only split venues on commas, so "Cần Giờ - TP HCM" was tried whole and never fell back to the place or province. It now also splits on spaced dashes and expands `TP HCM`/`HCM`/`BRVT` (`c685389`, with 15 new `state/geo.json` points). `renormalize --commit` (`221645b`) applied them to 19 races: geo 90% → 95% (399/422).
- 23 left: 5 have no location text (halong-bay-half-marathon-2015, halong-bay-heritage-marathon-2019 and -2020, the-lakes-race-mua-3, the 2019 Tiền Phong 60th); angkor-trail-2027 is in Cambodia (points are Vietnam-only); 17 have venues Nominatim doesn't know (English names such as "Quang Ninh Museum Library", "METROPOLE THỦ THIÊM", Trần Bạch Đằng street) or whose point falls "outside Vietnam's wards" (Vân Đồn, Rạch Giá). They need a sourced point (a maps link from the race's page) or a location found first: update-race work, per race.

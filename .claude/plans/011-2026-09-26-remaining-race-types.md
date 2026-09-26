# Plan 011: the races `types` still can't resolve from local data

## Roadmap fit

Serves path step 4 ("trail races per year, North vs South, distance distribution... backfill, `types`") — this is the tail end of the backfill, not a new direction. No tension with any trust principle, constraint or non-goal: these races are deliberately left as `["other"]` rather than guessed, per trust principle 3 ("an unknown value is `null`/`other` and is never treated as... a silent guess").

## What happened

209 of the 256 races that had `types: ["other"]` were reclassified from data already on file — `name`, `prices[].tier`, `organizer`, and in a few cases the source URL/slug — with no new fetch (commits `777eda3`..`b9ffc7a` on `main`, 2026-09-26). See `.claude/docs/status.md` for the running total.

**47 races are left at `["other"]`.** Their name (and everything else already stored) gives no reliable signal for `RACE_TYES` (`scripts/lib/schema.ts`), so guessing would violate trust principle 3. Resolving them needs an actual read of the race's source page — `agent-read` or a normal `check-race` pass — which was out of scope for this round (the user asked for a local-data-only pass, no fetching).

## The 47, grouped for whoever reads them next

### Aqua Warriors (Bolt Event series) — 9
Adventure-race brand name; format (swim/obstacle/multi-sport?) isn't stated anywhere in what's stored.
- `aqua-warriors-halong-bay-2024`
- `aqua-warriors-halong-bay-2025`
- `aqua-warriors-halong-bay-2026`
- `aqua-warriors-hue-2026`
- `aqua-warriors-quang-binh-2025`
- `aqua-warriors-quang-tri-2026`
- `aqua-warriors-van-don`
- `aqua-warriors-van-don-2025`
- `aqua-warriors-van-don-2026`

### Sunrise Sprint (Sunrise Events) — 5
"Sprint" could mean a short triathlon (Sunrise Events also runs IRONKIDS) or just a fun-run distance; not stated.
- `2025-sunrise-sprint-viet-nam-in-da-nang`
- `2025-sunrise-sprint-viet-nam-in-phu-quoc`
- `2026-sunrise-sprint-viet-nam-in-da-nang`
- `sunrise-sprint-da-nang-viet-nam-2024`
- `sunrise-sprint-phu-quoc-2024`

### Andros / The Lakes Race — 5
Lakeside event, terrain (road, trail, or a swim leg) not in the name.
- `andros-lakes-race-2026`
- `andros-the-lakes-race-2024`
- `andros-the-lakes-race-2025`
- `the-lakes-race-2022`
- `the-lakes-race-mua-3`

### Walk / hiking — 7
Not clearly a *run* at all; schema's `RACE_TYPES` has no "walk"/"hike" value, so these need a real look either way (closest existing type, or a schema discussion).
- `skechers-friendship-walk-2024`
- `skechers-friendship-walk-2025`
- `sunrise-walk-in-tram-chim`
- `ultra-walk-nha-trang-da-lat-2024-vuot-deo-khanh-le`
- `ultra-walk-ta-pao-da-mi-2024`
- `yen-tu-mountain-hiking-2025`
- `yen-tu-mountain-hiking-2026`

### Ambiguous terrain (mountain/backyard/ultra wording) — 5
Likely `road_run` or `trail_run` but the wording alone doesn't say which, and that's exactly the North/South, trail-vs-road stat this backfill is for — worth getting right rather than guessing.
- `backyard-ultra-vietnam`
- `dak-lak-ultra-vietnam-backyard-2026`
- `ky-son-win-vietnam-mountain`
- `tuong-ky-mountain-run-challenge`
- `vietnam-ultra-run-beyond-limits-2025`

### No format signal at all — 16
Charity/corporate/community event names that don't say the sport.
- `air-asia-redrun-da-nang-champion21`
- `bac-ninh-legacy-marathon-2025`
- `bidv-run-2025`
- `buoc-chan-hoa-nhap-2024`
- `color-run-for-smiles-2024`
- `da-lat-fresh-night`
- `hanh-trinh-80-nam-vi-an-ninh-to-quoc`
- `hanh-trinh-theo-chan-bac-vi-an-ninh-to-quoc-2026`
- `hanh-trinh-tiep-suc-2025`
- `kapy-wings-dash-splash-2026`
- `plaskidz-2024`
- `revive-water-run-2025-danang`
- `sufferfest`
- `together-we-step-step-for-kindness`
- `ttc-agris-power-racing-2024`
- `viet-nam-toi-do-my-vietnam-2026`

## Next step (not started)

Run these 47 through `agent-read` or `check-race` (whichever their source needs) to read the actual event page, then set `types` — either from what the source states directly, or as an explicit OpenRace override (`npm run edit -- set <race> types '[...]' --reason "..."`) citing what was read. Needs the user's go-ahead first: it's a fetch, which the previous round of this backfill deliberately avoided.

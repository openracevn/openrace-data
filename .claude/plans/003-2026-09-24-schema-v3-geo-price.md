# Plan: schema v3 (location, distances, price on a date) and the API

**For:** the next Claude Code session, in openrace-data and openrace-api.
**Read first:**
- `.claude/docs/status.md`
- `scripts/lib/schema.ts`, `scripts/lib/reconcile.ts`, `scripts/lib/extraction.ts`
- openrace-api: `wrangler.toml`, `migrations/`, `src/db/`, `src/api/routes/`

This phase is infrastructure. Missing data (upcoming prices, past editions, series) is being filled separately and is not part of this plan.

## Goal

The API must answer questions like these:

| Question | Needs |
|---|---|
| I'm in Nha Trang 1–15/12: which races are nearby on those days? | date overlap + "near Nha Trang" |
| I just finished VMM: next trail run, cheapest first, close to HCMC | type + date after VMM + price today + distance from HCMC |
| All races under 300k at today's tier | price per distance on a given date |
| How many times has Lâm Đồng Trail been held? | series + edition number |
| Sort upcoming races by price, by longest or by shortest distance | one price per race on a date + distance as a number |
| When was this race last checked? Can I trust it? | freshness per race in the API |

## Roadmap fit

- **Serves** path step 2 (the questions people ask) and step 3 (freshness visible in the API). It is also groundwork for step 4 (stats): admin codes and region, `courses[].meters` and `elevationGain`.
- **Changes direction:** location is normalized, and scheduled runs may use free services. Confirmed by the user and recorded in the roadmap's change log (2026-09-24).
- **Trust principles:** keeps venue text and sources as written. Inferred tier dates are marked `inferred`. Unknown prices never count as cheap. Stale data is flagged, not hidden.
- **Out of scope:** GPX (added by hand by the user, later) and ticket quotas (non-goal).

## Decisions (agreed 2026-09-24)

**Prices**
- `prices[]` stays flat and keyed by distance (`distance: null` = all distances). No sold-out or quota handling: we are not a ticket seller; only the tier and its dates.
- Tier windows are filled in when the file is written:
  - Order a race's tiers by `kind` (super_early → early → regular → late), then by `from`.
  - A tier with no `from` starts the day after the previous tier's `to`.
  - A tier with no `to` ends the day before the next tier's `from`.
  - The last tier ends on race day.
  - Filled-in dates get `inferred: true`, so the source's own values stay distinguishable.
- The price on a date is worked out by the API per request (`?at=YYYY-MM-DD`, default today in Asia/Ho_Chi_Minh). It is never stored.
- `group` and `non_resident` tiers are excluded by default (`?group=true`, `?audience=` bring them back).
- A race sorts by its cheapest current course; `?distance=21km` sorts by that distance.
- Unknown prices never count as cheap: they sort last and are left out of `maxPrice`, and the response says how many were left out.

**Distances**
- New `courses[]`: `label` ("21km", "Sprint"), `meters` (number; named multisport formats map to their total distance), `type`, `elevationGain` (nullable).
- `distances[]` is replaced by `courses[]` (breaking, so `SCHEMA_VERSION` becomes 3). Breaking openrace-api is allowed; it is updated in the same pass.

**Location**
- `location` keeps the venue text as written. A new `geo` block is derived from it:

  ```json
  "geo": {
    "lat": 12.2388, "lng": 109.1967,
    "source": "maps_link | nominatim | manual",
    "precision": "venue | ward | province",
    "current": { "province": "56", "ward": "22333" },
    "legacy":  { "province": "56", "district": "568", "ward": "22342" },
    "access": "road | flight_or_ferry",
    "fromPlaces": { "hcmc": { "km": 430, "minutes": 480 } }
  }
  ```

- The point is the source of truth; codes are derived from it, so a future administrative change means re-running the lookup, not re-reading races.
- Store official codes, not names. Names come from the reference tables.
  - `current`: 34 provinces + ward/commune. There is no district after 1/7/2025.
  - `legacy`: 63 provinces, district, ward.
- The point is the start or race village. Virtual races get `geo: null` and are left out of distance queries.
- Filtering uses current units. Races before July 2025 show their old name ("Bình Dương (now HCMC)").
- Old names stay searchable. "Nha Trang" is no longer a unit, but race names and people still use it; it resolves through the places list and the legacy district.

**Places / hubs**
- There is no user location. One list of fixed places serves both "near X" and "distance from X". Each place has a center point and a "near" radius.
- The 13 places: HCMC (District 1 / Bến Thành), Hà Nội, Đà Nẵng, Nha Trang, Đà Lạt, Cần Thơ, Hải Phòng, Huế, Vũng Tàu, Quy Nhơn, Buôn Ma Thuột, Sa Pa, Hạ Long. Draft it, then have the user review it.
- A place can also name legacy units (e.g. `nha-trang` → legacy district 568, or within 25 km of its center).
- Driving km and minutes from every place, via an OpenRouteService matrix request (free key; OpenRace is non-commercial for now). One request covers about 230 races × 15 places (3,500 pairs per request).
- Islands (Phú Quốc, Côn Đảo, Cát Bà, Lý Sơn) have no road route: `access: "flight_or_ferry"`, straight-line km instead.
- Points with only province precision are flagged and left out of distance sorting.

**Freshness** (trust principle 2: fresh, and visibly fresh)
- Today the truth is `state/checks.json` (last check per source URL). Race files only change when a canonical field changes, so they don't record routine checks. That's deliberate, to avoid a commit and a Discord post on every check. `main.yml` ignores pushes that only touch `state/`, so the API never sees them.
- The check run also writes **`state/freshness.json`**, keyed by race id:

  ```json
  "<race id>": {
    "lastCheckedAt": "2026-09-24T03:00:00Z",   // newest check over the race's sources
    "lastChangedAt": "2026-09-20T10:00:00Z",   // the race file's updatedAt
    "cadence": "weekly",                       // from its sources' `check` in config/sites.yaml; the most frequent wins
    "dueAt": "2026-10-01",
    "final": false                             // true after race day: never checked again, and never stale
  }
  ```

- **The API reads it on a daily Worker cron trigger** (free, one GitHub request a day) and on every sync. Each race returns:

  ```json
  "freshness": { "lastCheckedAt": "…", "lastChangedAt": "…", "cadence": "weekly", "status": "fresh | due | stale | final" }
  ```

  - `stale` = more than 2× the cadence since the last check.
  - Stale races are flagged, never hidden. `?fresh=true` filters them out.
- `GET /` shows the last sync time and commit (closes the openrace-api open item), and how many upcoming races are stale.
- Answers that depend on prices (`priceAt`, `maxPrice`, sort by price) carry the race's freshness, so a price read long ago is visibly old.
- **While the daily cron is off** (path step 3), most races will honestly show `due` or `stale`. That's expected, and the count tells us when the data is ready for the cron.
- Discord: a weekly line with the stale upcoming races.

**History**
- New race field `edition` (the organizer's stated number, "lần thứ 5"). The API answers "5th edition (4 on record)", or "N on record" when there's no stated number.

## Where each value comes from

Agent-read and Firecrawl must produce the same output, so neither does geocoding or routing.

1. **Readers** (agent-read skill and Firecrawl extraction, same format in `extraction.ts`) extract only page facts:
   - Google Maps link or coordinates
   - edition number
   - tier dates as written (blanks stay blank)
   - per-distance type and elevation when shown

   No extra pages and no extra credits.
2. **`reconcile`** (pure code, re-runs with `npm run renormalize`):
   - tier windows
   - `courses[]` with `meters`
   - province and ward codes from the point, using the copied-in boundary files
3. **Enrichment after reconcile** (network, cached in `state/`, e.g. `state/geo.json`, keyed by venue text or point):
   - Nominatim when there is no Maps link
   - OpenRouteService distances from the places

   It runs in the same sync, locally or in the Action, for either reader. It only calls again when the venue changes. A manual point goes through `npm run edit` as an override.

## Reference data (copied into the repo at a fixed version)

- [thanglequoc/vietnamese-provinces-database](https://github.com/thanglequoc/vietnamese-provinces-database) (MIT) provides the current units, codes and ward GeoJSON (`json/geojson`, `vn_provinces_wards_geojson.zip`). Use it to match a point to its ward.
- [tranngocminhhieu/vietnamadminunits](https://github.com/tranngocminhhieu/vietnamadminunits) (MIT): `data/processed/convert_legacy_2025_with_location_and_default_ward.csv` maps old wards to new wards, with old ward centers. It gives the legacy codes: find the new ward first, then take the old ward within it whose center is closest to the point.
- Record the source commit and date in a README next to the files.

## Free services and their rules

| Service | Rules |
|---|---|
| Nominatim (OSM geocoder) | 1 request/second, a proper User-Agent, results must be cached, no parallel bulk |
| OpenRouteService | Free key. 3,500 pairs per matrix request. The daily quota is only visible in the account dashboard; any published figure is far above our ~1 request per race |
| OSRM (fallback) | Self-hosted in Docker with the Geofabrik Vietnam extract, if the ORS terms stop fitting (e.g. OpenRace becomes commercial). Only the script that fills `fromPlaces` changes |
| Cloudflare free plan | Workers 100k requests/day, 10 ms CPU; D1 5M rows read/day, 100k written/day, 5 GB |

The frontend must show "© OpenStreetMap contributors" (ODbL).

## Part 1: openrace-data, schema v3

1. `schema.ts`: add `courses[]`, `geo`, `edition` and tier `inferred`; remove `distances`; set `SCHEMA_VERSION = 3`. Regenerate `schema/` (`npm run schema`).
2. `extraction.ts`: add maps link/coordinates, edition, per-distance type/elevation. Update the agent-read skill and the Firecrawl extraction schema/prompt to match.
3. `reconcile.ts`: fill in tier windows, build `courses[]` (distance label → meters, including named triathlon formats).
4. Tests: tier window filling (gaps, missing `to` on the last tier, `distance: null`), meters parsing, and one answer test per new field.
5. `npm run renormalize` over all races; `npm run validate` must pass.

## Part 2: openrace-data, location

1. Copy in the reference data and write the point → current/legacy codes lookup (point-in-polygon, no network). Test it with known points: HCMC District 1, a Nha Trang ward, a Bình Dương venue, Đà Lạt.
2. `config/places.yaml` (or similar): the 13 places with center, radius, and optional legacy units. Ask the user to review it.
3. The enrichment step: Maps link → Nominatim → manual, then the ORS matrix to all places, cached in `state/`. It needs an `ORS_API_KEY` secret (local `.env` and the Action).
4. Run it over all races; list the ones with no point or only province precision so the user can set them with `npm run edit`.
5. Discord: show the resolved province/ward, and flag races whose point is approximate.

## Part 2b: openrace-data, freshness

1. The check run (and `agent-read -- commit`, and `npm run edit`) writes `state/freshness.json` for every race it touched. A one-off script builds it for all races from `state/checks.json`, the race files and `config/sites.yaml`.
2. Tests: cadence from several sources (the most frequent wins), `final` after race day (Vietnam date), `dueAt`, and `stale` at 2× cadence.
3. Discord: the weekly stale-races line.

## Part 3: openrace-api

1. D1 migration:
   - races: `lat`, `lng`, `province_code`, `ward_code`, `legacy_province_code`, `legacy_district_code`, `courses` (JSON), `edition`
   - an index on `date`
   - a `race_place(race_id, place, km, minutes)` table with an index on `(place, minutes)`
   - reference tables (or static JSON) for unit names and places
2. Sync: map the new fields; fill `race_place` from `geo.fromPlaces`.
3. Endpoints and parameters on `/races`:
   - `from`, `to`: date overlap with `date`..`endDate`
   - `near=<place>`: within the place's radius or matching its legacy unit
   - `fromPlace=<place>`: include km and minutes
   - `type`, `province`
   - `at`, `maxPrice`, `distance`, `group`, `audience`
   - `sort=price | distance_desc | distance_asc | travel_time | date`
   - `after=<series or race>`: races after that race's date

   Each race returns `courses[].priceAt = { price, tier, kind, validTo, next, status: on_sale | not_yet_open | ended | no_price }`.
4. Freshness:
   - a `freshness` column (or table) filled from `state/freshness.json`
   - a daily cron trigger in `wrangler.toml` that re-reads the file
   - `freshness` on every race and `?fresh=true`
   - last sync time and commit, plus the stale count, on `GET /`
5. Series: an edition count per series (stated `edition` or "N on record").
6. Keep D1 rows read low:
   - filter on the indexed date first
   - use `race_place` for distance sorting
   - cache responses at the edge, with the `at` date in the cache key (data changes only at sync)
7. Update the OpenAPI docs and tests; deploy; run a full resync (Actions → Main); it must report no rejected files.

## Check at the end

Run the six questions from the goal against the deployed API and paste the requests and answers into the day summary. Races without prices or points are expected while the data fill is ongoing; the answers must say how many races were left out and why.

# 2026-09-24, part 3: schema v3 and the API (plans 003 and 004)

Plan 003 is built and live. The work was split into four stages (plan 004). Free opencode models did the building; Claude Code wrote each stage's spec and fixed tests, reviewed the diffs, fixed what was left, merged, migrated and deployed.

## What's live

- **openrace-data schema v3** (`SCHEMA_VERSION = 3`): `courses[]` with `meters`, `type` and `elevationGain` replace `distances[]`; `edition`; tier `inferred` (which of `from`/`to` OpenRace filled in); `geo` (point, source, precision, current and old admin codes, access, driving km and minutes from the 13 places, `near`). All 300 races rewritten (commit 3a6eae9), and 9 more located (a8d0702).
- **Location:** 267 of 300 races located (maps link 1, Nominatim 257, place centre 9); 61 only to province precision; 33 with no point (islands such as Côn Đảo and Phú Quốc, races abroad, vague venues). Routing uses the public OSRM demo server (there's no ORS key yet): road km and minutes where it routes, straight-line km otherwise.
- **Freshness:** `state/freshness.json` is written on every commit; weekly Discord line of stale upcoming races (`stale.yml`, Mondays). All 40 upcoming races are fresh today.
- **openrace-api** (deployed, migration 0006, daily freshness cron at 03:00 in Vietnam): `/races` with `near`, `fromPlace`, `province`, `from`/`to` overlap, `at`, `maxPrice`, `group`, `audience`, `fresh`, `after`, `sort=price|distance_desc|distance_asc|travel_time|date`; per-course `priceAt`; `freshness` and `geo` on every race; `meta.excluded` counts; `/places`; series `editions`; `GET /` shows the last sync, the last freshness read and the stale count.

## The six questions (live, 2026-09-24)

See the requests and answers below. Notes:
- Q1: no race near Nha Trang falls in 1–15/12 in the data yet; `when=all` shows the 6 Nha Trang races.
- Q2: VMM isn't in the data yet (the data fill is separate), so the check used Nha Trang City Trail 2026 as the "just finished" race.
- Q4: Lâm Đồng Trail has one edition and no series yet; the check used a series with 3 on record.

```text
### Q1 near Nha Trang, 1-15/12 (any year shown: when=all)
GET /races?near=nha-trang&when=all
{"total":6,"meta":{"at":"2026-09-24","excluded":{"noPrice":0,"notOnSale":0,"stale":0,"noGeo":0}},"races":[{"name":"Mitsubishi Motors Vietnam Nha Trang City Trail 2026","date":"2026-07-18","geo":"Tỉnh Khánh Hòa"},{"name":"SeaStar Nha Trang Bay 2026","date":"2026-06-26","geo":"Tỉnh Khánh Hòa"},{"name":"GIẢI VÔ ĐỊCH QUỐC GIA MARATHON BÁO TIỀN PHONG LẦN THỨ 67 NĂM 2026","date":"2026-03-29","geo":"Tỉnh Khánh Hòa"},{"name":"Giải Bơi SeaStar Nha Trang Bay lần 2 2025","date":"2025-06-20","geo":"Tỉnh Khánh Hòa"},{"name":"Giải Bơi SeaStar Nha Trang Bay lần I 2024","date":"2024-08-24","geo":"Tỉnh Khánh Hòa"},{"name":"UNIQUE NHA TRANG H-MARATHON","date":"2024-06-16","geo":"Tỉnh Khánh Hòa"}]}

### Q1 exact window 2026-12-01..15
GET /races?near=nha-trang&from=2026-12-01&to=2026-12-15
{"total":0,"races":[]}

### Q2 after VMM: trail, cheapest, from HCMC
GET /races?after=vietnam-mountain-marathon&type=trail_run&sort=price&fromPlace=hcmc&pageSize=5

### Q3 under 300k at today's tier
GET /races?maxPrice=300000&pageSize=10
{"total":5,"meta":{"at":"2026-09-24","excluded":{"noPrice":20,"notOnSale":15,"stale":0,"noGeo":0}},"races":[{"name":"FV RUN - Run with Heart, Run for Hope","date":"2026-10-31","price":250000,"tier":"Flash Sale"},{"name":"Giải chạy bộ Salonpas 2026","date":"2026-11-07","price":235000,"tier":"REGULAR"},{"name":"Quảng Trực Half Marathon 2026 - Nối nhịp biên cương","date":"2026-11-14","price":269000,"tier":"Early Bird"},{"name":"Giải Chạy Quốc Tế Vì Đà Lạt Xanh 2026","date":"2026-11-21","price":200000,"tier":"SUPER EARLY BIRD"},{"name":"Giải chạy Run For The Heart - Chạy vì trái tim 2026","date":"2026-12-06","price":169000,"tier":"Supper Early Bird"}]}

### Q4 editions of Lâm Đồng Trail
GET /series/lamdong-trail
{"name":null,"editions":null}

### Q5a upcoming by price
GET /races?sort=price&pageSize=5
{"meta":{"at":"2026-09-24","excluded":{"noPrice":0,"notOnSale":0,"stale":0,"noGeo":0}},"races":[{"name":"Giải chạy Run For The Heart - Chạy vì trái tim 2026","price":169000},{"name":"Giải Chạy Quốc Tế Vì Đà Lạt Xanh 2026","price":200000},{"name":"Giải chạy bộ Salonpas 2026","price":235000},{"name":"FV RUN - Run with Heart, Run for Hope","price":250000},{"name":"Quảng Trực Half Marathon 2026 - Nối nhịp biên cương","price":269000}]}

### Q5b longest
GET /races?sort=distance_desc&pageSize=3
[{"name":"PRENN TRAIL SUMMIT 2026","courses":["3km","10km","25km","55km","75km","103km","250km","100mi"]},{"name":"ULTRA TRAIL CAO BANG 2026","courses":["10km","25km","42km","70km","100km","160km"]},{"name":"Vietnam FesTRIval 2027","courses":["56.50","70.3","Sprint"]}]

### Q5c shortest
GET /races?sort=distance_asc&pageSize=3
[{"name":"FV RUN - Run with Heart, Run for Hope","courses":["1km","5km","10km","21km"]},{"name":"Quảng Trực Half Marathon 2026 - Nối nhịp biên cương","courses":["1.5km","5km","10km","21km"]},{"name":"Giải Chạy Quốc Tế Vì Đà Lạt Xanh 2026","courses":["1.5km","5km","10km","21km"]}]

### Q6 freshness of one race
GET /races/slug/vung-tau-city-trail

### GET /
GET /
{"dataSchemaVersion":3,"lastSync":{"at":"2026-09-24T06:59:25.341Z","commit":"a8d07027f03898d3610b0c48c3937285567e8567"},"lastFreshnessAt":"2026-09-24T06:59:25.341Z","staleUpcoming":0}

### Q2 after a past trail race (VMM isn't in the data yet): next trail, cheapest first, from HCMC
GET /races?after=nha-trang-city-trail&type=trail_run&sort=price&fromPlace=hcmc&pageSize=5

### Q2b same, sorted by driving time from HCMC
GET /races?after=nha-trang-city-trail&type=trail_run&sort=travel_time&fromPlace=hcmc&pageSize=5

### Q4 editions (a series with 3 on record; Lâm Đồng Trail has one edition, no series yet)
GET /series/bac-ninh-legacy-marathon
{"name":"Giải chạy Bắc Ninh Dấu chân Miền Quan họ","editions":{"onRecord":3,"stated":null,"label":"3 on record"}}

### Q6 freshness of one race
GET /races/by-slug/vung-tau-city-trail
{"name":"Giải chạy Vũng Tàu City Trail 2026","freshness":{"lastCheckedAt":"2026-09-23T19:01:53.539Z","lastChangedAt":"2026-09-24T06:49:38.787Z","cadence":"weekly","dueAt":"2026-10-01","final":false,"status":"fresh"},"geo":"Thành phố Hồ Chí Minh"}

### Q2 (retry with the full slug)
GET /races?after=nha-trang-city-trail-2026&type=trail_run&sort=price&fromPlace=hcmc
{"total":4,"races":[{"name":"PRENN TRAIL SUMMIT 2026","date":"2026-12-09","price":800000,"status":"on_sale","hcmc":{"place":"hcmc","km":185.2,"minutes":null,"method":"straight_line"}},{"name":"Lamdong Trail 2026","date":"2026-11-06","price":950000,"status":"on_sale","hcmc":{"place":"hcmc","km":298.7,"minutes":228,"method":"road"}},{"name":"Măng Đen Ultra Trail 2027","date":"2027-01-15","price":1450000,"status":"on_sale","hcmc":{"place":"hcmc","km":619.2,"minutes":482,"method":"road"}},{"name":"ULTRA TRAIL CAO BANG 2026","date":"2026-11-27","price":null,"status":"no_price","hcmc":{"place":"hcmc","km":1805.9,"minutes":1377,"method":"road"}}]}
```

## Decisions made while the user was away (all written into plan 004)

- `inferred` is an array (`["from"]`, `["to"]`), not `true`, so it's clear which date was filled in.
- The freshness status `unscheduled` is for races that only manual sites list (no schedule to be late for).
- The point and its codes are cached in `state/geo.json`; composing a race only reads the cache. Only compact reference files are committed in `ref/` (the ward polygons are 621 MB; simplified: 2.6 MB).
- No ORS key: the public OSRM demo server, then straight-line km. Islands (special zones, except Vân Đồn) are `flight_or_ferry`, straight-line.
- A venue naming one of the 13 places gets that place's centre (`source: "place"`, precision `province`) when Nominatim fails: Nominatim puts "Nha Trang" at sea.
- API sync applies freshness, places and admin units only on a call that downloads no race files (the first v3 sync hit the free plan's CPU limit); 15 files per call.

## For the user

- [ ] Review `config/places.yaml` (13 places, centres, radii, old districts). Drafted, not reviewed.
- [ ] Add an OpenRouteService key (`ORS_API_KEY` in `.env` and the repo secrets) if you want ORS instead of the OSRM demo server; the code switches by itself.
- [ ] 33 races have no point: set them with `npm run edit -- <race> geo '{"lat":…,"lng":…}'` if they matter.
- [ ] The `opencoded` alias doesn't work with `opencode run` (a flag before the subcommand prints the help). Use `opencode run --auto`.

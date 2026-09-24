# openrace-data

The race data behind OpenRace (openrace.vn): one JSON file per race edition in Vietnam, read from ticket sellers (ActiUp, ...) and races' own sites, with a git history of every change.

The design and the reasons behind it are in [`.claude/docs/design-v2.md`](.claude/docs/design-v2.md), with schema v3 (courses, location, freshness) in [plan 003](.claude/plans/003-2026-09-24-schema-v3-geo-price.md). Where it's going: [`.claude/docs/roadmap.md`](.claude/docs/roadmap.md). The current state: [`.claude/docs/status.md`](.claude/docs/status.md).

## How it works

```
config/sites.yaml ──► recipe (free: plain requests, site APIs) ──► snapshot of each race
                                                                       │ changed since last time?
                                                                       ▼
                       Firecrawl Parse (paid, ~5 credits): cleaned HTML → JSON,
                       price image → PDF → OCR → JSON   (cached by content)
                                                                       │
                                                                       ▼
   geo (npm run geo): venue → point (Nominatim, maps link) → ward and old units,
   driving km/minutes from 13 places (OSRM demo or ORS)   (cached in state/geo.json)
                                                                       │
                                                                       ▼
          planner (sync.ts): match to races, merge sources, series, tier windows, geo
                                                                       │
                                                                       ▼
   one commit to main (+ state/freshness.json) ──► validate ──► API resync ──► Discord
```

- **Sites** (`config/sites.yaml`): each site has a kind and a read cadence. The kinds are `seller` (ActiUp, bibchung, 5BIB, iRace, ...), `hub` (an organizer's site with many races, e.g. VnExpress Marathon) and `race-site` (one race's own site). Sites with `recipe: none` are only recognized in links.
- **Recipes** (`scripts/lib/recipes/`): each one knows a site's layout: where its races are, and which pages and images of a race to read. See [`scripts/lib/recipes/README.md`](scripts/lib/recipes/README.md).
- **Reading:** Firecrawl only reads what the recipe hands it. An unchanged race costs nothing (fingerprint), and the same content is never paid for twice (`state/reads.json`).
- **Merging:** the race's official site wins for date, courses and location. Every seller keeps its own prices. Tier dates a source leaves blank are filled in from the neighbouring tiers and marked `inferred`.
- **Location:** the venue text stays as written; `geo` adds a point, current and pre-2025 admin codes (reference data in `ref/`), and distance from the 13 places in `config/places.yaml`.
- **Freshness:** every commit writes `state/freshness.json` (last check, cadence, due date per race); the API shows it, and a weekly Discord line lists stale upcoming races.
- **Series:** series come from the site config or recipe (VnExpress Marathon, HCMC Marathon), or from slugs shared across years (`dalat-ultra-trail-2024/2025/2026`).

## Layout

```
config/sites.yaml         sites to read, recipes, cadence; monthly credit cap
config/places.yaml        the 13 places for "near" and "distance from"
data/races/<slug>-<year>.json   one race edition
data/index.json           id → slug, name, date, file, series, source and link URLs
data/series.json          recurring events (added automatically, never changed; edit by hand)
data/organizers.json      organizers (same)
data/places.json, data/admin-units.json   places and province/district names, for the API (written by npm run geo)
ref/                      admin-unit reference data at a pinned version (npm run geo:ref); see ref/README.md
schema/                   JSON Schema of the above (generated: npm run schema)
state/                    checks.json (per page), sites.json (per site), credits.json, reads.json (read cache),
                          geo.json (point and codes per venue), freshness.json (per race)
scripts/                  check, edit, renormalize, sync, validate, notify-*
```

## A race

```jsonc
{
  "id": "…uuid…", "slug": "hcmc-marathon", "name": "HCMC Marathon",
  "types": ["road_run"], "date": "2027-01-17", "endDate": null,
  "seriesId": "hcmc-marathon", "organizerId": "pulse-active", "organizer": "Pulse Active",
  "edition": null,              // the organizer's stated number ("lần thứ 5"), if any
  "courses": [{ "label": "42km", "meters": 42195, "type": "road_run", "elevationGain": null }],
  "location": { "venue": "30/4 Park, Le Duan", "city": "Ho Chi Minh City" },   // as the site writes it
  "geo": {                      // null: not located (virtual, abroad, not found)
    "lat": 10.78, "lng": 106.70, "source": "nominatim", "precision": "venue",
    "current": { "province": "79", "ward": "…" }, "legacy": { "province": "79", "district": "760", "ward": "…" },
    "access": "road", "fromPlaces": { "hcmc": { "km": 1.2, "minutes": 4, "method": "road", "near": true } }
  },
  "prices": [
    { "distance": "42km", "tier": "Early Bird", "kind": "early", "audience": "resident",
      "price": 1020000, "from": "2026-06-24", "to": "2026-07-16", "inferred": [], "site": "hcmc-marathon" }
  ],
  "currency": "VND", "registrationStatus": "open",
  "registrations": [{ "site": "njuko", "url": "https://in.njuko.com/ho-chi-minh-city-marathon-2027" }],
  "links": [{ "url": "https://facebook.com/hcmcmarathon", "kind": "facebook", "foundOn": "hcmcmarathon.com" }],
  "flags": [],                  // things to look at, e.g. sources disagree on race day
  "overrides": {},              // values set by OpenRace; they win over every source
  "sources": [{ "site": "hcmc-marathon", "role": "official", "url": "…", "extracted": { … } }],
  "confidence": "single-sourced", "createdAt": "…", "updatedAt": "…"
}
```

- **Price tiers:**
  - `kind` is one of super_early, early, regular, late, group, other.
  - `audience` is resident, non_resident or null.
  - Dates without a year on posters take their year from race day.
  - Add-on fees (photos, VIP, transfers) are left out.
- **`null` means unknown**, never "no" or "zero".
- **Consumers** must ignore unknown fields and tolerate unknown enum values. `SCHEMA_VERSION` (now 3) is bumped only for breaking changes.

## Commands

Committing runs need a token; your gh login works: `GITHUB_TOKEN=$(gh auth token)`. Without it, use `--dry-run`.

```bash
npm run check -- --site <key> --free --dry-run         # free: what would be read, and the most it would cost
npm run check -- --site <key> --dry-run --preview /tmp/x   # paid reads, no commit; planned files in /tmp/x
npm run check -- --site <key> [--limit N] [--past]     # read and commit
npm run check -- --race <url|slug|id>                  # one race
npm run check -- --site actiup --past --facts-only     # free: races from ActiUp's API only (no prices)
npm run check                                          # every site that is due (the scheduled run)

npm run edit -- set <race> <field> '<json>' --reason "…"   # OpenRace override (also: unset, slug, add)
npm run renormalize [-- --commit]     # re-derive every race from stored reads (no reading)
npm run geo [-- --refresh]            # locate races not in state/geo.json yet (Nominatim 1/s, OSRM demo or ORS_API_KEY)
npm run geo:ref                       # rebuild ref/ from the pinned sources
npm run freshness                     # rebuild state/freshness.json locally
npm run notify:stale -- --dry-run     # the weekly stale-races Discord line
npm run sync -- inputs.json [--commit]   # commit extractions made elsewhere (e.g. by an agent)
npm run typecheck && npm test && npm run validate
```

GitHub Actions:
- **Check races** (`check.yml`) runs the checker. It's manual only; the schedule is off until the data is trusted.
- **Main** validates every push, resyncs openrace-api when `data/` changed, and posts data changes to Discord. Run it by hand for a full resync.
- **Stale races** (`stale.yml`) posts the stale upcoming races to Discord every Monday. Routine checks only touch `state/`, which Main ignores: the API's daily cron reads `state/freshness.json` itself.

## Limits to know

- **Firecrawl:** the Free plan has 1,000 credits a month. Pages and images cost about 5 credits each.
- **Race sites:** only the current edition is on the site; past editions need the Wayback Machine or a seller's old page.
- **Images:** only PNG and JPEG images can be OCR'd.
- **Races seeded with `--facts-only`** have no prices, courses or types until a normal run reads them.
- **Location:** 267 of 300 races located; about 60 only to province precision. No ORS key yet, so driving distances come from the public OSRM demo server (light use, cached).

# Plan: North/Central/South region as a filterable field

**For:** a future session, across three repos (openrace-data → openrace-api →
openrace-web/openrace-mcp consume it).
**Read first:**
- `.claude/docs/roadmap.md` — "How many trail races a year? North vs South?" row (path
  step 4) already names this as a planned question; `region` is listed there as a
  needed field.
- `config/places.yaml`, `data/places.json`, `schema/places.schema.json` (the 13 curated
  hubs, plan 003/004)
- `ref/units-2025.json` (34 post-merger provinces: code, name, short, lat, lng)
- openrace-api: `src/db/schema.drizzle.ts` (`places`, `adminUnits` tables),
  `src/api/routes/places/places.schema.ts`, `src/api/routes/races/races.schema.ts`
  (`province`, `near` query params and their matching logic in `races.services.ts`)
- openrace-web: `src/lib/vn-provinces.ts`, `src/components/openrace/or-race-filters.tsx`
  (current UI this plan will eventually feed)

## Problem

The site is redesigning its race filters around two primary choices: race type, and a
tap-only location picker (no typing — see the "hate to type into an input" direction
from the openrace-web session). The 13-hub picker (`GET /places`) is already tap-only,
but 13 flat chips is judged too many to scan and will only grow. The proposed fix is to
group hubs (and eventually provinces) under three regions — Bắc / Trung / Nam — so the
UI is two shallow taps (region → hub) instead of one long scan.

The user was explicit that this must **not** be a hardcoded map living only in
`openrace-web`: `openrace-mcp` reads the same `openrace-api`, and a client-side-only
region grouping would mean the MCP (and any other consumer) can't filter or answer "how
many races in the South" at all — the two clients would also risk disagreeing on where
the line falls. Region has to be data the API serves, not a UI convenience.

This also isn't a new idea: the roadmap's path step 4 already lists "North vs Central
vs South" as a planned stat, needing "admin codes / region." This plan is that field,
built earlier than step 4 because a filtering UI now needs it too.

## Roadmap fit

- **Serves** path step 4 directly (the "North vs South" stat row) and, earlier than
  expected, path step 2/5 (a filterable field surfaced through the public API and thus
  through the MCP too).
- **Trust principle 3** ("honest about uncertainty"): the North/Central/South split has
  no single official boundary in Vietnam (colloquial 3-region split vs. the older
  administrative "Tây Nguyên" / Central Highlands treated as its own group by some
  sources). This plan picks one mapping and states it plainly rather than presenting it
  as an authoritative government classification — flagged for the user to confirm before
  building (see Open question below).
- No constraint or non-goal is weakened. Region is a coarser grouping over data
  (province codes) OpenRace already holds; it adds no new source, no new cost, no
  personal data.
- **Out of scope:** letting users draw custom regions, sub-regions (e.g. "Tây Bắc" vs
  "Đông Bắc"), or any UI work — that's a separate openrace-web plan once this ships.

## Decision (confirmed 2026-09-25)

Option 1 below: 3-way split, Central Highlands folded into Nam. The full 34-province
mapping is drafted at `ref/regions.json` (opencode worker draft, verified structurally —
34 entries, codes match `ref/units-2025.json` exactly, no dupes — and spot-checked by
hand: Thanh Hóa corrected to `central` since it's Bắc Trung Bộ, not Bắc Bộ, despite the
worker's own uncertainty flag; Khánh Hòa and Quảng Ngãi confirmed `central` is correct
against standard Trung Bộ boundaries). This file is a draft artifact for step 1 below,
not yet wired into the schema/pipeline — that's still future work, not started without
explicit go-ahead.

## Open question (resolved — kept for context)

Which province → region mapping to use. Two reasonable options:

1. **Simple 3-way split** (what most Vietnamese people mean colloquially): Bắc / Trung /
   Nam, with Central Highlands provinces (Lâm Đồng/Đà Lạt, Đắk Lắk/Buôn Ma Thuột, Gia
   Lai) folded into Nam or Trung depending on source.
2. **4-way split**: Bắc / Trung / Tây Nguyên (Central Highlands) / Nam — more precise,
   matches how some tourism/government sources group these provinces, but a 4th region
   is one more group than the "quick tap" UI goal wants, and most casual users won't
   think in "Tây Nguyên" terms.

**Recommendation: option 1 (3-way), Central Highlands folded into Nam** — matches how
the 13 curated hubs already read colloquially (Đà Lạt and Buôn Ma Thuột are usually
called "miền Nam" in everyday speech, not a separate region), and keeps the UI at the
3 taps the redesign wants. This needs the user's explicit confirmation (trust principle
3) before the mapping is committed, since it's a judgment call, not a lookup.

## Options for where the mapping lives

1. **Province-level field on `ref/units-2025.json` (or a new `ref/regions.yaml`),
   derived into `data/admin-units.json` and synced into `openrace-api`'s `admin_units`
   table; `data/places.json` derives each hub's region from the province its center
   falls in (or a manual override in `config/places.yaml`, same pattern as `legacy`).**
   - Pro: one source of truth (province), consistent with how `near`/`province` already
     work as two separate query params over the same underlying geography; every future
     province-level feature (not just the 13 hubs) gets `region` for free; matches path
     step 4's stat table, which is province-level ("North vs Central vs South" over all
     races, not just races near a hub).
   - Con: needs a full 34-province mapping decision up front (see Open question), not
     just 13 hub assignments.
2. **Region only on the 13 curated places (`config/places.yaml` gets a `region` key per
   hub), nothing at the province level.**
   - Pro: smaller: 13 lines, not 34.
   - Con: doesn't serve path step 4's stat ("North vs South" needs every race's
     province, including the many races nowhere near one of the 13 hubs); a race whose
     `province` filter is set but has no `near` hub would have no region; the API's
     `?region=` filter (see below) couldn't cover races outside all 13 hub radii, which
     is most of the country by area.

**Recommendation: option 1.** It costs one more decision (the full mapping) but is the
only option that answers the roadmap's actual stat question and keeps `province`,
`near`, and `region` as three consistent lenses on the same province data instead of
two lenses (`province`, `near`) plus one narrower one (`region`, hub-only).

## Steps (once the mapping is confirmed)

1. **Data**: add a `region` field (`"north" | "central" | "south"`) to each province
   entry, either directly in `ref/units-2025.json` or a new small `ref/regions.yaml`
   (code → region) kept next to it — whichever fits the existing "generate `data/*.json`
   from `ref/*` and `config/*`" pipeline (`scripts/lib/schema.ts` comments describe the
   pattern). Update `schema/admin-units.schema.json` (or wherever province rows are
   published) to include `region`.
2. **Data**: `config/places.yaml` — either derive each hub's region from its province
   (lat/lng → nearest province, or an explicit `legacy.districts`/province code lookup
   already used for the merger mapping) or add an explicit `region:` key per hub if
   derivation is ambiguous for a hub near a regional boundary. Regenerate
   `data/places.json` (and `schema/places.schema.json`'s `region` field, enum of the 3
   values).
3. **openrace-api**: `admin_units` table (`src/db/schema.drizzle.ts`) and `places` table
   both get a `region` column; `sync.services.ts` picks it up from the synced JSON like
   every other admin-unit/place field.
4. **openrace-api**: `GET /places` response (`places.schema.ts`) adds `region` per hub.
   `GET /races` (`races.schema.ts`, `races.services.ts`) adds a `?region=north|central|
   south` query param, implemented the same shape as the existing `provinceCondition()`
   helper — match races whose `provinceCode` (or `legacyProvinceCode`) resolves to a
   province with that region. Existing `province`/`near` params are unaffected;
   `region` is a third, coarser filter, not a replacement.
5. **openrace-api**: if path step 4's stats endpoint (`src/api/routes/stats/`) is built
   before this, add a "races by region" breakdown there too, reusing the same province →
   region lookup.
6. **openrace-mcp**: no code change expected — it proxies `openrace-api`, so a new
   `?region=` query param and `region` field on places/races becomes available to agents
   automatically once step 4 ships. Confirm its tool schemas don't hardcode the current
   `races` query param list in a way that would need a matching update (check
   `openrace-mcp` tool definitions for `near`/`province`-style enums).
7. **openrace-web**: not part of this plan — once `region` exists on `GET /places` and
   `?region=` works on `GET /races`, the filter-redesign session wires the two-level tap
   UI (region chips → hub chips within that region) against it. Revisit the filter UI
   discussion at that point.

Steps 1–2 done in this repo: `region` (`"north" | "central" | "south"`, from
`ref/regions.json`) is now on every province in `data/admin-units.json` and every hub
in `data/places.json` (`config/places.yaml` carries the source-of-truth `region:` key
per hub, resolved from each hub's center point via `locate()` + `ref/regions.json`,
not hand-typed). Schemas regenerated (`npm run schema`), `npm run validate` and
`npm test` pass. Next: openrace-api step 3 onward (sync `region` into
`admin_units`/`places`, add `?region=` to `GET /races`).

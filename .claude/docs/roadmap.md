# Roadmap

Where OpenRace is going and why. **Every plan and every non-trivial piece of work is checked against this file** (see `AGENTS.md`). If a request doesn't serve the path, weakens a trust principle, breaks a constraint or hits a non-goal, the agent says so and asks before going on. When the user confirms a change of direction, it goes in the change log at the bottom, so the road only moves on purpose.

Day-to-day tasks live in [status.md](status.md); how things are built lives in [design-v2.md](design-v2.md) and the plans.

## Mission

**The trustworthy source for races in Vietnam.** People (and other systems) use OpenRace because its data is correct, complete and current, and because they can see why they can trust it.

**Focus on data, not people.** OpenRace is about races, not runners, organizers or users.

## How we earn trust (principles no plan may weaken)

1. **Every fact traces to a source.** Each race keeps its source links and what each source said (`sources[].extracted`). Nothing is invented.
2. **Fresh, and visibly fresh.** Every race has a known last-checked time and a check cadence, and the API shows both. Stale data is flagged, not hidden.
3. **Honest about uncertainty.** Disagreements and gaps become `flags` and `confidence`, not silent guesses. An unknown value is `null` and is never treated as zero or cheap.
4. **Corrections are explicit.** Hand fixes are overrides with a reason, and they survive re-checks.
5. **We learn how organizers publish.** Each site is studied first (free requests), then read with a recipe and a saved test page with the known answer. A misread gets fixed in code and becomes a test, rather than just being re-read.
6. **Automated, not reviewed.** The user doesn't review commits, so validation and sanity checks do the reviewing before anything is committed.

## The path

1. **Trusted data.** Any source (sellers, hubs, race sites), recipes, agent-read, price tiers, series and organizers. *Built (design v2).*
2. **Questions people ask** (table below): schema v3 and API queries. *Built: [plan 003](../plans/003-2026-09-24-schema-v3-geo-price.md), live 2026-09-24.*
3. **Fresh without effort.** Freshness in the API (plan 003), then the daily cron once the data is trusted.
4. **Stats from the data:**
   - trail races per year
   - North vs Central vs South
   - distance distribution
   - elevation gain
   - share of races with GPX
   - price trends by year
   - deeper stats once there's enough history (backfill)
5. **Open it up.** A public API and an MCP server, then act as a data provider for others (for example Firecrawl's provider catalogue, other apps). *API built; MCP server built ([plan 005](../plans/005-2026-09-24-mcp-server.md), live 2026-09-24).*

## Questions OpenRace should answer

A new question goes in this table first. When it gets built, it gets a plan and the Status column links to it.

| Question | Needs | Status |
| --- | --- | --- |
| I'm in Nha Trang 1–15/12: which races are nearby on those days? | `geo`, places list, date overlap (`date`..`endDate`) | Built ([plan 003](../plans/003-2026-09-24-schema-v3-geo-price.md)) |
| I just finished VMM: next trail run, cheapest first, close to HCMC | type, "after this race", price on a date, driving time from a place | Built (plan 003) |
| All races under 300k at today's tier | price per distance on a date | Built (plan 003) |
| How many times has Lâm Đồng Trail been held? | series, `edition`, past editions backfilled | Built (plan 003); past editions: data fill |
| Sort upcoming races by price, longest or shortest distance | `courses[].meters`, price on a date | Built (plan 003) |
| When was this race's data last checked? Can I trust it? | freshness per race in the API | Built (plan 003) |
| How many trail races a year? North vs South? Distance distribution? | backfill, `types`, `courses`, admin codes / region | Later (path step 4) |
| How big is this race, and which series is the biggest? | `participants` per edition (stated count, `approx`, required source link), series aggregates in the API | Building (openrace-web plan 012) |
| Elevation gain and share of races with GPX | `courses[].elevationGain`; GPX files added by hand by the user | Later (GPX is manual, not scraped) |

Old place names ("Nha Trang", "Bình Dương") must keep working after the 2025 merger: people and race names still use them.

## Constraints

- **Budget:** ≤ $5/month after the first month. In practice that means the Firecrawl Free plan, Cloudflare free tiers and free services only (Nominatim, OpenRouteService free key). No paid APIs, and no Claude API in scheduled runs.
- **Non-commercial for now.** If that changes, check the terms of every free service (OpenRouteService first).
- **Scale:** 100–150 races a year.
- **Agent-read and Firecrawl produce the same format.** Neither is the only way in.
- **Breaking openrace-api is allowed** while the contract settles. It's updated in the same pass.

## Non-goals

- **Selling tickets, or tracking ticket quotas or sold-out tiers.** We record tiers and their dates only. No capacity, slots-left or sold-out counts; "how many took part", stated after the event, is a different fact.
- **Scraping GPX files.** GPX is added by hand by the user, later.
- **User accounts and social features** (profiles, reviews, comments).
- **Races outside Vietnam.**
- **Race results and timing** (finish times, rankings, live tracking). An aggregate participant count per edition, with a source link, is in scope (change log, 2026-09-28); finisher counts, runner rankings and per-runner data are not.
- **Anything about or for people rather than races:** paid listings or sponsored ranking, organizers editing their own races (their site is a source; corrections are our overrides), personal data about runners.

## Change log

Deliberate changes of direction, newest first.

- **2026-09-28:** An aggregate participant count per race edition, with a required source link and an `approx` flag, is in scope (unknown is `null`, never 0). Finisher counts, runner rankings, capacity and quotas remain non-goals; the site's "Largest" series ordering ranks races by size, not people. openrace-web plan 012.

- **2026-09-24:** Non-goals confirmed: accounts and social features, races outside Vietnam, results and timing, and anything about people rather than races ("focus on data, not people").
- **2026-09-24:** Location is normalized after all. Races get a point, current and old admin codes, and driving distance from 13 fixed places (was "location as written, no lat/lng"). Scheduled runs may use free services (was "Firecrawl only"). Plan 003.

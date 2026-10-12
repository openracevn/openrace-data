# Plan 024: Launch readiness, an owner's review and a plan for today

Date: 2026-10-12. Status: **superseded by [plan 025](025-2026-10-12-api-and-mcp-are-the-product.md)** the same day: the user decided the API and MCP are the product and the website shrinks to a few static pages. Its review findings and its data work (blocks 2 and 3) carry over into plan 025. Spans openrace-data, openrace-web, openrace-api and openrace-mcp. It replaces the order of [plan 021](021-2026-09-29-mvp-launch-checklist.md): the domain comes last, and launch means `openrace.perxel.com`.

## Roadmap fit

- Serves path step 3 ("Fresh without effort") and step 5 ("Open it up"; the website is its public window).
- **Change to confirm:** launch on `openrace.perxel.com`. There is no budget for a new domain, and `openrace.vn` is postponed. This goes in the change log and in plan 021.
- **Tension, needs a decision:** "Non-commercial for now" vs "a Perxel product". My recommendation: stay non-commercial (free, no ads, no paid tier) and use Perxel as attribution only. Before launch, check the OpenRouteService terms anyway.
- Automation stays inside the constraints. It uses free sources only, with no Firecrawl and no Claude API in scheduled runs. Firecrawl stays opt-in (change log, 2026-09-29).
- No trust principle is weakened. A race is never marked fresh unless it was actually checked.

## Owner's review (what a runner would see today)

1. **The website is down.** On 2026-10-12, every page on `openrace.perxel.com` returns 503 (Cloudflare error 1102: the Worker exceeded its CPU or memory limit). It served the home page minutes earlier, so it's intermittent and probably load- or cache-dependent. Free-plan Workers allow 10 ms of CPU per request, and a Next.js (OpenNext) render can go over that. The API still answers.
2. **Nothing has updated the data for 13 days.** The last data commit is 2026-09-29. The daily `Main` run only re-syncs; it doesn't check anything. `check.yml`'s cron is commented out. 40 of 44 races still being checked are overdue (`state/freshness.json`). Every upcoming race card on the home page carries the "Cũ" (stale) badge. That label is honest, but it's the first thing a visitor sees.
3. **New races aren't found.** ActiUp alone lists 5 upcoming races we don't have (Đồng Nai Marathon 29/11, Nha Trang Night Run 12/12, Đất Thép City Trail, Măng Đen Lala Trail, Aqua Warriors Hạ Long). iRace and 5BIB haven't been checked. Finding races depends on someone starting a Claude session.
4. **Errors a runner would notice on a race page** (VPBank Hanoi Marathon 2026):
   - The organizer is shown as "Đơn vị tổ chức: Ngân hàng TMCP…", with the label inside the name. 5 race files have this, and 45 of 170 organizers have merged-looking names.
   - The page says "Đăng ký đã đóng" while the price says on sale until race day. These contradict each other.
5. **The home page speaks to developers more than to runners.** Half of it is MCP, API and stats. A runner wants answers to "what can I sign up for, and when does the price go up?" We have tier dates for that, and no one else shows them. The regional map shows numbers with no place names.
6. **Not open yet:** robots blocks everything, CORS only allows openrace.vn, there's no license, and `llms.txt` has no URLs.

Conclusion: we shouldn't launch until (1) the site stays up, (2) upcoming races are actually fresh and complete, and (3) something keeps them fresh without me in the loop.

## Today, in order

Each block ends with something the user can check. If the day runs short, cut from the bottom.

### 1. Keep the site up (openrace-web): first, about 1–2 h
- Reproduce the 1102 error and read `wrangler tail` or the Cloudflare logs to find which route and what is expensive.
- Likely fixes: cache API responses and pages (ISR or `revalidate`, Cloudflare cache), avoid fetching the whole race list on each render, and move heavy aggregation into the API.
- If free-plan CPU truly can't serve it, Workers Paid ($5/month) fits the budget exactly. That's a cost decision for the user.
- **Done when:** 50 requests across `/`, `/races`, `/series`, `/stats` and a race page all return 200.

### 2. Make the upcoming data fresh (openrace-data, `update-race` skill, free): about 2–3 h, in parallel with block 1
- Add the 5 missing ActiUp races. Sweep iRace and 5BIB listings for upcoming races we don't have.
- Run `update-race` on all upcoming races, the 25 in the next 60 days first. This re-checks dates, prices, registration status and courses, and records a real check, which clears "Cũ" honestly.
- Fix the 5 "Đơn vị tổ chức:" organizer names.
- **Done when:** `npm run gaps` shows 0 overdue upcoming races and every upcoming race has prices or a flag explaining why not. One `npm run flush` commit.

### 3. Freshness without me (openrace-data): about 2 h
- **A daily free discovery job** (`discover.yml`): read the ActiUp public API and iRace and 5BIB listings with plain fetch (0 credits). New race → facts-only race file (as on 2026-09-24). Known race → refresh the facts (date, sale status, min price) and mark it checked *for those facts only*. Changes that need a real read (new price image, new course) go to a Discord digest: "N new, M changed, read these".
- **Alert on a red `validate` on `main`** (plan 021 #11). Right now a failure freezes the public data silently.
- Make the weekly `Stale races` Discord message actionable: one list, with the `update-race` command to paste.
- **Done when:** a manual run of `discover.yml` creates or updates races, commits once and posts the digest.

### 4. Make the web helpful to a runner (openrace-web): about 2 h
- Home: lead with "upcoming races you can still sign up for", with filters for month, region and distance. Add a **"Giá sắp tăng" / "Sắp đóng đăng ký"** strip built from tier dates. This is the unique value. Move the API and MCP blocks below.
- Fix the registration-closed vs on-sale contradiction. Add place names to the map.
- Hide the organizer label prefix in the UI as well (in case the data has it again).

### 5. Open it on the Perxel subdomain: about 1 h
- `SITE_URL` from env = `https://openrace.perxel.com`, used by seo, robots, sitemap and breadcrumbs. Allow robots on that host.
- API CORS: any origin for GET. Rate limit unchanged.
- LICENSE files: CC BY 4.0 for the data ("OpenRace by Perxel"), MIT for the code (pending the user's OK). Add a Perxel footer and `parentOrganization`.
- `llms.txt` with the real API, `/reference` and MCP URLs.
- Live assistant check: ask 3 roadmap questions in Vietnamese and English through Claude connected to the MCP server.
- The user submits the sitemap to Google Search Console.

### Not today
- `openrace.vn` and the `api.`/`mcp.` custom domains (done last, once there's budget). If `perxel.com` is on Cloudflare, `openrace-api.perxel.com` is free; worth checking later, so the public URLs aren't on a personal `bmp.workers.dev` subdomain.
- MCP registry and Smithery listings, Dataset JSON-LD, trends (plan 020), past-race backfill.

## Decisions needed from the user
1. Go on this order? (Blocks 1–2 can run in parallel.)
2. Non-commercial with Perxel as attribution only? Licenses CC BY 4.0 for the data and MIT for the code?
3. If the site can't fit the free Workers CPU limit, is Workers Paid at $5/month OK? (It uses the whole budget.)

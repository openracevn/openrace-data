# Plan 025: The API and MCP are the product; the website shrinks to a small static window

Date: 2026-10-12. Status: decided by the user 2026-10-12; open decisions settled the same day; not built yet. Spans openrace-web (most of the work), openrace-api (CORS, a build header, license, `llms.txt`), openrace-mcp (`server.json`, registry listings, tool-call stats) and openrace-data (docs, automation). It supersedes [plan 024](024-2026-10-12-launch-readiness-today.md) and [plan 022](022-2026-09-29-web-home-and-content-depth.md), and amends [plan 021](021-2026-09-29-mvp-launch-checklist.md) (which items still stand is listed below).

## Roadmap fit

This is a change of direction, confirmed by the user, and recorded in the roadmap's change log (2026-10-12) and in the new section "Who we serve, and why not web traffic".

- **Path step 5 changes.** It was "the website is this step's public window: people read the data there" (change log 2026-09-29, plan 022). Now the API and MCP server are the product, and the data reaches people through other apps and assistants. The website only explains what OpenRace is, how to connect, the stats and how the data is kept.
- **Path step 4 (stats) keeps a web page.** It's the one exception the user named: stats need real charts.
- **Constraints:** a hosted chatbot on our site was considered and turned down. Every question would need a paid LLM, which breaks "≤ $5/month" and "no paid APIs". People use their own assistant (Claude, ChatGPT, Cursor) through our MCP server instead.
- **Trust principles:** unchanged. Principle 2 ("visibly fresh") is met by the API and MCP, which carry freshness on every race, and by the transparency page.
- **Launch host:** `openrace.perxel.com`. There is no budget for `openrace.vn`, so domains come last.

## Why: the decision on web traffic (2026-10-12)

The user's decision, from an owner's review on the day the website went down (Cloudflare error 1102: the Next.js Worker went over the free plan's 10 ms of CPU per request).

**Web traffic is not what benefits OpenRace.** A visit is only worth something if it turns into something. A runner visiting the site turns into:

- **money:** none. Ads, ticket sales and paid listings are non-goals, and OpenRace is non-commercial;
- **accounts or community:** none, also non-goals;
- **better data:** almost none. Visitors don't send corrections, and there is no channel for them to;
- **cost:** real. Every page view runs our code, and that is what took the site down.

**What does benefit OpenRace:**

1. **Being the source other systems use:** apps, chatbots and AI assistants calling the API or MCP, and AI search citing us. One integration showing our data to thousands of runners is worth more than those runners visiting us, and it costs us nothing to serve.
2. **Perxel's credibility:** a clear, working data product with an MCP server is a portfolio piece. For that, the right people need to see it work, not crowds.
3. **The data getting better:** that's the moat, and it drives 1 and 2. Visitors don't improve it.

Crawlability still matters, so AI answers can cite us, but it doesn't need race pages. The public JSON on GitHub, `llms.txt` and the API docs cover it at no running cost.

**Success is measured by:** API and MCP calls, the number of distinct clients, integrations (apps or assistants using us), and data completeness and freshness. **Not page views.**

**What we give up, on purpose:** Google search traffic from runners searching "giải chạy tháng 11", and a shareable page per race. If a future plan wants these back, it has to show what that traffic turns into, against the list above.

## What the website becomes

A few prerendered pages in Vietnamese and English, hosted the way `perxel-web-2026` is: an OpenNext Worker with **no middleware**, `staticAssetsIncrementalCache` with cache interception, and every page built ahead. A page view costs almost no CPU, and pages change on redeploy.

| Page | Content |
| --- | --- |
| Home | What OpenRace is (the trustworthy source for races in Vietnam), example questions with real answers, how to connect the MCP server in Claude, ChatGPT and Cursor, links to the API reference, the OpenAPI spec and the JSON on GitHub. "An OpenRace project by Perxel". |
| Stats | Real charts from the API (races per year, North/Central/South, distance distribution, price by year, as data allows); built with the `dataviz` skill; data baked in at build time. |
| Transparency | The completeness score (plan 023) and how the data is kept (sources, freshness, flags, overrides). |
| Developers / connect | May merge into Home; rate limits, license, how to cite. |

**Removed:** race, series, organizer and hub pages (`[slug]`, `[slug]/[leaf]`, month, distance and type pages), search, the map, the `/api/*` routes, `src/proxy.ts` (next-intl middleware), and per-page OG images. Old URLs 301-redirect to Home (rules in `next.config.ts`). Plan 022's per-race pages and thin-page work end here.

**Rebuild:** a GitHub Action in openrace-web rebuilds and deploys daily, and when openrace-data's `Main` workflow syncs the API. The build reads the API through a secret header that skips the 60/min rate limit.

## Steps

### 1. Get the site back as the small static site (openrace-web): first
- **Archive first, delete nothing for good.** The user wants the current full site kept. Before any removal, tag and push the current site: tag `archive/full-site-2026-10-12` on `main`, and keep branch `fix/isr-cache-cpu-limit` (the KV cache attempt) pushed as it is. The slim site is built on a new branch from `main`; the full site can be brought back from the tag.
- Remove `src/proxy.ts`. Locales become folders (`/` Vietnamese, `/en` English) as in perxel-web-2026.
- Delete the removed routes, add the redirects, switch `open-next.config.ts` to `staticAssetsIncrementalCache` + `enableCacheInterception`, and drop the KV binding added on branch `fix/isr-cache-cpu-limit` (then delete the KV namespace `openrace-web-inc-cache`).
- Build, deploy, and check with `curl` that every page returns 200 across 50+ requests. Check the Worker's CPU per request with `wrangler tail` (target: a few ms).

### 2. Open the API and MCP (from plan 021, still valid)
- API CORS: any origin for GET; rate limit unchanged.
- LICENSE files (proposed: CC BY 4.0 for the data with attribution "OpenRace by Perxel", MIT for the code; the user confirms).
- `llms.txt`: real API base, `/reference`, MCP URL and a connect snippet.
- `SITE_URL` = `https://openrace.perxel.com`, robots allow that host, small sitemap.
- Live assistant check (plan 005 step 5): the roadmap questions in Vietnamese and English through Claude connected to the MCP server; fix what breaks.

### 3. Distribution: now the main growth lever (from plan 021, moved up)
- The official MCP registry (`server.json` in openrace-mcp), Smithery, and other MCP directories.
- Firecrawl's provider catalogue and other data catalogues (roadmap path step 5).
- Dataset JSON-LD on the stats page, for Google Dataset Search.

### 4. Data fresh without effort (carried over from plan 024)
- Bring upcoming races up to date with `update-race` (on 2026-10-12, 40 of 44 non-final races were overdue, and 5 upcoming ActiUp races were missing).
- A daily free discovery job (ActiUp API, iRace and 5BIB listings; plain fetch, 0 credits): new races as facts-only files, refreshed facts on known ones, and a Discord digest of what needs a full read.
- A Discord alert when `validate` fails on `main`.

### 5. Measure what matters
- One place that shows, per week: API calls, MCP tool calls, distinct clients, and the completeness snapshot. Sources: the API's analytics and openrace-mcp's `mcp_openrace` dataset.

## From plan 021: what still stands

Still stands: licenses (#3), CORS (#4), llms.txt (#5), the live assistant check (#6), Perxel branding (#8), Dataset JSON-LD (#9, on stats only), listings (#10, MCP registries first; Search Console is optional now), the validate alert (#11). **Last, if budget allows:** domains (#1, #2). **Dropped:** the full `/developers` page as a separate goal (#7 merges into Home) and the status page (#12).

## Decisions (settled by the user, 2026-10-12)
1. Licenses: **CC BY 4.0** for the data (attribution "OpenRace by Perxel"), **MIT** for the code.
2. Non-commercial, with Perxel as attribution only: follows the roadmap constraint as it stands.
3. Developers / connect info is **folded into Home**; no separate page.
4. The current full website is **archived, not lost** (step 1).
5. No hosted chat UI, revisited and turned down again on 2026-10-12: the site stays a static window, assistants connect through MCP.

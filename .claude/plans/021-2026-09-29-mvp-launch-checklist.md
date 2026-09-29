# Plan 021: MVP launch checklist (domain, license, open API and MCP)

Date: 2026-09-29. Status: draft, not yet approved. Spans openrace-data, openrace-api, openrace-mcp and openrace-web. This is the technical side of launch; the web content side (home page, thin pages, developers page) is [plan 022](022-2026-09-29-web-home-and-content-depth.md).

## Roadmap fit

Serves path step 5 ("Open it up: a public API and an MCP server, then act as a data provider for others"). Questions to confirm with the user before building:

- **"Non-commercial for now" (Constraints).** OpenRace is presented as a product of Perxel. If that makes it commercial, the terms of every free service must be checked first (OpenRouteService, Goong, Nominatim). If it stays non-commercial, add a change-log line that says so.
- **A data license** is a new public commitment; it goes in the change log once chosen.

Trust principles are untouched: nothing here changes how data is gathered or checked.

## State found (2026-09-29)

- Upcoming races are launch-ready: 44 upcoming, 44 with a point, 43 with an organizer, 41 with courses, 39 with prices.
- `openrace.vn` does not resolve. Only `openrace.perxel.com` serves the web. `robots.ts` disallows every host except openrace.vn, so **nothing is indexed today**.
- `openrace.vn` is hard-coded in openrace-web `src/lib/seo.ts`, `src/app/robots.ts` and `src/app/[locale]/[slug]/[leaf]/page.tsx` (breadcrumb JSON-LD).
- API and MCP live on a personal subdomain: `openrace-api.bmp.workers.dev`, `openrace-mcp.bmp.workers.dev`.
- No LICENSE file in any of the four repos; openrace-data is public.
- openrace-api `ALLOWED_ORIGINS` is openrace.vn only, so third-party browser apps cannot call the "public" API.
- `public/llms.txt` says "see its own repository" instead of giving the API and MCP URLs.
- Plan 005 step 5 (a real assistant asking the roadmap questions, vi and en) was never done.
- A red `validate` on `main` silently stops the API sync (status.md, Known gaps).

## Checklist

### Blockers

1. **Domain.** Point `openrace.vn` at openrace-web, or decide to launch on `openrace.perxel.com` and change the three hard-coded places (better: one `SITE_URL` used everywhere, including the breadcrumbs).
2. **API and MCP domains.** Workers custom domains `api.openrace.vn` and `mcp.openrace.vn` (free). Update `NEXT_PUBLIC_API_URL`, the MCP `GET /` page, the inspector, READMEs and llms.txt. Keep the workers.dev URLs working.
3. **License.** Proposed: CC BY 4.0 for the data (attribution "OpenRace by Perxel"), MIT for the code. LICENSE file in each repo, plus a short terms page on the web.
4. **CORS.** Allow any origin for GET on the read API; the 60/min per-IP rate limit stays.
5. **llms.txt.** Real API base, `/reference`, `/doc`, MCP URL and a connect snippet.
6. **Live assistant check** (plan 005 step 5): the roadmap questions in Vietnamese and English through a real client connected to the MCP server; fix what breaks.

### For launch

7. **`/developers` page** (vi and en): API reference link, MCP connect steps (Claude, ChatGPT, Cursor), rate limits, license, how to cite. In the sitemap.
8. **Perxel branding:** footer and About ("An OpenRace project by Perxel"), `parentOrganization: Perxel` in the Organization JSON-LD in `src/app/[locale]/layout.tsx`.
9. **Dataset JSON-LD** on `/stats` and `/developers` (license, creator, distribution = API), for Google Dataset Search.
10. **Listings:** Google Search Console and Bing Webmaster (submit the sitemap); the official MCP registry (`server.json`) and Smithery.
11. **Alert on a red `validate` on `main`** (Discord), so a broken check can't silently freeze the public data.

### Optional

12. Public status page (openrace-web plan 011), now unblocked by step 2.

## Testing

- `curl` each domain: 200, correct `robots.txt` (allow on the production host only), sitemap URLs on the production host.
- A browser-origin `fetch` from a non-OpenRace origin to the API succeeds for GET.
- Rich Results Test on a race page, a hub page and `/stats` (Dataset).
- MCP eval (`npm run eval`) against `mcp.openrace.vn`.

## Open decisions

1. Domain: openrace.vn or the Perxel subdomain.
2. License choice.
3. Commercial or non-commercial (Roadmap fit).

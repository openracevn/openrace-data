# Plan 022: The web as the window on the data (home page, thin pages, developers page)

Date: 2026-09-29. Status: built 2026-09-29 (steps 0–5); step 6 is later work. The work is in openrace-web, with a small read from openrace-api; nothing changes in the data. It goes with [plan 021](021-2026-09-29-mvp-launch-checklist.md) (domains, license, open API and MCP) and takes the per-year chart from [plan 020](020-2026-09-29-trends-and-stats.md) when that ships. The web repo's plans index gets a line that links here.

## Roadmap fit

Serves path step 5 ("Open it up: a public API and an MCP server, then act as a data provider for others") and step 4 ("Stats from the data"), by making the site show that there is a dataset, what is in it, and how to use it.

To confirm with the user:

- **The website isn't named in the roadmap path.** `status.md` says the frontend "isn't on the roadmap path yet: add it when that plan is written". Proposal: a change-log line saying the website is step 5's public window (people read the data there; machines are pointed to the API and MCP). **Step 0 adds that line.**

Trust principles hold, and the plan leans on them:

- **1 (every fact traces to a source):** every number and every sentence the site generates comes from the API at render time. No hand-written claims ("the most trusted…"), no AI-written filler text.
- **3 (honest about uncertainty):** a free race says "Miễn phí", a missing price says "Chưa có giá", and neither is shown as 0 ₫. Counts are shown as "X of Y known" where coverage is partial.

Non-goals checked: no accounts, no ticket counts, nothing about runners. The home FAQ says plainly that OpenRace doesn't sell tickets.

## Problem

Measured on 2026-09-29 against the live site (`openrace.perxel.com`, 727 Vietnamese URLs in the sitemap, text counted inside `<main>` with scripts removed):

| Page type | URLs (vi) | Words | Finding |
| --- | --- | --- | --- |
| Home | 1 | ~480 | Doesn't say what OpenRace is: no counts, no years, no freshness, no API, no MCP. Order: series, slogan, then upcoming races last |
| Past races | 343 | ~520 | 239 have neither courses nor prices: mostly empty sections |
| Upcoming races | 44 | ~890 | Fine |
| Series | ~62 | ~170 | Thin; every series has the same meta description |
| Organizers | ~170 | ~190 | Thin; most have 1–2 races |
| Single hubs (province, type, distance, month) | ~40 | 260–450 | Template text and counts only; lists at most the upcoming races (1–7 for most) |
| Combined hubs (province × type/month, type × month) | many | 120–170 | Doorway-like: 1–2 races on a template. `isValidCombo` accepts a combo with 1 race |
| Stats | 1 | ~300 | Thin |

Bugs found on the way:

1. **Every `<title>` ends in "- OpenRace - tagline"**: `TITLE_SUFFIX` in `src/lib/seo.ts:21`.
2. **A free race shows as "0 ₫" on hubs** (`priceRangeLabel` in `src/app/[locale]/[slug]/page.tsx:81` and the copy near line 553), while the race page says "Chưa có giá". Source: `mini-game-kun-fun-run-dong-thap-2026` and `kun-fun-run-dong-thap-2026-keyshop` each have one `Miễn phí` tier at 0. They also look like the same event twice (data follow-up, `update-race`).
3. **The FAQ is shown but not marked up:** hubs render "Câu hỏi thường gặp" with no `FAQPage` JSON-LD. Hubs have no `ItemList` of events; series pages have no JSON-LD at all.
4. **The home region block renders bare numbers** ("6 3 2 2 1 8…") with no labels in the HTML. The block is inside the hero, which stays as it is (see Design), so this is only a label fix if the user wants it.

What we learned from openpanel.dev (the site `design-style.md` already follows): show the product with real numbers instead of describing it; put the AI/MCP use near the top with a real conversation; offer a "get started" grid of ways to connect; make trust concrete mechanisms, not slogans; put an FAQ on the home page; use the footer as an internal-link map to every landing page.

## Goal

Someone landing on any page can tell within a few seconds that OpenRace is a dataset of Vietnam's races (how many, since when, how fresh) that they can browse here or use through the API or MCP. No thin page is left open to indexing.

## Design

### 1. Home page (`src/app/[locale]/page.tsx`)

**The hero (`OrHero`) is not touched:** not its title, map, tabs or layout. Everything goes below it.

```
┌──────────────────────────────────────────────────────────┐
│  HERO (unchanged)                                        │
├──────────────────────────────────────────────────────────┤
│ ① 387 giải · 62 series · 32 tỉnh/thành · từ 2015 · ● cập nhật 2 giờ trước │
├──────────────────────────────────────────────────────────┤
│ ② Những giải sắp tới                  Xem tất cả 44 →    │
│   [race] [race] [race] [race]                            │
├──────────────────────────────────────────────────────────┤
│ ③ Hỏi AI về giải chạy                                    │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 👤 Tháng 11 có giải trail nào gần Đà Lạt, rẻ nhất?   │ │
│ │ ⚙ search_races(type=trail_run, near=da-lat, 11/2026) │ │
│ │ 🤖 Lamdong Trail 2026, 06–08/11, từ 650.000 ₫ …       │ │
│ └──────────────────────────────────────────────────────┘ │
│   Claude · ChatGPT · Cursor   [copy MCP URL]   7 tools → │
├──────────────────────────────────────────────────────────┤
│ ④ Dữ liệu nói gì                                         │
│   ┌────────────┐ ┌────────────┐ ┌──────────────────────┐ │
│   │ giải / năm │ │ cự ly phổ  │ │ tháng đông giải nhất │ │
│   │ ▂▃▅█▇      │ │ biến: 21km │ │ T11 · T12 · T3       │ │
│   └────────────┘ └────────────┘ └──────────────────────┘ │
│                                      Xem thống kê →      │
├──────────────────────────────────────────────────────────┤
│ ⑤ Dùng dữ liệu                                           │
│   [REST API] [MCP] [OpenAPI spec] [JSON trên GitHub]     │
│   Miễn phí · không cần key · <license>                   │
├──────────────────────────────────────────────────────────┤
│ ⑥ Dữ liệu được giữ thế nào                               │
│   515 nguồn đã lưu │ ngày kiểm tra mỗi giải │ chưa biết = để trống │
├──────────────────────────────────────────────────────────┤
│ ⑦ Câu hỏi thường gặp  (FAQPage JSON-LD)                  │
├──────────────────────────────────────────────────────────┤
│ FOOTER (section 4 below)                                 │
└──────────────────────────────────────────────────────────┘
```

- **① Data strip** (`OrDataStrip`, new, server component): races total (`/races?when=all&pageSize=1` → `pagination.total`), series and organizer totals, provinces with at least one race (`/stats/by-province`), earliest year, and `lastSync.at` from the API root shown as relative time ("cập nhật 2 giờ trước"). Each number links: races → `/su-kien`, series → `/chuoi-giai`, provinces → the province hub index, freshness → `/ve-openrace`. `revalidate` stays 300. A failed call hides that one number; it never shows 0.
- **② Upcoming races:** the existing `OrUpcomingRacesStrip`, moved up. The heading's link carries the live count.
- **③ Ask the AI** (`OrAskAiDemo`, new): one fixed question per locale (vi and en in the message files), the tool call it maps to, and an answer **built at render time from the same API query** the MCP tool would make (`search_races` → `/races` with the same parameters), so it can never go stale or claim a race that isn't there. When the query returns nothing, fall back to a second fixed question (a general "next 21km race near HCMC"). Below it: client names, a copy button for the MCP URL, and a link to the developers page's tool list. Styled as a chat transcript (a border, not a shadow, per `design-style.md`).
- **④ What the data says** (`OrHomeStatsPreview`, new): three small cards reusing existing stats data: races per year (the plan 020 `by-year` chart when it exists; until then races per month for the current year from `/stats/by-month`), the most common distance (`/stats/by-distance`, top entry) and the three busiest months. Each card keeps the chart rule from `stats-chart-explanation.md` (title plus a one-line caption saying what's counted). Links to `/thong-ke`.
- **⑤ Use the data** (`OrUseDataGrid`, new): four cards: REST API (base URL, one example request), MCP (URL, "Claude · ChatGPT · Cursor"), OpenAPI spec (`/doc`), raw JSON on GitHub (openrace-data `data/races`). The URLs come from one config module (`src/lib/public-endpoints.ts`), so switching from `*.bmp.workers.dev` to `api.`/`mcp.openrace.vn` (plan 021) changes one file. The license line shows only once plan 021 has picked one.
- **⑥ How the data is kept:** takes the place of `OrFeaturesSection` ("Sự thật, không phải thông tin bán hàng"). One row, three facts with live numbers: source links saved (count from the API, or from a small new field on the API root if there's no existing count), "every race shows when it was last checked", "unknown stays empty, never 0". Links to `/ve-openrace`.
- **⑦ FAQ:** 5–6 questions, vi and en, with `FAQPage` JSON-LD: where the data comes from; how fresh it is; does OpenRace sell tickets (no); can I use the data (API, MCP, license); how to report a mistake; who makes OpenRace (Perxel).
- **Removed from home:** `OrSeriesRow` (series move to the footer and to `/chuoi-giai`) and `OrFeaturesSection`. The components stay if other pages use them; otherwise delete them.
- **Home metadata** (not the hero): the year is the current year, the counts are live, and the visible hero `h1` stays.
  - vi title: "Lịch giải chạy Việt Nam {year}: marathon, trail, bơi, triathlon"
  - vi description: "{races} giải chạy tại Việt Nam từ {firstYear}, {upcoming} giải sắp diễn ra: ngày, cự ly, giá theo ngày và nguồn của từng giải. Có API và MCP miễn phí."
  - en title: "Vietnam race calendar {year}: marathons, trail runs, swims, triathlons"
  - en description: "{races} races in Vietnam since {firstYear}, {upcoming} upcoming: dates, distances, price on a date and the source for each. Free API and MCP."
  - If a count call fails, the description falls back to the same sentence without numbers.

### 2. Developers page (new route)

`/developers` in both locales (`/developers` and `/en/developers`; user, 2026-09-29). In the sitemap, the header nav and the footer.

- What the data is, with the same counts as the data strip.
- **API:** base URL, the Scalar reference (`/reference`), the OpenAPI spec (`/doc`), rate limit (60 requests per minute per IP), three example requests with trimmed responses (upcoming races, a race by slug, a series).
- **MCP:** the URL, how to connect in Claude, ChatGPT and Cursor (copyable config), and the tool list with one line each. The list is generated from the MCP server's `GET /` data if it can be read as JSON; otherwise a static list in the message files, checked against `openrace-mcp/src/tools/`.
- **License and how to cite** ("Dữ liệu: OpenRace by Perxel, <license>"), from plan 021.
- **How the data is built:** a short version of the trust principles, linking to `/ve-openrace`.
- JSON-LD: `Dataset` (name, description, creator Perxel, license, `distribution` → the API) and `WebAPI`.

### 3. Thin pages: stop indexing what's empty, deepen what stays

**Stop indexing (each one also leaves the sitemap, so the two never disagree):**

- **Past races with no courses and no prices** (239 today): `robots: { index: false, follow: true }` in `generateMetadata`, and the same test in `sitemap.ts`. One shared helper, `isThinRace(race)` in `src/lib/seo.ts`, used by both. The page stays reachable, and it comes back into the index by itself when the backfill fills it.
- **Combined hubs with fewer than 3 races:** `isValidCombo` requires `comboCount >= 3` (`MIN_COMBO_RACES`, exported). Below that, the page stays reachable but gets `noindex`, and parent hubs stop linking to it as a hub (they still list the races).
- **Organizers with one race and no links:** `noindex`, left out of the sitemap.

**Deepen single hubs** (province, region, type, distance, month):

- **A summary written from the data**, 2–4 sentences from a template per hub kind, e.g. "Hà Nội có X giải được ghi nhận từ 2015, trung bình Y giải mỗi năm. Tháng đông giải nhất là T10–T12. Cự ly phổ biến nhất là 21km, giá từ A đến B. Series lớn nhất: Z." Every number comes from API calls the hub already makes or from `/stats/*` with a filter; a sentence whose number is unknown is left out, not filled with 0.
- **"Đã diễn ra gần đây"** (recently held): the latest 6 past races, so a hub isn't an almost-empty list between seasons.
- **"Series tại đây"** (series here): series with editions in this province, region or type.
- **JSON-LD:** `ItemList` of the listed races (each links to its race URL) and `FAQPage` for the FAQ already on the page.

**Deepen series pages:**

- A unique meta description from the data: "<series>: N kỳ từ YYYY tại <province>, kỳ tới <date>, cự ly <list>."
- The next edition up top when there is one.
- An edition table: year, date, place, longest distance, cheapest price, participants (with "chưa rõ" when unknown, never 0). The plan 020 series trend goes here later.
- JSON-LD: `EventSeries` with `subEvent` → each edition's `SportsEvent` URL.

**Race pages:**

- A one-sentence summary written from the facts ("<name> diễn ra ngày D tại P, gồm các cự ly …, do O tổ chức, lần thứ N của series S.") when the parts are known.
- Links to the previous and next edition of its series.

**Titles:** `TITLE_SUFFIX` becomes `" | OpenRace"`. For `<title>` only, a name written entirely in capitals gets sentence case (`toLocaleLowerCase("vi")` with the first letter capitalized); the page `h1` and the data keep the name as written.

**Free vs unknown price:** `priceRangeLabel` treats a race whose only price is 0 as free: the label says "Miễn phí" (or "Miễn phí – B" in a range), and races with no price at all are still left out. The same rule on every hub path (lines 81 and ~553 in `[slug]/page.tsx`).

### 4. Footer and header

**Footer** (`or-footer.tsx`), openpanel style, as the site's link map:

| Theo tháng | Theo vùng | Loại hình | Cự ly | Series lớn | Dữ liệu mở |
| --- | --- | --- | --- | --- | --- |
| the next 6 months with races | Bắc, Trung, Nam | road, trail, swim, triathlon… | 5, 10, 21, 42 km | top 6 series by editions | API, MCP, OpenAPI, GitHub, developers page |

The link lists come from the same gated lists `sitemap.ts` uses (a hub with no races is never linked). Bottom row: "OpenRace, a Perxel product" (linking to perxel.com), About, Status (once plan 011 ships), Terms (plan 021), the language switcher.

**Header:** add one nav item, "API & MCP", to the developers page.

### 5. Tooling: an SEO audit script

`scripts/seo-audit.mjs` in openrace-web, from the measuring script used for this plan: reads a sitemap (a URL or a local build), fetches each page, and reports per page type: words in `<main>`, `<title>`, meta description, `h1`, JSON-LD types, `noindex`. It flags thin indexable pages (below a word threshold), duplicate meta descriptions, titles containing "tagline", and "0 ₫". It runs by hand before a deploy (not a CI gate). It is the acceptance check for this plan.

## Steps

0. **Roadmap:** the change-log line from Roadmap fit, and a line in the openrace-web plans index linking here.
1. **Fixes and indexing hygiene** (launch-day, small): `TITLE_SUFFIX`, free-price label, `isThinRace` + sitemap, `MIN_COMBO_RACES = 3`, thin-organizer `noindex`, `FAQPage` + `ItemList` JSON-LD on hubs, series meta description, sentence-case `<title>`. Then `seo-audit.mjs` on a local production build.
2. **Home page:** `OrDataStrip`, move `OrUpcomingRacesStrip`, `OrAskAiDemo`, `OrHomeStatsPreview`, `OrUseDataGrid`, the "how the data is kept" row, the FAQ, and the home metadata. `src/lib/public-endpoints.ts`.
3. **Developers page and footer/header.**
4. **Hub depth:** the data summary, recently held, series here.
5. **Series and race depth:** the edition table, `EventSeries`, the race summary sentence, edition links.
6. **Later, not for launch:** monthly data articles ("Lịch giải chạy tháng 11/2026") built from the month hubs; a calendar export (ICS) of upcoming races. Each gets its own plan.

Steps 1–3 are the launch set. Steps 4–5 can land the days after; the `noindex` in step 1 keeps thin pages out of the index until then.

## Testing

- `pnpm typecheck`, `pnpm lint`, `pnpm build` in openrace-web.
- `seo-audit.mjs` against the local production build: no indexable page under the word threshold, no "tagline", no "0 ₫", no duplicate meta description among series pages, `noindex` on the 239 thin races and on combos under 3; the sitemap and `noindex` agree (no URL in the sitemap is `noindex`).
- Rich Results Test on the home page (FAQPage), a hub (ItemList, FAQPage), a series (EventSeries), a race (SportsEvent) and the developers page (Dataset).
- `OrAskAiDemo`: a fixture where the query returns nothing shows the fallback question; the rendered answer matches `/races` for the same parameters.
- Data strip: a failed API call hides that number and never shows 0.
- The browser is not launched without asking the user (global rule). If not permitted, the UI is reported as not visually tested.

## Risks

- **Too many requests on the home page at render time.** Mitigation: `revalidate` 300 as today, all calls in one `Promise.allSettled`, and each section independent of the others.
- **`noindex` on 239 race pages looks like losing pages.** They are pages Google would rate thin anyway; they come back by themselves as the backfill fills them, because the same helper decides both.
- **The AI demo could read as a promise the MCP can't keep.** Mitigation: its answer comes from the same API query the tool makes, and plan 021's live assistant check runs the same question.
- **Endpoint URLs change with plan 021.** Mitigation: one config module.

## Decisions (user, 2026-09-29)

1. Roadmap change-log line: confirmed, added.
2. Developers page: `/developers` in both locales.
3. Home `metaTitle` and description: written by Claude (above).
4. `MIN_COMBO_RACES` = 3.
5. The hero, including its region block, is not touched.

## Build log (2026-09-29)

Built in openrace-web, checked with `pnpm typecheck`, `pnpm lint`, `pnpm build` and `scripts/seo-audit.mjs` against a local production build. The UI was not viewed in a browser.

Changes from the design above:

- **Combined hubs under 3 races return 404** instead of `noindex`: the page, the parent hub's links and the sitemap already share `isValidCombo`, so raising its minimum (`MIN_COMBO_RACES = 3`) removes them everywhere at once.
- **Series with one edition on record are `noindex`** and out of the sitemap (`isThinSeries`): the page repeats that race's page.
- **Organizers:** `noindex` when one race and no links; the rest got a fact sentence (races, years, places, formats, next race).
- **Series pages** got a fact paragraph (editions, first year, place, next date, distances) that also serves as the meta description, plus `EventSeries` JSON-LD. The edition table and next edition were already on the page.
- **Race pages** got the fact sentence; previous/next editions were already listed.
- **Free prices** read "Miễn phí" on cards, hubs, the status block and the price table (a stated 0 tier), not "0 ₫".
- **`<title>`** for a name written entirely in capitals capitalizes each word (sentence case lowercased "Việt Nam").
- **The hero is untouched**, including its unlabeled region numbers.
- The home stats preview draws races per year from `/stats/by-month` up to the current year (plan 020's `by-year` can replace it later). The "source links saved" count was dropped from the "how the data is kept" row: the race list doesn't carry sources, so there's no cheap count.
- The old home sections (`OrSeriesRow`, `OrFeaturesSection`) and their messages were deleted.

Audit, before → after (Vietnamese and English URLs in the sitemap): 727 vi URLs in the live sitemap before, 618 URLs in both locales after; issues 60 → 19. Race pages: minimum 250 words (239 thin ones out of the index). Left: the three listing indexes (`/cu-ly`, `/loai-su-kien`, `/su-kien-theo-thang`, 46–109 words, link lists by design) and about a dozen English series and organizer pages at 117–149 words, just under the audit's 150-word line.

Still depends on plan 021: the `api.`/`mcp.openrace.vn` domains (`src/lib/public-endpoints.ts`), the license line, and `openrace.vn` itself (until it serves the site, `robots.txt` still disallows every other host, so nothing is indexed).

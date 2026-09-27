# Recipes

A recipe knows one site's layout: **where its races are, and which pages and images of a race hold the facts.** It makes only free requests. Reading what it returns is the reader's job: Firecrawl Parse in scheduled runs, or an agent by hand. See `.claude/docs/design-v2.md`.

```ts
interface Recipe {
  discover(ctx): Promise<RaceRef[]>;          // the race pages the site lists now
  snapshot(ref, ctx): Promise<Snapshot>;      // what to read for one race
}
```

A `Snapshot` has:

- `pages`: the **relevant HTML** of each page (`cleanContent`). This is what gets read and fingerprinted, so leave out anything that changes without the race changing: menus of other races, news, counters.
- `priceImages`: images that may hold the price table, best first. They are OCR'd only if the pages give no prices, unless `priceImagesCertain` is set.
- `facts`: anything the site states in structured form (an API, a page title), read for free and trusted over the model.
- `links`: outbound links with their text, classified later against `config/sites.yaml`.
- `hints`: series and organizer, usually from the site's entry in `config/sites.yaml`.

## Which recipe

| Recipe | Site | How it reads |
| --- | --- | --- |
| `actiup` | actiup.net | Public API: listing (30 per request) and event detail, with `Accept-Language: vi`. The price section's images are OCR'd |
| `vnexpress-marathon` | vm.vnexpress.net | Hub: races at `/<city>-<year>`. The banner (`#slideshow`), the ticket table (`.ticket-policy`), and `/<slug>/thong-tin-cuoc-dua` (venue, when it exists) are read |
| `irace` | ticket.irace.vn, irace.vn | Seller: `ticket.irace.vn` races on sale now, listed on the home page — `#personal`'s price table is real HTML, no OCR. Falls back to `#bang-gia`'s table once registration closes. `irace.vn/su-kien/<slug>` (the older WordPress site) is never discovered, only added by hand — its `.eventon_desc_in` container has the same kind of text price table. Both shapes share one column-per-tier, row-per-distance layout, so `parsePriceTable` (this file's `irace.ts`) drafts `read.json`'s `prices` from it for agent-read (plan 010) — still checked by eye, not trusted blind |
| `default` | any race's own site | Home page plus up to 6 subpages that look like fees, distances, race info or registration. Images named like a price table |

## Adding a site

1. Add it to `config/sites.yaml` with `recipe: default`.
2. `npm run check -- --site <key> --free --dry-run`: free. It shows which pages and images would be read, and the most it would cost.
3. If the picks look wrong, give the site its own recipe (a file here, registered in `index.ts`). Test it against saved pages in `test/fixtures/` (see `test/recipes.test.ts`).
4. Do one paid check: `npm run check -- --site <key> --dry-run --preview /tmp/x`. Compare every price with the page or image **by eye**.
5. Save the source as `test/fixtures/read-<race>.json` and add its checked prices to `test/answers.test.ts`.

## Lessons from the first sites (2026-09-24)

- **Text often mentions fees that aren't entry fees** (photos, VIP upgrades, transfers, change deadlines). The model reads them as tiers, so a price table read from an image wins over prices taken from text, and images with unmistakable names are always read.
- **Posters leave out the year** ("24 JUN – 16 JUL"). The model may invent one. Normalization works it out again from race day.
- **Prices can depend on the runner** (HCMC Marathon: Resident / Non-resident). Each tier has an `audience`.
- **Image names can be mangled** (ActiUp: "giải thưởng", prizes, folds to "giai", close to "gia"). Prefer the page structure (a section title) over names.

## Lessons from the first ActiUp batch (2026-09-24)

- **The model tags prices with an audience that isn't there** (every Sơn Trà price "Resident"; every Bắc Ninh price repeated for Resident and Non-resident). An audience is kept only when the same distance and tier kind has different resident and non-resident prices.
- **It computes group prices from percentages** ("Nhóm 10-29: 5%"), and gets them wrong. Printed VND prices are round thousands, so a read whose group prices aren't loses its group prices.
- **Volume/group discounts are out of scope even when actually printed** (Lý Sơn Cross Island 2026: "Group 20-39: giảm 10%" printed *with* the resulting VND amount next to it, e.g. 1,436,500đ — not computed, genuinely on the poster). We still don't want it: it's a discount off whichever tier is currently active, not the race's own fixed price for a product, so it goes stale the moment the active tier changes and doesn't fit the tier model (one fixed price, one fixed date range). `dropComputedGroupPrices` drops these as a side effect of the percentage-guard above; that's correct even on the rare read where the amount is genuinely printed, not just when it's computed. Don't "fix" this by hand-adding the dropped tier via `edit -- set prices` after verifying it against the image — the value itself is what's unwanted, not just the way it was read.
- **Combos and relay teams come back as the distance or audience** ("COMBO 1 (MUA 2 VÉ TICKETS)", "TIẾP SỨC (RELAY TEAM)"). They're kept in the tier label, as kind `group`, so they aren't taken for a single entry.
- **Dates ending on race day were copied from it** (Bắc Ninh: a poster with no dates read as "07/07 - 10/01"): both ends are dropped.
- **Posters print impossible days** ("31/11/2026"): the month's last day.
- **Busy images can shift rows** (Vũng Tàu City Trail: each distance got the next row's prices, and a slogan, "GIANTS", became a tier). No rule catches that, and the prompt now says to read rows straight across, but a re-read shifted them again. Such a race gets its prices by hand (`npm run edit -- set <race> prices …`).

## Lessons from backfilling plan 008's gaps (2026-09-26)

- **A hub or seller page can genuinely have nothing, and the fix is to look for another page on the same site, not another site.** `vm.vnexpress.net`'s race page has no venue at all — it's on a separate `/<slug>/thong-tin-cuoc-dua` page the recipe never fetched. Found by noticing the official page really had zero venue text anywhere, not by guessing there'd be a subpage.
- **A CSS id isn't a stable thing to select on — the site's own broken markup can eat it.** `ticket.irace.vn`'s closed-registration price table sits inside `<div id="bang-gia">`, but the page's own `<h2 class="card-header">Bảng giá</h4>` (mismatched closing tag) breaks the parser badly enough that it drops the `id` while recovering. The fix that survives this: select on **content shape** (a `<table>` whose text has a real `đ` amount), not on the id, and prefer that over a same-page id whenever one broken tag could take the id down with it.
- **The same seller can have two unrelated domains with different markup and different price formats**, one of them off the books entirely. `irace.vn/su-kien/<slug>` (an older WordPress/EventON-plugin site) isn't `ticket.irace.vn` — different HTML, different selectors (`.eventon_desc_in` vs. `.name`/`.wrap-info`/`#personal`) — and it's never crawled, only reachable by a human finding the URL directly (a plain web search worked both times this session). Its price table turned out to be text both times checked, not the images an earlier note assumed; that assumption doesn't hold race to race.
- **Two sources can genuinely disagree without one being wrong.** ActiUp gave Global Gate Hạ Long ESG Marathon a 2-day span (2026-10-10 → 2026-10-11); irace.vn's page names only the race day itself (11th), which is the end of that span, not a contradiction. `sync.ts` still flags it (`⚠️ sources disagree on race day`) since it only compares single dates — worth reading the flag against both sources before assuming a real conflict, since here it wasn't one.
- **A seller's own title can be different enough from the official name that automatic matching misses the same race on the same day.** `techcombank-ha-noi-marathon`'s irace.vn title ("Techcombank Hanoi International Marathon 2026") scored 0.575 against the official Vietnamese name ("Giải Marathon Quốc tế Hà Nội Techcombank Mùa thứ 5") in `nameSimilarity`, under the 0.65 `MATCH_THRESHOLD` — and briefly created a duplicate race before being caught and merged by hand. See plan 010 for the process fix; until it's built, **read the dry run's `+` (new race) vs. `~` (merged) lines carefully** for any race added via a direct `--race <url>`, especially one whose title reads very differently from the name already on file.
- **`syncToGitHub`'s `--commit` reads current state from the GitHub API, not local files.** A local hand-edit to `data/index.json` meant to steer a merge (adding a URL to an existing entry's `sourceUrls` before running `commit --commit`) has no effect — the real commit path never sees it. A merge fix made after the fact has to be its own commit (edit the race file's `sources[]` and `index.json` together, then `npm run renormalize -- --commit` to recompute derived fields), not a pre-emptive local edit.
- **A genuinely free race (no fee, so no price image to OCR) used to leave `prices: []`, indistinguishable from "not read yet."** ActiUp's own API says this directly (`result.price_type === "free"`, `min_price: 0`); this is a source fact, not a guess, so `actiup.ts` now turns it into a real tier (`{tier: "Miễn phí", price: 0}`) in `facts.prices`, the same as `min_price` was already kept as `fromPrice`. `min_price === 0` alone is **not** enough — some races have `min_price: 0` with `price_type` unset/other (bidv-run-2025, together-we-step-step-for-kindness), meaning ActiUp itself doesn't know the fee, not that it's free; only `price_type === "free"` counts. Found 2026-09-27 via `mini-game-kun-fun-run-dong-thap-2026` showing as "missing pricing" when ActiUp clearly listed it as free; a repo-wide check found 10 more races with the same gap (`facts.fromPrice === 0` but `race.prices` empty), all re-read and fixed via `agent-read` (free — no Firecrawl needed, ActiUp's API and the free tier are both known without OCR).

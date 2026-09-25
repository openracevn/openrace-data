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
| `vnexpress-marathon` | vm.vnexpress.net | Hub: races at `/<city>-<year>`. Only the banner (`#slideshow`) and the ticket table (`.ticket-policy`) are read |
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

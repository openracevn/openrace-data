# Plan 009: prefer ticket.irace.vn as a price source

## Roadmap fit

Serves path step 1 ("Trusted data. Any source (sellers, hubs, race sites), recipes,
agent-read, price tiers...") and trust principle 5 ("We learn how organizers publish...
studied first, then read with a recipe and a saved test page"). It also helps the
budget constraint rather than hurting it: reading `ticket.irace.vn`'s HTML price table
avoids Firecrawl image-OCR credits that ActiUp/`irace.vn` currently need. No tension
with any trust principle, constraint or non-goal.

## Why

The user pointed out `https://ticket.irace.vn/` as an underused source: ActiUp and the
existing `irace.vn/su-kien/<slug>` pages carry prices only as **images** (Firecrawl OCR
cost, or an agent reading images by hand). `ticket.irace.vn/<slug>` (e.g.
`lamdong-trail-2026`) has the same price tiers as a real **HTML table** — text, no OCR
needed — plus name/date/venue as text.

Verified by fetch:
- `irace.vn/su-kien/lam-dong-trail`: prices are images (`Bang-Gia-ve-scaled.jpg`,
  `Cs-ve-nhom.jpg`), same pattern as ActiUp.
- `ticket.irace.vn/lamdong-trail-2026`: prices in an HTML table (Early Bird/Regular/Late
  tiers per distance), server-rendered (`curl -A 'Mozilla/5.0'` returns full HTML with
  real race links, e.g. `vung-tau-city-trail-2026`, `trang-an-marathon-2026`, ...) — so a
  recipe can read it without a headless browser. Worth checking `ticket.irace.vn/api`
  for a cleaner JSON listing before scraping the homepage HTML for `discover()`.
- `config/sites.yaml` already lists `irace` (`kind: seller`, `hosts: [irace.vn,
  ticket.irace.vn]`) but `recipe: none` — never read automatically today. The `irace`
  sources already in `data/races/*.json` (e.g. `lamdong-trail-2026`) point at
  `ticket.irace.vn` but were added **by hand** (`edit -- set prices`), not via a recipe.
- Existing `irace` sources use `role: "reference"`. Since `kind: seller` is already set
  in `sites.yaml`, the source role should match: `role: "seller"`, same as ActiUp
  (prices already merge in under either role per `reconcile.ts:83`, but the role should
  reflect what the site actually is).

## Decisions made (this conversation)

- Build a real recipe, not just a doc/skill update: `ticket.irace.vn` becomes an
  automatically-read source, preferred over ActiUp/`irace.vn` images when available.
- Fix `irace`'s source role to `"seller"` while doing this.
- Do this before the cross-repo series/organizer sort work (plan 004 in openrace-web).

## Changes

- `scripts/lib/recipes/irace.ts` (new):
  - `discover()`: list races from `ticket.irace.vn` (check `/api` first for JSON; fall
    back to parsing homepage links like `default.ts`'s subpage picker does).
  - `snapshot(ref)`: fetch `ticket.irace.vn/<slug>`, keep the cleaned HTML (already has
    the price table as text) as the main page. No price images needed for this site.
  - Register in `scripts/lib/recipes/index.ts`.
- `config/sites.yaml`: `irace` entry — `recipe: none` → `recipe: irace`;
  `check: manual` → a real cadence (e.g. `weekly`, matching ActiUp).
- Existing `irace` sources in `data/races/*.json`: change `role` from `"reference"` to
  `"seller"` (a data fix, separate from the recipe code).
- Tests: a saved fixture in `test/fixtures/`, a case in `test/recipes.test.ts`, and one
  paid check compared by eye added to `test/answers.test.ts` (per
  `scripts/lib/recipes/README.md`'s "Adding a site" steps 3-5).
- `scripts/lib/recipes/README.md`: add `irace` to the recipe table; note it's
  text-table-based (no OCR, cheaper than ActiUp).
- `.claude/skills/agent-read/SKILL.md`: note that when a race has (or can get) a
  `ticket.irace.vn` page, read its price table as text instead of OCR'ing
  ActiUp/`irace.vn` images.
- `.claude/skills/check-race/SKILL.md` step 2: add a `ticket.irace.vn` bullet alongside
  the ActiUp one, marked as preferred when available (free, no image cost).

## Open questions

- None blocking — `ticket.irace.vn/api` should be checked first during implementation
  in case it offers a cleaner JSON listing than scraping homepage HTML.

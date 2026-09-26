/**
 * ticket.irace.vn, iRace's own ticket seller, plus its older sibling irace.vn
 * (`irace.vn/su-kien/<slug>`, a WordPress events calendar plugin) when a race is only
 * listed there. Verified 2026-09-26:
 *
 * - The home page lists the races on sale now (~25), as `<a class="card-title">`
 *   links to `ticket.irace.vn/<slug>`. There's no listing API and the home page has
 *   no "next page"; `/categories/<slug>` pages paginate further back, including past
 *   editions, but that's out of scope here — ActiUp already discovers new races,
 *   iRace is read mainly to re-check races we already track. `ctx.includePast` has
 *   no effect: the home page never lists a race that's over.
 * - `irace.vn/su-kien/<slug>` is never discovered (no crawl of it exists), only added
 *   by hand (`--race <url>`) once a human finds one, e.g. because the race's only
 *   other source (ActiUp, an official site) has no price and doesn't link out to it.
 *   Its slug doesn't have to match the `ticket.irace.vn` one for the same race (seen:
 *   `global-gate-ha-long-esg-marathon` vs. `-esg-marathon-2026`); `sync.ts` merges them
 *   by name/date like any other new source. Two races checked so far (2026-09-26,
 *   techcombank-ha-noi-marathon, global-gate-ha-long-esg-marathon) both had name,
 *   distances, date and the price table as a real HTML table under a "Bảng giá vé"
 *   heading, all inside one clean container (`.eventon_desc_in`, see below) — not
 *   images, unlike an earlier note in plan 009 for lam-dong-trail, so the format may
 *   vary by race; an image-only one isn't handled yet (no price images are offered
 *   here) and will fail loudly (no table found) rather than silently, until that's
 *   built.
 * - A race page (`ticket.irace.vn/<slug>`) has:
 *   - `.name` (h1) and `.wrap-info` (date range + venue) as text.
 *   - `#personal`: the individual entry-fee table (Early Bird / Regular / Late ×
 *     distance) as a real HTML table, no OCR needed — unlike ActiUp/irace.vn's price
 *     images, the reason this recipe exists.
 *   - `#group`: group-size discounts as percentages, not prices — out of scope (see
 *     recipes/README.md's ActiUp lessons).
 *   - `#bang-gia`: normally reproduces the same old irace.vn poster images ActiUp
 *     OCRs, skipped while `#personal` is there since it already gives the same
 *     prices as text. But once a race's registration closes (checked 2026-09-26,
 *     VnExpress Marathon Grand Tour Nghệ An 2026, one day before race day),
 *     `#personal` disappears and `#bang-gia` becomes the only price table left, this
 *     time as a real HTML table, not images. Its wrapping `<div id="bang-gia">` is
 *     itself unreadable there (the page's `<h2 class="card-header">Bảng giá</h4>`
 *     mismatches tags, and the parser drops the id fixing it up), so the fallback
 *     looks for the `<table>` itself, wherever it lands — skipping an unrelated
 *     empty cart-summary table the same page also has.
 *   - a `script[type=application/ld+json]` schema.org Event block: name, venue
 *     (`location.name`) and organizer (name + a `/organizers/<slug>` url), read as
 *     free facts. Its `startDate`/`endDate` are unreliable for multi-day races (both
 *     equal the first day), so date is left to the page text like every other recipe.
 *     `irace.vn` has the same block, but `location`/`organizer` are arrays there
 *     (`[{...}]`), not a single object, and `organizer.url` is the organizer's own
 *     site, not an `/organizers/<slug>` page, so no organizer hint comes from it.
 */
import { cleanContent, pageLinks, parseHtml } from "../html.ts";
import { hostOf } from "../sites.ts";
import { str } from "../text.ts";
import { externalLinks } from "./default.ts";
import type { RaceRef, Recipe, RecipeContext, Snapshot } from "./types.ts";

const RACE_PAGE = /^https:\/\/(?:ticket\.irace\.vn\/([a-z0-9-]+)|irace\.vn\/su-kien\/([a-z0-9-]+))\/?$/;
// Site paths that look like a slug but aren't a race: account/category/organizer pages.
const NOT_A_RACE = /^(tickets|my-account|categories|organizers|api|embed|add-event-to-calendar)$/;
const CONTENT = [".name", ".wrap-info", "#personal"];
// irace.vn (EventON, a WordPress events-calendar plugin): the one clean container with
// the event's own description, distances, date and price table as normal rendered
// HTML — everything above it on the page is either chrome or a second, broken copy of
// the same text (JSON-embedded, with mismatched tags of its own).
const LEGACY_DESC = ".eventon_desc_in";
// A price amount ("340.000đ"), to tell a real price table apart from an unrelated one
// the same page has (ticket.irace.vn's empty cart-summary table: headers, no đ amounts).
const PRICE_AMOUNT = /\d[\d.,]*\s*đ(?!\p{L})/u;

type EventLdPlace = { name?: string };
type EventLdOrganizer = { name?: string; url?: string };
type EventLd = {
  "@type"?: string;
  name?: string;
  // A single object on ticket.irace.vn, an array of one on irace.vn.
  location?: EventLdPlace | EventLdPlace[];
  organizer?: EventLdOrganizer | EventLdOrganizer[];
};
const first = <T>(v: T | T[] | undefined): T | undefined => (Array.isArray(v) ? v[0] : v);

export const iraceRecipe: Recipe = {
  async discover(ctx: RecipeContext): Promise<RaceRef[]> {
    const url = ctx.site.url;
    const root = parseHtml(await ctx.http.text(url));
    const refs = new Map<string, RaceRef>();
    for (const a of root.querySelectorAll("a.card-title")) {
      const href = a.getAttribute("href");
      const m = href?.match(RACE_PAGE);
      const slug = m?.[1] ?? m?.[2];
      if (!slug || NOT_A_RACE.test(slug)) continue;
      const name = a.textContent.replace(/\s+/g, " ").trim();
      refs.set(slug, { url: href!, name: name || undefined, slugHint: slug });
    }
    if (refs.size === 0) throw new Error("no race cards on the iRace ticket home page (layout changed?)");
    return [...refs.values()];
  },

  async snapshot(ref: RaceRef, ctx: RecipeContext): Promise<Snapshot> {
    const html = await ctx.http.text(ref.url);
    const root = parseHtml(html);
    const legacyDesc = hostOf(ref.url) === "irace.vn" ? root.querySelector(LEGACY_DESC) : null;
    let parts = legacyDesc ? [legacyDesc] : CONTENT.map((sel) => root.querySelector(sel)).filter((el) => el !== null);
    if (!legacyDesc && !root.querySelector("#personal")) {
      parts.push(...root.querySelectorAll("table").filter((t) => PRICE_AMOUNT.test(t.textContent)));
    }
    if (parts.length === 0) throw new Error(`${ref.url}: no ${[...CONTENT, LEGACY_DESC].join(" or ")} (layout changed?)`);
    const content = parseHtml(`<main>${parts.map((el) => el.outerHTML).join("")}</main>`);

    const event = readEventLd(html);
    const venue = str(first(event?.location)?.name);
    const organizer = first(event?.organizer);
    const organizerName = str(organizer?.name);
    const organizerSlug = organizer?.url?.match(/\/organizers\/([a-z0-9-]+)/)?.[1];

    const m = ref.url.match(RACE_PAGE);
    return {
      url: ref.url,
      pages: [{ url: ref.url, html: cleanContent(content, ref.url) }],
      priceImages: [], // Read so far always had the price table as text; no image is ever offered for OCR.
      links: externalLinks(pageLinks(root, ref.url), hostOf(ref.url)),
      facts: {
        ...(str(event?.name) && { name: event!.name }),
        ...(venue && { venue }),
        ...(organizerName && { organizer: organizerName }),
      },
      hints: organizerName && organizerSlug ? { organizer: { id: organizerSlug, name: organizerName } } : {},
      slugHint: ref.slugHint ?? m?.[1] ?? m?.[2],
    };
  },
};

// parseHtml drops script bodies (html.ts's blockTextElements turns off "raw text"
// for <script> so cleanContent can safely ignore it), so the JSON-LD is read
// straight off the fetched HTML instead of the parsed tree.
const LD_JSON = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function readEventLd(html: string): EventLd | null {
  for (const m of html.matchAll(LD_JSON)) {
    try {
      const data = JSON.parse(m[1]!);
      if (data?.["@type"] === "Event") return data as EventLd;
    } catch {
      continue;
    }
  }
  return null;
}

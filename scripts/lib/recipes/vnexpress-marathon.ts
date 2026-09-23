/**
 * VnExpress Marathon (vm.vnexpress.net), a hub: about 15 races a year, each at
 * /<city>-<year> (ha-noi-2026, can-gio-2026, ...), past editions back to 2020 in the
 * site menu. Checked 2026-09-24:
 *
 * - The race page's banner (#slideshow) has the name, race day and organizers; the
 *   ticket section (.ticket-policy) has the price table as text: tiers with dates
 *   × distances, then a group-discount table. No OCR needed.
 * - Every page starts with a menu of all editions; it changes whenever a race is
 *   added, so only the banner and the ticket section are read (and fingerprinted).
 */
import { absoluteUrl, cleanContent, pageImages, pageLinks, parseHtml } from "../html.ts";
import { slugFromName } from "../slug.ts";
import { externalLinks, pickPriceImages } from "./default.ts";
import type { RaceRef, Recipe, RecipeContext, Snapshot } from "./types.ts";

const RACE_PAGE = /^https:\/\/vm\.vnexpress\.net\/([a-z0-9-]+)-(20\d\d)\/?$/;
const CONTENT = ["#slideshow", ".ticket-policy"];

export const vnexpressMarathonRecipe: Recipe = {
  async discover(ctx: RecipeContext): Promise<RaceRef[]> {
    const url = ctx.site.url;
    const root = parseHtml(await ctx.http.text(url));
    const refs = new Map<string, RaceRef>();
    const thisYear = Number(ctx.today.slice(0, 4));
    for (const a of root.querySelectorAll("a[href]")) {
      const link = absoluteUrl(a.getAttribute("href"), url);
      const m = link?.match(RACE_PAGE);
      if (!link || !m) continue;
      if (!ctx.includePast && Number(m[2]) < thisYear) continue;
      const clean = link.replace(/\/$/, "");
      // The menu names each race ("Hà Nội 2026"); used for its series name.
      const text = a.textContent.replace(/\s+/g, " ").trim();
      const seen = refs.get(clean);
      if (!seen || (!seen.name && text)) refs.set(clean, { url: clean, name: text || undefined, slugHint: `vnexpress-marathon-${m[1]}` });
    }
    if (refs.size === 0) throw new Error("no race pages linked from the VnExpress Marathon home page (layout changed?)");
    return [...refs.values()];
  },

  async snapshot(ref: RaceRef, ctx: RecipeContext): Promise<Snapshot> {
    const root = parseHtml(await ctx.http.text(ref.url));
    const parts = CONTENT.map((sel) => root.querySelector(sel)).filter((el) => el !== null);
    if (parts.length === 0) throw new Error(`${ref.url}: no ${CONTENT.join(" or ")} (layout changed?)`);
    const content = parseHtml(`<main>${parts.map((el) => el.outerHTML).join("")}</main>`);

    const m = ref.url.match(RACE_PAGE);
    const place = ref.name?.replace(/\s*20\d\d\s*$/, "").trim();
    const series = m && place ? { id: `vnexpress-marathon-${m[1]}`, name: `VnExpress Marathon ${place}` } : undefined;
    return {
      url: ref.url,
      pages: [{ url: ref.url, html: cleanContent(content, ref.url) }],
      priceImages: pickPriceImages(pageImages(content, ref.url)),
      links: externalLinks(pageLinks(content, ref.url), "vm.vnexpress.net"),
      hints: { series, organizer: ctx.site.organizer },
      slugHint: ref.slugHint ?? (place ? slugFromName(`vnexpress-marathon-${place}`) : undefined),
    };
  },
};

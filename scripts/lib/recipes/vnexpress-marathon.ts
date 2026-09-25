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
import { normalizeDate } from "../extraction.ts";
import { absoluteUrl, cleanContent, pageImages, pageLinks, parseHtml } from "../html.ts";
import { str } from "../text.ts";
import { externalLinks, pickPriceImages } from "./default.ts";
import type { RaceRef, Recipe, RecipeContext, Snapshot } from "./types.ts";

const RACE_PAGE = /^https:\/\/vm\.vnexpress\.net\/([a-z0-9-]+)-(20\d\d)\/?$/;
const CONTENT = ["#slideshow", ".ticket-policy"];

// A branded edition's slug prefixes the city with a sponsor name (long-chau-can-tho):
// the banner then names the sponsor, not the city, and .ticket-policy may not exist
// yet, so the city has nowhere else to come from. Slugs seen so far (2026-09-25).
const CITY_SLUGS: Record<string, string> = {
  "can-tho": "Cần Thơ",
  "ha-noi": "Hà Nội",
  "hai-phong": "Hải Phòng",
  "da-nang": "Đà Nẵng",
  "ha-long": "Hạ Long",
  "ho-chi-minh": "Hồ Chí Minh",
  hue: "Huế",
  "nha-trang": "Nha Trang",
  "nghe-an": "Nghệ An",
  "quy-nhon": "Quy Nhơn",
  "vung-tau": "Vũng Tàu",
  "can-gio": "Cần Giờ",
};

/** The city a race's slug names, matching the longest known city slug it ends with. */
function cityFromSlug(slug: string): string | undefined {
  const key = Object.keys(CITY_SLUGS)
    .sort((a, b) => b.length - a.length)
    .find((k) => slug === k || slug.endsWith(`-${k}`));
  return key && CITY_SLUGS[key];
}

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
    // The menu on every page names each race ("Hà Nội 2026"): the series is the place.
    const menuName =
      ref.name ??
      root
        .querySelectorAll("a[href]")
        .find((a) => absoluteUrl(a.getAttribute("href"), ref.url)?.replace(/\/$/, "") === ref.url && /20\d\d\s*$/.test(a.textContent.trim()))
        ?.textContent;
    const place = menuName?.replace(/\s+/g, " ").replace(/\s*20\d\d\s*$/, "").trim();
    const series = m && place ? { id: `vnexpress-marathon-${m[1]}`, name: `VnExpress Marathon ${place}` } : undefined;
    // Free facts: the full name is the page title ("VnExpress Marathon Hanoi Midnight
    // 2026"; the banner text alone drops the brand), race day is in the banner.
    const name = str(root.querySelector("title")?.textContent);
    const day = content.textContent.match(/NGÀY THI ĐẤU:?\s*(\d{1,2}\/\d{1,2}\/20\d\d)/i)?.[1];
    const city = m?.[1] && cityFromSlug(m[1]);
    return {
      url: ref.url,
      pages: [{ url: ref.url, html: cleanContent(content, ref.url) }],
      priceImages: pickPriceImages(pageImages(content, ref.url)),
      links: externalLinks(pageLinks(content, ref.url), "vm.vnexpress.net"),
      facts: { ...(name && { name }), ...(day && { date: normalizeDate(day) }), ...(city && { city }) },
      hints: { series, organizer: ctx.site.organizer },
      slugHint: ref.slugHint ?? (m ? `vnexpress-marathon-${m[1]}` : undefined),
    };
  },
};

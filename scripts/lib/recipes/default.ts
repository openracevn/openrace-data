/**
 * The generic recipe for a race's own site (kind: race-site). The site is one race:
 * its current edition. Reads the home page plus the pages it links to that look
 * like race info, distances, fees or registration (e.g. hcmcmarathon.com/21km/), and
 * offers the images whose name or alt text looks like a price table for OCR.
 */
import { cleanContent, imageKey, imageName, pageImages, pageLinks, parseHtml, type PageImage, type PageLink } from "../html.ts";
import { hostOf } from "../sites.ts";
import { canonicalSourceUrl } from "../slug.ts";
import { foldVietnamese } from "../text.ts";
import type { RaceRef, Recipe, RecipeContext, Snapshot } from "./types.ts";

/** Subpages worth reading, best first: prices and distances before general info. */
const SUBPAGE_RULES: [RegExp, number][] = [
  [/\b(bang gia|gia ve|le phi|phi dang ky|registration fee|entry fee|fee|price|pricing)\b/, 5],
  [/\b(cu ly|\d+ ?km|\d+k|distance|half marathon|full marathon|marathon 42|ultra)\b/, 4],
  [/\b(thong tin cuoc dua|race info|thong tin giai|about the race|gioi thieu giai)\b/, 3],
  [/\b(dang ky|register|registration|mua ve|ticket)\b/, 2],
];
const NOT_A_SUBPAGE = /\/(feed|wp-json|wp-admin|wp-login|tag|category|author|comments?|page\/\d+|20\d\d\/\d\d(\/|$))|\/(cart|checkout|my-account|gio-hang|dang-nhap|login|lien-he|contact)(\/|$)|\.(pdf|jpe?g|png|webp|zip|docx?)$/i;
const MAX_SUBPAGES = 6;

/** Image names or alt texts that suggest a price table or poster. */
export const PRICE_IMAGE = /\b(bang gia|gia ve|gia|price|pricing|fee|le phi|early|eb|seb|late|regular|ticket|ve)\b/;
/** Names that leave no doubt ("HM27-FEE_EN_21KM", "BANG-GIA-EB-HBHM"): read even when the text seems to have prices. */
export const PRICE_TABLE_IMAGE = /\b(bang gia|gia ve|price|pricing|fee|le phi|phi dang ky)\b/;
const MAX_PRICE_IMAGES = 6;

export const defaultRecipe: Recipe = {
  async discover(ctx: RecipeContext): Promise<RaceRef[]> {
    return [{ url: canonicalSourceUrl(ctx.site.url) }];
  },

  async snapshot(ref: RaceRef, ctx: RecipeContext): Promise<Snapshot> {
    const home = parseHtml(await ctx.http.text(ref.url));
    const host = hostOf(ref.url);
    const homeLinks = pageLinks(home, ref.url);
    const subpages = pickSubpages(homeLinks, host, ref.url);

    const pages = [{ url: ref.url, html: cleanContent(home, ref.url) }];
    const images: PageImage[] = pageImages(home, ref.url);
    const links: PageLink[] = [...homeLinks];
    for (const url of subpages) {
      let root;
      try {
        root = parseHtml(await ctx.http.text(url));
      } catch {
        continue; // a broken subpage shouldn't sink the race
      }
      pages.push({ url, html: cleanContent(root, url) });
      images.push(...pageImages(root, url));
      links.push(...pageLinks(root, url));
    }

    const priceImages = pickPriceImages(images);
    return {
      url: ref.url,
      pages: pages.filter((p) => p.html.length > 0),
      priceImages,
      // Text often mentions other fees (photos, VIP, transfers) the model mistakes for entry fees.
      priceImagesCertain: priceImages.some((u) => PRICE_TABLE_IMAGE.test(imageName(u))),
      links: externalLinks(links, host),
      hints: { series: ctx.site.series, organizer: ctx.site.organizer },
      slugHint: ref.slugHint,
    };
  },
};

/** Same-site pages linked from the home page that look like race info, best first. */
export function pickSubpages(links: PageLink[], host: string, homeUrl: string): string[] {
  const scored: { url: string; score: number }[] = [];
  const seen = new Set<string>([canonicalSourceUrl(homeUrl)]);
  for (const { url, text } of links) {
    let canonical: string;
    try {
      if (hostOf(url) !== host) continue;
      canonical = canonicalSourceUrl(url);
    } catch {
      continue;
    }
    if (seen.has(canonical) || NOT_A_SUBPAGE.test(new URL(url).pathname)) continue;
    const words = `${text} ${foldVietnamese(decodeURIComponent(new URL(url).pathname))}`;
    const score = Math.max(0, ...SUBPAGE_RULES.map(([re, s]) => (re.test(words) ? s : 0)));
    if (score === 0) continue;
    seen.add(canonical);
    scored.push({ url, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUBPAGES)
    .map((s) => s.url);
}

/** Images whose file name or alt text looks like prices, deduped across sizes; unmistakable price tables first. */
export function pickPriceImages(images: PageImage[]): string[] {
  const out = new Map<string, { url: string; sure: boolean }>();
  for (const { url, alt } of images) {
    const key = imageKey(url);
    if (out.has(key)) continue;
    const words = `${imageName(url)} ${foldVietnamese(alt)}`;
    if (PRICE_IMAGE.test(words)) out.set(key, { url, sure: PRICE_TABLE_IMAGE.test(words) });
  }
  return [...out.values()]
    .sort((a, b) => Number(b.sure) - Number(a.sure))
    .map((i) => i.url)
    .slice(0, MAX_PRICE_IMAGES);
}

/** Links to other sites, deduped, for classification (sellers, Facebook, rules, ...). */
export function externalLinks(links: PageLink[], host: string): PageLink[] {
  const out = new Map<string, PageLink>();
  for (const l of links) {
    try {
      if (hostOf(l.url) === host) continue;
    } catch {
      continue;
    }
    if (!out.has(l.url)) out.set(l.url, l);
  }
  return [...out.values()];
}

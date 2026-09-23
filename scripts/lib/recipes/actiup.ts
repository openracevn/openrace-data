/**
 * ActiUp (actiup.net), the main source of new races. Everything comes from its
 * public API, no page rendering (verified 2026-09-24; undocumented, could change):
 *
 * - Listing: GET /v2/content/events/paging?event_type=sports&limit=30&offset=N
 *   `limit` is capped at 30, `offset` counts items, results are not sorted by date.
 * - Event:   GET /v2/content/events/slug/<slug>
 *   name, start/end date, place, organizer (merchant_public_name), sale status, and
 *   the description as titled sections ("Chính sách giá vé", "Thông tin Race-kit", ...).
 *
 * Both answer in English unless asked for Vietnamese (Accept-Language: vi).
 * Prices are usually an image in the price section, so that image is what gets OCR'd.
 */
import { cleanContent, imageKey, imageName, pageImages, pageLinks, parseHtml } from "../html.ts";
import { slugFromName } from "../slug.ts";
import { foldVietnamese, str } from "../text.ts";
import { PRICE_IMAGE, externalLinks } from "./default.ts";
import type { RaceRef, Recipe, RecipeContext, Snapshot } from "./types.ts";

const API = "https://api.actiup.net/v2/content/events";
const VI = { "Accept-Language": "vi" };
const PAGE_SIZE = 30;
const MAX_PAGES = 40; // 1,200 events; the listing had 301 on 2026-09-24

type ListItem = { event_slug: string; name: string; start_date: string; end_date?: string };
type Listing = { result?: { paging?: { total_item?: number }; data?: ListItem[] } };
type Detail = {
  result?: {
    event_slug: string;
    name: string;
    start_date: string;
    end_date?: string;
    place?: string;
    short_place?: string;
    merchant_public_name?: string;
    currency?: string;
    selling_type?: string;
    close_registration_date?: string;
    min_price?: number;
    event_type?: string;
    details?: { title: string; description: string }[];
  };
};

export function eventUrl(slug: string): string {
  return `https://actiup.net/vi/event/${slug}`;
}

export const actiupRecipe: Recipe = {
  async discover(ctx: RecipeContext): Promise<RaceRef[]> {
    const refs = new Map<string, RaceRef>();
    let total = Number.POSITIVE_INFINITY;
    for (let page = 0; page < MAX_PAGES && page * PAGE_SIZE < total; page++) {
      const url = `${API}/paging?event_type=sports&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&price=&selling_type=&category_id=&event_time=`;
      const res = await ctx.http.json<Listing>(url, VI);
      const items = res.result?.data ?? [];
      total = res.result?.paging?.total_item ?? 0;
      if (items.length === 0) break;
      for (const item of items) {
        const date = item.start_date?.slice(0, 10);
        const last = (item.end_date ?? item.start_date)?.slice(0, 10);
        if (!item.event_slug || (!ctx.includePast && last && last < ctx.today)) continue;
        refs.set(item.event_slug, { url: eventUrl(item.event_slug), date, name: item.name, slugHint: item.event_slug });
      }
    }
    if (refs.size === 0 && total === 0) throw new Error("ActiUp listing returned no events (API changed?)");
    return [...refs.values()];
  },

  async snapshot(ref: RaceRef, ctx: RecipeContext): Promise<Snapshot> {
    const slug = ref.slugHint ?? new URL(ref.url).pathname.split("/")[3] ?? "";
    const res = await ctx.http.json<Detail>(`${API}/slug/${encodeURIComponent(slug)}`, VI);
    const e = res.result;
    if (!e?.name) throw new Error(`ActiUp API has no event "${slug}" (API changed?)`);

    const sections = e.details ?? [];
    // One page: the event's own sections, under their titles.
    const html = sections.map((s) => `<h2>${escape(s.title)}</h2>${s.description ?? ""}`).join("");
    const root = parseHtml(`<main><h1>${escape(e.name)}</h1>${html}</main>`);
    const images = sections.flatMap((s) => pageImages(parseHtml(s.description ?? ""), ref.url).map((i) => ({ ...i, section: foldVietnamese(s.title) })));

    // The price section's images ("Chính sách giá vé", "Bảng giá", "Price Policy");
    // only without one, images named like a price table (names are often mangled:
    // "giải thưởng", prizes, folds to "giai", close to "gia").
    const inPriceSection = images.filter((i) => /\b(gia|price|pricing|fee|le phi|ticket)\b/.test(i.section));
    const named = images.filter((i) => PRICE_IMAGE.test(imageName(i.url)) || PRICE_IMAGE.test(foldVietnamese(i.alt)));
    const priceImages = [...new Map((inPriceSection.length > 0 ? inPriceSection : named).map((i) => [imageKey(i.url), i.url])).values()];

    const organizer = str(e.merchant_public_name);
    const date = e.start_date.slice(0, 10);
    const endDate = e.end_date?.slice(0, 10);
    return {
      url: ref.url,
      pages: [{ url: ref.url, html: cleanContent(root, ref.url) }],
      priceImages,
      // A link's text is often just "Xem tại đây"; its section title says what it is.
      links: externalLinks(
        sections.flatMap((s) => pageLinks(parseHtml(s.description ?? ""), ref.url).map((l) => ({ ...l, text: `${foldVietnamese(s.title)} ${l.text}`.trim() }))),
        "actiup.net",
      ),
      facts: {
        name: e.name,
        date,
        ...(endDate && endDate > date && { endDate }),
        ...(str(e.place) && { venue: str(e.place) }),
        ...(organizer && { organizer }),
        ...(str(e.currency) && { currency: e.currency!.toUpperCase() }),
        ...(registrationStatus(e, ctx.today) && { registrationStatus: registrationStatus(e, ctx.today) }),
        // The "Chỉ từ" (from) price; not a tier, kept for reference.
        ...(typeof e.min_price === "number" && { fromPrice: e.min_price }),
      },
      hints: organizer ? { organizer: { id: slugFromName(organizer), name: organizer } } : {},
      slugHint: e.event_slug,
    };
  },
};

function registrationStatus(e: NonNullable<Detail["result"]>, today: string): string | null {
  if (e.selling_type === "sold_out") return "sold_out";
  if (e.close_registration_date && e.close_registration_date.slice(0, 10) < today) return "closed";
  if (e.selling_type === "selling") return "open";
  return null;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

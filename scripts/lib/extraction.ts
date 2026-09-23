/**
 * What we ask Firecrawl for, and how its answers become race fields.
 *
 * One schema serves every site: Firecrawl's JSON extraction is a model reading the
 * content we hand it (the relevant HTML of a page, or a price image wrapped in a
 * PDF), so site differences live in the recipes, not here. What a source said is
 * stored verbatim as its `extracted` (see SourceExtraction) and normalized on read.
 */
import { MAX_PRICE, MAX_YEARS_AHEAD, MIN_RACE_YEAR, RACE_TYPES, REGISTRATION_STATUSES, isDistance } from "./schema.ts";
import type { RaceType, RegistrationStatus, TierKind } from "./schema.ts";
import { foldVietnamese, str } from "./text.ts";

/** sport = an endurance sports event; non_sport = concert, tour, hotel, conference; none = login, error or empty page. */
export const PAGE_KINDS = ["sport", "non_sport", "none"] as const;

const PRICES_PROPERTY = {
  type: "array",
  description:
    "Every entry fee for one runner: one item per distance and price tier. Leave out group-discount tables, " +
    "add-ons (race photos, VIP upgrades, transfer or change fees, shipping) and merchandise.",
  items: {
    type: "object",
    properties: {
      distance: { type: "string", description: "Distance the price is for, as written (\"21KM\", \"Half Marathon\"). Omit if one price covers all." },
      tier: { type: "string", description: "Tier label as written: \"Super Early Bird\", \"Early Bird\", \"Regular\", \"Giá vé tiêu chuẩn\", \"Late\"..." },
      from: { type: "string", description: "First day of the tier: YYYY-MM-DD when the year is shown, otherwise DD/MM as written." },
      to: { type: "string", description: "Last day of the tier: YYYY-MM-DD when the year is shown, otherwise DD/MM as written." },
      price: { type: "number", description: "Price as a plain number, no separators: \"569.000\" → 569000." },
    },
    required: ["tier", "price"],
  },
} as const;

/** For the relevant HTML of a race page. */
export const PAGE_EXTRACTION = {
  schema: {
    type: "object",
    properties: {
      pageKind: {
        type: "string",
        enum: [...PAGE_KINDS],
        description:
          "sport = an endurance sports event (running, trail, multisport, swimming, cycling). non_sport = concert, tour, attraction, hotel or conference. none = login, error or empty page.",
      },
      types: {
        type: "array",
        items: { type: "string", enum: [...RACE_TYPES] },
        description:
          "Every format this event offers. road_run = road running (fun run, 10K, half, marathon); trail_run = trail or mountain running; " +
          "city_trail = urban trail race through a city; obstacle_run = obstacle course race; triathlon = swim+bike+run; " +
          "duathlon = run+bike+run; aquathlon = swim+run; aquabike = swim+bike; swimrun = alternating swim and run legs; " +
          "swim = swimming only; road_cycle = road cycling; mtb = mountain biking; other = any other sport event.",
      },
      name: { type: "string", description: "Official event name exactly as written. Do not translate it." },
      date: { type: "string", description: "Race day as YYYY-MM-DD. For multi-day events, the first day." },
      endDate: { type: "string", description: "Last race day as YYYY-MM-DD, only for multi-day events." },
      distances: { type: "array", items: { type: "string" }, description: "Race distances offered, as written (\"5km\", \"21KM\", \"Half Marathon\")." },
      venue: { type: "string", description: "Start/finish venue or area, as written." },
      city: { type: "string", description: "City or province where the race takes place, as written." },
      organizer: { type: "string", description: "Organizing company or body, only if named. Never the event name." },
      currency: { type: "string", description: "ISO 4217 code of the prices, usually VND." },
      registrationStatus: {
        type: "string",
        enum: [...REGISTRATION_STATUSES],
        description: "open = can register; closing_soon = ends soon or few slots left; sold_out = all slots taken (hết vé); closed = registration ended.",
      },
      prices: PRICES_PROPERTY,
    },
    required: ["pageKind"],
  },
  prompt:
    "Extract the sports event (running, trail, triathlon, swimming, cycling, ...) described on this race page, usually in Vietnamese. " +
    "Convert dates such as \"21 - 22 tháng 11, 2026\" or \"24/01/2027\" to YYYY-MM-DD. " +
    "If the page shows no event (login, error or empty page), set pageKind to none and omit everything else. " +
    "Only report what the page states; omit fields that are not stated. Never guess.",
} as const;

/** For a price image (poster or table) wrapped in a one-page PDF and OCR'd. */
export const IMAGE_EXTRACTION = {
  schema: {
    type: "object",
    properties: {
      prices: PRICES_PROPERTY,
      distances: { type: "array", items: { type: "string" }, description: "Race distances shown, as written." },
      date: { type: "string", description: "Race day as YYYY-MM-DD, only if the image shows it with a year." },
      currency: { type: "string", description: "ISO 4217 code of the prices, usually VND." },
    },
  },
  prompt:
    "This is an image from a race's page, usually a Vietnamese ticket price table or poster. " +
    "List every entry fee: one item per distance and price tier (columns are often tiers such as Super Early Bird, Early Bird, Regular, Late, each with a date range). " +
    "If the image shows no ticket prices, return an empty prices list. Never guess.",
} as const;

export type Extraction = { schema: Record<string, unknown>; prompt: string };

/**
 * Everything one source said about a race, stored verbatim as the source's `extracted`.
 * facts: read for free from the site's own data (e.g. ActiUp's API), trusted over model output.
 * pages / images: Firecrawl JSON per page read and per price image OCR'd.
 * links: outbound links on the pages, with folded anchor text.
 */
export type SourceExtraction = {
  facts?: Record<string, unknown>;
  pages?: { url: string; json: Record<string, unknown> }[];
  images?: { url: string; json: Record<string, unknown> }[];
  links?: { url: string; text: string }[];
};

export type Tier = { distance: string | null; tier: string; kind: TierKind; price: number; from: string | null; to: string | null };

/** A source's normalized facts about a race. */
export type SourceFacts = {
  name: string;
  types: RaceType[];
  date: string;
  endDate: string | null;
  distances: string[];
  venue: string | null;
  city: string | null;
  organizer: string | null;
  currency: string;
  registrationStatus: RegistrationStatus | null;
  prices: Tier[];
};

export type NormalizeResult = { ok: true; facts: SourceFacts } | { ok: false; reason: string };

// Names that settle a type regardless of what the model says (folded, lowercase).
const TYPE_FROM_NAME: [RegExp, RaceType][] = [
  [/\bcity trail\b/, "city_trail"],
  [/\b(triathlon|ironman|festrival)\b/, "triathlon"],
  [/\bduathlon\b/, "duathlon"],
  [/\baquathlon\b/, "aquathlon"],
  [/\bswimrun\b/, "swimrun"],
];

export function normalizeExtraction(raw: SourceExtraction | Record<string, unknown>): NormalizeResult {
  const x = raw as SourceExtraction;
  const facts = x.facts ?? {};
  const pages = (x.pages ?? []).map((p) => p.json ?? {});
  const images = (x.images ?? []).map((i) => i.json ?? {});

  // A page the model calls a sports event, or the site's own data naming an event.
  const kinds = pages.map((p) => p.pageKind);
  if (kinds.includes("non_sport") && !kinds.includes("sport")) return { ok: false, reason: "not a sports event" };
  if (!kinds.includes("sport") && str(facts.name) === null) {
    return { ok: false, reason: `no event on the page (pageKind: ${JSON.stringify(kinds)})` };
  }

  // Facts first, then each page in order, then images (which rarely carry more than prices).
  const layers = [facts, ...pages, ...images];
  const first = <T>(read: (l: Record<string, unknown>) => T | null): T | null => {
    for (const l of layers) {
      const v = read(l);
      if (v !== null) return v;
    }
    return null;
  };

  const name = first((l) => str(l.name));
  if (!name) return { ok: false, reason: "missing name" };
  const date = first((l) => normalizeDate(l.date));
  if (!date) return { ok: false, reason: `missing or unparseable date: ${JSON.stringify(first((l) => (l.date === undefined ? null : l.date)))}` };
  let endDate = first((l) => normalizeDate(l.endDate));
  if (endDate !== null && endDate <= date) endDate = null;

  const prices = dedupeTiers(layers.flatMap((l) => (Array.isArray(l.prices) ? l.prices : []).map((t) => normalizeTier(t, date)).filter((t) => t !== null)));
  const distances = normalizeDistances([
    ...(first((l) => (Array.isArray(l.distances) && l.distances.length > 0 ? l.distances : null)) ?? []),
    ...prices.map((t) => t.distance).filter((d) => d !== null),
  ]);
  const status = first((l) => str(l.registrationStatus));
  const organizer = first((l) => str(l.organizer));

  return {
    ok: true,
    facts: {
      name,
      types: normalizeTypes(first((l) => (Array.isArray(l.types) && l.types.length > 0 ? l.types : null)), name),
      date,
      endDate,
      distances,
      venue: first((l) => str(l.venue)),
      city: first((l) => str(l.city)),
      // The model sometimes fills the organizer with the event name.
      organizer: organizer && foldVietnamese(organizer) !== foldVietnamese(name) ? organizer : null,
      currency: first((l) => str(l.currency)?.toUpperCase().slice(0, 3) ?? null) ?? "VND",
      registrationStatus: REGISTRATION_STATUSES.includes(status as RegistrationStatus) ? (status as RegistrationStatus) : null,
      prices,
    },
  };
}

// Add-ons that aren't entry fees, even when the model lists them.
const NOT_AN_ENTRY_FEE = /\b(photos?|anh|vip|upgrade|nang cap|transfer|chuyen nhuong|doi cu ly|change|phi quan ly|admin|ship|shipping|van chuyen)\b/;

const TIER_KIND_RULES: [RegExp, TierKind][] = [
  [/\b(super ?early|super eb|seb|sieu som)\b/, "super_early"],
  [/\b(early|eb|som|uu dai som)\b/, "early"],
  [/\b(group|nhom|doan|bibchung)\b/, "group"],
  [/\b(late|last ?call|muon|tre|phut chot|sat ngay)\b/, "late"],
  [/\b(regular|standard|normal|general|official|tieu chuan|thuong|chinh thuc|pho thong)\b/, "regular"],
];

export function tierKind(label: string): TierKind {
  const folded = foldVietnamese(label);
  for (const [pattern, kind] of TIER_KIND_RULES) if (pattern.test(folded)) return kind;
  return "other";
}

function normalizeTier(v: unknown, raceDate: string): Tier | null {
  if (typeof v !== "object" || v === null) return null;
  const t = v as Record<string, unknown>;
  const label = str(t.tier) ?? "Price";
  if (NOT_AN_ENTRY_FEE.test(foldVietnamese(label))) return null;
  const price = normalizePrice(t.price);
  if (price === null) return null;
  const rawDistance = str(t.distance);
  const distance = rawDistance ? normalizeDistance(rawDistance) : null;
  let from = tierDate(t.from, raceDate);
  let to = tierDate(t.to, raceDate);
  // A tier ends before race day; one that doesn't was misread, so drop its dates.
  if ((from !== null && from > raceDate) || (to !== null && to > raceDate) || (from !== null && to !== null && from > to)) from = to = null;
  return { distance: distance && isDistance(distance) ? distance : null, tier: label.slice(0, 80), kind: tierKind(label), price, from, to };
}

function dedupeTiers(tiers: Tier[]): Tier[] {
  const seen = new Map<string, Tier>();
  for (const t of tiers) {
    const key = [t.distance, foldVietnamese(t.tier), t.price, t.from, t.to].join("|");
    if (!seen.has(key)) seen.set(key, t);
  }
  return [...seen.values()];
}

/**
 * A tier boundary as YYYY-MM-DD. Posters often leave out the year ("08/7 - 18/7"):
 * it's the race year, or the year before when that date would fall after race day.
 */
export function tierDate(v: unknown, raceDate: string): string | null {
  const s = str(v);
  if (!s) return null;
  const full = normalizeDate(s);
  if (full) return full;
  const dm = s.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (!dm) return null;
  const day = Number(dm[1]);
  const month = Number(dm[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = Number(raceDate.slice(0, 4));
  const mmdd = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const sameYear = `${year}-${mmdd}`;
  return sameYear <= raceDate ? sameYear : `${year - 1}-${mmdd}`;
}

/** Known values only, deduped, in RACE_TYPES order (stable diffs); name rules win; never empty. */
function normalizeTypes(v: unknown, name: string): RaceType[] {
  const types = new Set<RaceType>(Array.isArray(v) ? v.filter((t): t is RaceType => RACE_TYPES.includes(t)) : []);
  const folded = foldVietnamese(name);
  for (const [pattern, type] of TYPE_FROM_NAME) if (pattern.test(folded)) types.add(type);
  // A city trail is its own format; the model tends to add plain trail_run as well.
  if (types.has("city_trail")) types.delete("trail_run");
  if (types.size === 0) types.add("other");
  return RACE_TYPES.filter((t) => types.has(t));
}

export function normalizeDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  // Vietnamese pages use DD/MM/YYYY.
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const date = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : dmy ? `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}` : null;
  if (!date || Number.isNaN(Date.parse(date))) return null;
  const year = Number(date.slice(0, 4));
  return year >= MIN_RACE_YEAR && year <= new Date().getUTCFullYear() + MAX_YEARS_AHEAD ? date : null;
}

export function normalizePrice(v: unknown): number | null {
  let n: number | null = null;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) n = Math.round(v);
  else if (typeof v === "string") {
    const digits = v.replace(/[^\d]/g, "");
    n = digits ? Number(digits) : null;
  }
  return n !== null && n <= MAX_PRICE ? n : null;
}

/**
 * "21.1K", "Half Marathon", "10 km", "100 MILES" -> "21km", "21km", "10km", "100mi". Standard distances
 * are snapped so wording drift between checks does not register as a change.
 */
export function normalizeDistance(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (/\bhalf\b|bán marathon|ban marathon/.test(s)) return "21km";
  if (/\b(full )?marathon\b/.test(s) && !/ultra/.test(s)) return "42km";
  const mi = s.match(/(\d+(?:[.,]\d+)?)\s*(miles?|mi)\b/);
  if (mi) return `${Number(mi[1]!.replace(",", "."))}mi`;
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(km|k)\b/);
  if (m) {
    const n = Number(m[1]!.replace(",", "."));
    if (Math.abs(n - 21.1) < 0.2) return "21km";
    if (Math.abs(n - 42.2) < 0.2) return "42km";
    return `${Number.isInteger(n) ? n : Number(n.toFixed(1))}km`;
  }
  return raw.trim();
}

// Prices the model sometimes puts in `distances` ("Chỉ từ 678.000đ").
const NOT_A_DISTANCE = /đ|vnd|chỉ từ|giá|\d{1,3}(?:[.,]\d{3}){1,}(?!\s*(?:km|k|m)\b)/i;

function normalizeDistances(v: unknown[]): string[] {
  const out = new Set<string>();
  for (const d of v) {
    if (typeof d !== "string" || !d.trim() || NOT_A_DISTANCE.test(d)) continue;
    const normalized = normalizeDistance(d);
    if (isDistance(normalized)) out.add(normalized); // anything else is extraction noise
  }
  return [...out].sort((a, b) => km(a) - km(b) || a.localeCompare(b));
}

function km(d: string): number {
  const m = d.match(/^(\d+(?:\.\d+)?)km$/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

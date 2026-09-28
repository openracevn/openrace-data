/**
 * What we ask Firecrawl for, and how its answers become race fields.
 *
 * One schema serves every site: Firecrawl's JSON extraction is a model reading the
 * content we hand it (the relevant HTML of a page, or a price image wrapped in a
 * PDF), so site differences live in the recipes, not here. What a source said is
 * stored verbatim as its `extracted` (see SourceExtraction) and normalized on read.
 */
import { createHash } from "node:crypto";
import { MAX_PRICE, MAX_YEARS_AHEAD, MIN_RACE_YEAR, RACE_TYPES, REGISTRATION_STATUSES, courseMeters, isDistance } from "./schema.ts";
import type { Audience, Course, RaceType, RegistrationStatus, TierKind } from "./schema.ts";
import { foldVietnamese, str } from "./text.ts";

/** sport = an endurance sports event; non_sport = concert, tour, hotel, conference; none = login, error or empty page. */
export const PAGE_KINDS = ["sport", "non_sport", "none"] as const;

const PRICES_PROPERTY = {
  type: "array",
  description:
    "Every entry fee: one item per distance and price tier, including a standard or list price that has no dates (\"Giá vé tiêu chuẩn\"). " +
    "Group prices (a price per person that depends on group size) are tiers too: start their label with \"Group\" and keep the size (\"Group 20-49\"). " +
    "Bundles and team entries are tiers too: keep their name in the label (\"Combo 1 (2 tickets) Early Bird\", \"Relay team Early Bird\"). " +
    "Only amounts printed as prices: never work a price out from a percentage discount; leave percentage-only discounts out. " +
    "Leave out add-ons (race photos, VIP upgrades, transfer or change fees, shipping) and merchandise.",
  items: {
    type: "object",
    properties: {
      distance: { type: "string", description: "Distance the price is for, as written (\"21KM\", \"Half Marathon\"). Omit if one price covers all." },
      tier: { type: "string", description: "Tier label as written: \"Super Early Bird\", \"Early Bird\", \"Regular\", \"Giá vé tiêu chuẩn\", \"Late\", \"Group 20-49\"..." },
      audience: {
        type: "string",
        description:
          "Only when the table prices Vietnamese and foreign runners differently, in separate rows or columns: the audience as written (\"Resident\", \"Non-resident\", \"Việt Nam\", \"Nước ngoài\"). " +
          "Omit it otherwise; \"Cá nhân\" / \"Individual\" is not an audience.",
      },
      from: {
        type: "string",
        description:
          "First day the tier is sold, if shown: YYYY-MM-DD when the year is shown, otherwise DD/MM as written. Omit if not shown (\"đến 22/10\", until 22/10, gives only the last day); never use race day.",
      },
      to: { type: "string", description: "Last day the tier is sold, if shown: YYYY-MM-DD when the year is shown, otherwise DD/MM as written. Omit if not shown; never use race day." },
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
          "open_water_swim = swimming in a lake, river or sea; pool_swim = swimming in a pool; swim = swimming and the page doesn't say open-water or pool; " +
          "road_cycle = road cycling; mtb = mountain biking; other = any other sport event.",
      },
      name: { type: "string", description: "Official event name exactly as written. Do not translate it." },
      date: { type: "string", description: "Race day as YYYY-MM-DD. For multi-day events, the first day." },
      endDate: { type: "string", description: "Last race day as YYYY-MM-DD, only for multi-day events." },
      distances: { type: "array", items: { type: "string" }, description: "Race distances offered, as written (\"5km\", \"21KM\", \"Half Marathon\")." },
      courses: {
        type: "array",
        description:
          "Per distance, only what the page states: its format (e.g. the 70km is trail_run while the 5km is road_run) and elevation gain (D+). Omit a field that isn't stated.",
        items: {
          type: "object",
          properties: {
            distance: { type: "string", description: "Distance as written." },
            type: { type: "string", enum: [...RACE_TYPES], description: "Format for this distance, if the page states it." },
            elevationGain: { type: "number", description: "Elevation gain in metres, if the page states it." },
          },
          required: ["distance"],
        },
      },
      edition: {
        type: "number",
        description: "The edition number if the page states it (\"lần thứ 5\", \"5th edition\", \"mùa 5\"). Omit otherwise; never count editions yourself.",
      },
      mapsUrl: {
        type: "string",
        description: "A Google Maps link or coordinates for the start/finish venue, exactly as on the page. Omit if none.",
      },
      venue: { type: "string", description: "Start/finish venue or area, as written." },
      city: { type: "string", description: "City or province where the race takes place, as written." },
      organizer: { type: "string", description: "Organizing company or body, only if named. Never the event name." },
      currency: { type: "string", description: "ISO 4217 code of the prices, usually VND." },
      registrationStatus: {
        type: "string",
        enum: [...REGISTRATION_STATUSES],
        description: "open = can register; closing_soon = ends soon or few slots left; sold_out = all slots taken (hết vé); closed = registration ended (the race happened or its window passed); cancelled = the race itself was called off or postponed with no new date, not just registration ending (hủy, tạm hoãn với no rescheduled date).",
      },
      participants: {
        type: "object",
        description:
          "How many people took part in this edition, only if the page states a number (recap or results announcement). Not finishers-only, not capacity or slots. Omit for an upcoming race.",
        properties: {
          count: { type: "number", description: "The stated number of participants." },
          approx: { type: "boolean", description: "true for \"~2000\", \"over 5,000\", \"khoảng 3.000\"; false for a precise figure." },
          quote: { type: "string", description: "The stated phrasing, verbatim." },
        },
        required: ["count", "approx"],
      },
      prices: PRICES_PROPERTY,
    },
    required: ["pageKind"],
  },
  prompt:
    "Extract the sports event (running, trail, triathlon, swimming, cycling, ...) described on this race page, usually in Vietnamese. " +
    "Convert dates such as \"21 - 22 tháng 11, 2026\" or \"24/01/2027\" to YYYY-MM-DD. " +
    "If the page shows no event (login, error or empty page), set pageKind to none and omit everything else. " +
    "Only report what the page states; omit fields that are not stated. Never guess. " +
    "Include the stated edition number, Maps link or coordinates, and per-distance format or elevation gain. " +
    "Prices must be written on the page as amounts; if the page shows prices only in images, return an empty prices list.",
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
    "List every entry fee: one item per distance and price tier (columns are often tiers such as Super Early Bird, Early Bird, Regular, Late, each with a date range; " +
    "a standard price column may have no dates). Read each row straight across: a price belongs to the distance on its own row. " +
    "Words decorating the image (slogans, the race's name) are not tiers. " +
    "Give an audience only if the table has separate Resident / Non-resident (Việt Nam / Nước ngoài) prices. " +
    "A group price table lists prices per person by group size: label those tiers \"Group <size>\". " +
    "Dates often have no year (\"24 JUN - 16 JUL\"): write them as DD/MM, never add a year. " +
    "If the image shows no ticket prices, return an empty prices list. Never guess.",
} as const;

export type Extraction = { schema: Record<string, unknown>; prompt: string };

/** Change whenever a schema or prompt changes, so cached reads made with older ones aren't reused. */
const version = (e: unknown) => createHash("sha256").update(JSON.stringify(e)).digest("hex").slice(0, 12);
export const PAGE_EXTRACTION_VERSION = version(PAGE_EXTRACTION);
export const IMAGE_EXTRACTION_VERSION = version(IMAGE_EXTRACTION);

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

export type Tier = { distance: string | null; tier: string; kind: TierKind; audience: Audience | null; price: number; from: string | null; to: string | null };

/** A source's normalized facts about a race. */
export type SourceFacts = {
  name: string;
  types: RaceType[];
  date: string;
  endDate: string | null;
  courses: Course[];
  edition: number | null;
  mapsUrl: string | null;
  venue: string | null;
  city: string | null;
  organizer: string | null;
  currency: string;
  registrationStatus: RegistrationStatus | null;
  prices: Tier[];
  // `sourceUrl` null = the page this was read from (reconcile fills it in).
  participants: { count: number; approx: boolean; sourceUrl: string | null; quote: string | null } | null;
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

  // A price table read from an image beats prices picked out of the text, which
  // mixes in other fees (photos, VIP upgrades, transfers).
  const tiersOf = (ls: Record<string, unknown>[]) =>
    dropUnsplitAudiences(fillTierDates(dedupeTiers(ls.flatMap((l) => dropComputedGroupPrices((Array.isArray(l.prices) ? l.prices : []).map((t) => normalizeTier(t, date)).filter((t) => t !== null))))));
  const imageTiers = tiersOf(images);
  const prices = imageTiers.length > 0 ? imageTiers : tiersOf([facts, ...pages]);
  const types = normalizeTypes(first((l) => (Array.isArray(l.types) && l.types.length > 0 ? l.types : null)), name);
  const distances = multisportFormats(
    normalizeDistances([
      ...(first((l) => (Array.isArray(l.distances) && l.distances.length > 0 ? l.distances : null)) ?? []),
      ...prices.map((t) => t.distance).filter((d) => d !== null),
    ]),
    types,
    name,
  );
  const courses = distances.map((label) => courseOf(label, layers, types));
  const edition = first((l) => normalizeEdition(l.edition));
  const mapsUrl = first((l) => str(l.mapsUrl));
  const status = first((l) => str(l.registrationStatus));
  const organizer = first((l) => str(l.organizer));

  return {
    ok: true,
    facts: {
      name,
      types,
      date,
      endDate,
      courses,
      edition,
      mapsUrl,
      venue: first((l) => str(l.venue)),
      city: first((l) => str(l.city)),
      // The model sometimes fills the organizer with the event name.
      organizer: organizer && foldVietnamese(organizer) !== foldVietnamese(name) ? organizer : null,
      currency: first((l) => str(l.currency)?.toUpperCase().slice(0, 3) ?? null) ?? "VND",
      registrationStatus: REGISTRATION_STATUSES.includes(status as RegistrationStatus) ? (status as RegistrationStatus) : null,
      prices,
      participants: first((l) => normalizeParticipants(l.participants)),
    },
  };
}

function normalizeParticipants(v: unknown): SourceFacts["participants"] {
  if (!isRecord(v)) return null;
  const { count, approx, sourceUrl, quote } = v;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) return null;
  const url = str(sourceUrl);
  return {
    count,
    approx: approx === true,
    sourceUrl: url !== null && /^https?:\/\//.test(url) ? url : null,
    quote: str(quote)?.slice(0, 200) ?? null,
  };
}

// Add-ons that aren't entry fees, even when the model lists them.
const NOT_AN_ENTRY_FEE = /\b(photos?|anh|vip|upgrade|nang cap|transfer|chuyen nhuong|doi cu ly|change|phi quan ly|admin|ship|shipping|van chuyen)\b/;

const TIER_KIND_RULES: [RegExp, TierKind][] = [
  // "Supper Early Bird" is a common misspelling on posters (Run For The Heart 2026).
  [/\b(supp?er ?early|super eb|seb|sieu som)\b/, "super_early"],
  [/\b(early|eb|som|uu dai som)\b/, "early"],
  [/\b(group|nhom|doan|bibchung)\b/, "group"],
  // "tre" (folded "trễ", late) collides with "trẻ em" (child) after diacritic
  // folding — a family/kids tier label like "REGULAR ... Trẻ em" would otherwise
  // match "late" before ever reaching the "regular" rule below (lamdong-trail-2026).
  [/\b(late|last ?call|muon|tre(?!\s*em)|phut chot|sat ngay)\b/, "late"],
  [/\b(regular|standard|normal|general|official|tieu chuan|thuong|chinh thuc|pho thong)\b/, "regular"],
];

const AUDIENCE_RULES: [RegExp, Audience][] = [
  [/\b(non ?resident|foreign(er)?s?|nuoc ngoai|quoc te|international|overseas)\b/, "non_resident"],
  [/\b(resident|local|viet ?nam(ese)?|trong nuoc|noi dia|nguoi viet)\b/, "resident"],
];

export function audienceOf(label: string | null): Audience | null {
  if (!label) return null;
  const folded = foldVietnamese(label);
  for (const [pattern, audience] of AUDIENCE_RULES) if (pattern.test(folded)) return audience;
  return null;
}

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
  // A 0 is a misread unless the tier says the race is free.
  if (price === 0 && !/\b(free|mien phi)\b/.test(foldVietnamese(label))) return null;
  const rawDistance = str(t.distance);
  const normalized = rawDistance ? normalizeDistance(rawDistance) : null;
  const distance = normalized && isDistance(normalized) ? normalized : null;
  const rawAudience = str(t.audience);
  const audience = audienceOf(rawAudience) ?? audienceOf(label);
  // A distance or audience that names what the price buys (a combo of tickets, a
  // relay team, "70.3 - 56.50") stays in the label, so it isn't read as a plain tier.
  const extra = [
    !distance && rawDistance && !INDIVIDUAL.test(foldVietnamese(rawDistance)) ? rawDistance : null,
    !audience && rawAudience && BUNDLE.test(foldVietnamese(rawAudience)) ? rawAudience : null,
  ].filter((s) => s !== null && !foldVietnamese(label).includes(foldVietnamese(s)));
  const fullLabel = [...extra, label].join(" · ");
  let from = tierDate(t.from, raceDate);
  let to = tierDate(t.to, raceDate);
  // A tier ends before race day; one that doesn't was misread, so drop its dates.
  // So was a "tier" sold only on race day: the model copied the race date.
  if ((from !== null && from > raceDate) || (to !== null && to > raceDate) || (from !== null && to !== null && from > to)) from = to = null;
  if (from === raceDate && (to === null || to === raceDate)) from = to = null;
  return {
    distance,
    tier: fullLabel.slice(0, 80),
    kind: BUNDLE.test(foldVietnamese(fullLabel)) ? "group" : tierKind(fullLabel),
    audience,
    price,
    from,
    to,
  };
}

// Bundles of tickets and team entries: priced per bundle or team, so kind "group".
const BUNDLE = /\b(combo|relay|tiep suc|team|dong doi|mua \d+ ve)\b/;
// What the model writes in distance or audience for a plain single entry.
const INDIVIDUAL = /^(ca nhan|individual|ve le|single)\b/;

/**
 * The model works group prices out from a percentage ("Nhóm 10-29: 5%") and gets them
 * wrong (Quảng Trực 2026). Printed VND prices are round thousands, so one read whose
 * group prices aren't was computing them: drop that read's group prices.
 */
function dropComputedGroupPrices(tiers: Tier[]): Tier[] {
  const computed = tiers.some((t) => t.kind === "group" && t.price % 1000 !== 0);
  return computed ? tiers.filter((t) => t.kind !== "group") : tiers;
}

/**
 * An audience only means something when the same distance and tier kind has a
 * different price for residents and non-residents. The model otherwise tags every
 * price "Resident" (Sơn Trà 2026) or repeats each price for both (Bắc Ninh 2027).
 */
function dropUnsplitAudiences(tiers: Tier[]): Tier[] {
  const prices = new Map<string, Map<Audience, Set<number>>>();
  for (const t of tiers) {
    if (!t.audience) continue;
    const key = `${t.distance}|${t.kind}`;
    const byAudience = prices.get(key) ?? new Map<Audience, Set<number>>();
    byAudience.set(t.audience, (byAudience.get(t.audience) ?? new Set()).add(t.price));
    prices.set(key, byAudience);
  }
  const split = [...prices.values()].some((byAudience) => {
    const [a, b] = [byAudience.get("resident"), byAudience.get("non_resident")];
    return a && b && [...a].sort().join() !== [...b].sort().join();
  });
  return split ? tiers : dedupeTiers(tiers.map((t) => ({ ...t, audience: null })));
}

function dedupeTiers(tiers: Tier[]): Tier[] {
  const seen = new Map<string, Tier>();
  for (const t of tiers) {
    const key = [t.distance, foldVietnamese(t.tier), t.audience, t.price, t.from, t.to].join("|");
    if (!seen.has(key)) seen.set(key, t);
  }
  return [...seen.values()];
}

/**
 * A tier the model gave no dates, or only a start, takes them from the same tier
 * (label) elsewhere in the table, e.g. the other audience's or distance's row.
 */
function fillTierDates(tiers: Tier[]): Tier[] {
  const dated = new Map<string, Tier>();
  for (const t of tiers) {
    const key = foldVietnamese(t.tier);
    if (t.from !== null && t.to !== null && !dated.has(key)) dated.set(key, t);
  }
  return tiers.map((t) => {
    const other = dated.get(foldVietnamese(t.tier));
    if (!other || (t.from !== null && t.to !== null)) return t;
    if (t.from === null && t.to === null) return { ...t, from: other.from, to: other.to };
    return t.from === other.from ? { ...t, to: other.to } : t;
  });
}

/**
 * A tier boundary as YYYY-MM-DD. Posters often leave out the year ("08/7 - 18/7"):
 * it's the race year, or the year before when that date would fall after race day.
 */
export function tierDate(v: unknown, raceDate: string): string | null {
  const s = str(v);
  if (!s) return null;
  const full = normalizeDate(s);
  // Sales run in the race year or the year before. Another year was made up by the
  // model (posters rarely print it), so work it out from the day and month instead.
  const raceYear = Number(raceDate.slice(0, 4));
  if (full && [raceYear, raceYear - 1].includes(Number(full.slice(0, 4)))) return full;
  const dm = full ? [full, full.slice(8, 10), full.slice(5, 7)] : (s.match(/^(\d{1,2})[/.-](\d{1,2})$/) ?? parseDayMonth(s));
  if (!dm) return null;
  const day = Number(dm[1]);
  const month = Number(dm[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = Number(raceDate.slice(0, 4));
  const mmdd = `${String(month).padStart(2, "0")}-${String(Math.min(day, daysInMonth(year, month))).padStart(2, "0")}`;
  const sameYear = `${year}-${mmdd}`;
  return sameYear <= raceDate ? sameYear : `${year - 1}-${mmdd}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "24 JUN", "5 Sep", "24 tháng 6" → [, day, month]. */
function parseDayMonth(s: string): [string, string, string] | null {
  const folded = foldVietnamese(s);
  const named = folded.match(/^(\d{1,2}) ([a-z]{3})[a-z]*$/);
  if (named && MONTHS.includes(named[2]!)) return [s, named[1]!, String(MONTHS.indexOf(named[2]!) + 1)];
  const thang = folded.match(/^(\d{1,2}) thang (\d{1,2})$/);
  return thang ? [s, thang[1]!, thang[2]!] : null;
}

function courseOf(label: string, layers: Record<string, unknown>[], types: RaceType[]): Course {
  let type: RaceType | null = null;
  let elevationGain: number | null = null;
  for (const layer of layers) {
    if (!Array.isArray(layer.courses)) continue;
    for (const raw of layer.courses) {
      if (!isRecord(raw)) continue;
      const distance = str(raw.distance);
      if (distance === null || normalizeDistance(distance) !== label) continue;
      if (type === null) {
        const stated = str(raw.type);
        if (stated !== null && (RACE_TYPES as readonly string[]).includes(stated)) type = stated as RaceType;
      }
      if (elevationGain === null) elevationGain = normalizeElevationGain(raw.elevationGain);
    }
  }
  return {
    label,
    meters: courseMeters(label),
    type: type ?? (types.length === 1 && types[0] !== "other" ? types[0]! : null),
    elevationGain,
  };
}

function normalizeElevationGain(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const rounded = Math.round(v);
  return rounded >= 0 && rounded <= 20_000 ? rounded : null;
}

function normalizeEdition(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 200 ? v : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const ymd = iso ? [iso[1]!, iso[2]!, iso[3]!] : dmy ? [dmy[3]!, dmy[2]!, dmy[1]!] : null;
  if (!ymd) return null;
  const [y, m, d] = ymd.map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Posters print days a month doesn't have ("31/11/2026", Tết Run 2027): the month's last day.
  const date = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, daysInMonth(y, m))).padStart(2, "0")}`;
  const year = Number(date.slice(0, 4));
  return year >= MIN_RACE_YEAR && year <= new Date().getUTCFullYear() + MAX_YEARS_AHEAD ? date : null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
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

const MULTISPORT: ReadonlySet<RaceType> = new Set(["triathlon", "duathlon", "aquathlon", "aquabike", "swimrun"]);
const LEG = /^\d+(\.\d+)?(km|m|mi)$/;

/**
 * A multisport race is counted by its format ("Sprint", "70.3", "56.50"), never by its
 * legs: a triathlon's 5km run is not comparable to a 5km road race. Leg distances
 * ("750m", "20km", "5km") are dropped; when no format is listed it comes from the name.
 */
function multisportFormats(distances: string[], types: RaceType[], name: string): string[] {
  if (!types.every((t) => MULTISPORT.has(t))) return distances;
  const formats = distances.filter((d) => !LEG.test(d));
  if (formats.length > 0) return formats;
  const n = name.toLowerCase();
  if (/\bironkids\b|\bkids\b/.test(n)) return ["Kids"];
  if (/\bsuper sprint\b/.test(n)) return ["Super Sprint"];
  if (/\bsprint\b/.test(n)) return ["Sprint"];
  if (/\bolympic\b/.test(n)) return ["Olympic"];
  if (/\b70\.3\b/.test(n)) return ["70.3"];
  return [];
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

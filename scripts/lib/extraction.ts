import { foldVietnamese, resolvePlace } from "./places.ts";
import {
  RACE_TYPES,
  REGISTRATION_STATUSES,
  type CanonicalRace,
  type RaceType,
  type RegistrationStatus,
  type SourceName,
} from "./schema.ts";

/**
 * JSON schemas handed to Firecrawl's JSON format, one per source (their pages show
 * different things). Whatever Firecrawl returns is stored verbatim as a source's
 * `rawExtracted`, and `normalizeExtracted` turns it into canonical race fields.
 */
/** sport = an endurance sports event; non_sport = concert, tour, hotel, conference; none = login, error or empty page. */
export const PAGE_KINDS = ["sport", "non_sport", "none"] as const;

// Names that settle a type regardless of what the model says (folded, lowercase).
const TYPE_FROM_NAME: [RegExp, RaceType][] = [
  [/\bcity trail\b/, "city_trail"],
  [/\b(triathlon|ironman|festrival)\b/, "triathlon"],
  [/\bduathlon\b/, "duathlon"],
  [/\baquathlon\b/, "aquathlon"],
  [/\bswimrun\b/, "swimrun"],
];

const COMMON_PROPERTIES = {
    pageKind: {
      type: "string",
      enum: [...PAGE_KINDS],
      description: "sport = an endurance sports event (running, trail, multisport, swimming, cycling). non_sport = concert, tour, attraction, hotel or conference. none = login, error or empty page.",
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
    name: { type: "string", description: "Official event name exactly as written on the page. Do not translate it." },
    date: { type: "string", description: "Race day as YYYY-MM-DD. For multi-day events, the first race day." },
    distances: {
      type: "array",
      items: { type: "string" },
      description: "Race distances offered, e.g. [\"5km\", \"10km\", \"21km\", \"42km\"]. Only distances the page explicitly lists for this race.",
    },
    venue: { type: "string", description: "Start/finish venue or area, if stated." },
    city: { type: "string", description: "City or province in Vietnam where the race takes place." },
    currency: { type: "string", description: "ISO 4217 currency code of the prices, usually VND." },
    registrationStatus: {
      type: "string",
      enum: [...REGISTRATION_STATUSES],
      description: "open = can register; closing_soon = page says registration ends soon or few slots left; sold_out = all slots taken; closed = registration ended.",
    },
    registrationUrl: { type: "string", description: "Absolute URL where runners register or buy a bib." },
    organizer: { type: "string", description: "Organizing company or body, only if the page names one. Never the event name." },
} as const;

const COMMON_PROMPT =
  "Extract details of the sports event (running, trail, triathlon, swimming, cycling, ...) described on this event page. The page is usually in Vietnamese: " +
  "convert dates such as \"21 - 22 tháng 11, 2026\" or \"24/01/2027\" to YYYY-MM-DD, and prices such as \"350.000đ\" to plain numbers. " +
  "If the page shows no event details (login, error or empty page), set pageKind to none and omit everything else. " +
  "Only report what the page states; omit fields that are not stated. Never guess.";

export type Extraction = { schema: Record<string, unknown>; prompt: string };

export const EXTRACTIONS: Record<SourceName, Extraction> = {
  actiup: {
    schema: {
      type: "object",
      properties: {
        ...COMMON_PROPERTIES,
        // ActiUp event pages only show a "Chỉ từ" (from) price; the full price list is
        // behind a login. Asking for a max made the model copy the from price or invent one.
        priceMin: { type: "number", description: "The \"Chỉ từ\" (from) price as a plain number in the listed currency, no separators. \"Miễn phí\" means 0." },
      },
      required: ["pageKind", "name", "date"],
    },
    prompt: `${COMMON_PROMPT} Ignore the "Có thể bạn sẽ thích" section: those are other events.`,
  },
  // bibchung sells bibs in groups at a discount. Its registration section lists
  // each tier and distance with the regular price, then the bibchung price:
  //   EARLY BIRD · 07/09/2026 – 22/10/2026 · 21KM · 678.000 ₫ · 542.000 ₫
  bibchung: {
    schema: {
      type: "object",
      properties: {
        ...COMMON_PROPERTIES,
        priceMin: {
          type: "number",
          description:
            "Cheapest REGULAR price, as a plain number: the lowest of the first (higher) prices across price rows. " +
            "Never use a bibchung (second, lower) price here. Row \"21KM 678.000 ₫ 542.000 ₫\" → 678000.",
        },
        priceMax: {
          type: "number",
          description: "Most expensive REGULAR price: the highest of the first (higher) prices across price rows. Row \"21KM 678.000 ₫ 542.000 ₫\" → 678000.",
        },
        groupPriceMin: {
          type: "number",
          description: "Cheapest bibchung (discounted) price: the lowest of the second (lower) prices across price rows. Row \"21KM 678.000 ₫ 542.000 ₫\" → 542000.",
        },
      },
      required: ["pageKind", "name", "date"],
    },
    prompt:
      `${COMMON_PROMPT} Distances are listed per price row (e.g. "21KM"). ` +
      "Each price row shows the regular price, then the lower bibchung (group) price: " +
      "priceMin and priceMax use only regular prices, groupPriceMin only bibchung prices. " +
      "The organizer is a company or body named on the page (e.g. \"Ban tổ chức\"); if none is named, omit it.",
  },
};

export type NormalizeResult =
  | { ok: true; race: CanonicalRace }
  | { ok: false; reason: string };

export function normalizeExtracted(raw: Record<string, unknown>): NormalizeResult {
  if (raw.pageKind === "non_sport") return { ok: false, reason: "not a sports event" };
  if (raw.pageKind !== "sport") return { ok: false, reason: `no event on the page (pageKind: ${JSON.stringify(raw.pageKind)})` };

  const name = str(raw.name);
  if (!name) return { ok: false, reason: "missing name" };
  const date = normalizeDate(raw.date);
  if (!date) return { ok: false, reason: `missing or unparseable date: ${JSON.stringify(raw.date)}` };

  let priceMin = normalizePrice(raw.priceMin);
  let priceMax = normalizePrice(raw.priceMax);
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) [priceMin, priceMax] = [priceMax, priceMin];
  const groupPriceMin = normalizePrice(raw.groupPriceMin);
  // The model sometimes reports the discounted group price as the cheapest regular
  // price too; then the real regular minimum is unknown.
  if (groupPriceMin !== null && priceMin === groupPriceMin && priceMax !== null && priceMax > priceMin) priceMin = null;

  // The model alternates between the town ("Cao Lãnh") and the province; venues usually
  // end in the province ("…, Tỉnh Đồng Tháp"), so fall back to it for an unknown city.
  let place = resolvePlace(str(raw.city));
  if (place.region === null) {
    const fromVenue = resolvePlace(str(raw.venue));
    if (fromVenue.region !== null) place = fromVenue;
  }
  const status = str(raw.registrationStatus);

  return {
    ok: true,
    race: {
      name,
      types: normalizeTypes(raw.types, name),
      date,
      distances: normalizeDistances(raw.distances),
      location: { venue: str(raw.venue), city: place.city, region: place.region },
      priceMin,
      priceMax,
      groupPriceMin,
      currency: str(raw.currency)?.toUpperCase().slice(0, 3) ?? "VND",
      registrationStatus: REGISTRATION_STATUSES.includes(status as RegistrationStatus)
        ? (status as RegistrationStatus)
        : null,
      registrationUrl: normalizeUrl(raw.registrationUrl),
      // The model sometimes fills the organizer with the event name.
      organizer: str(raw.organizer) && foldVietnamese(str(raw.organizer)!) !== foldVietnamese(name) ? str(raw.organizer) : null,
      foreignerEligible: typeof raw.foreignerEligible === "boolean" ? raw.foreignerEligible : null,
    },
  };
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

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null;
}

function normalizeDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Vietnamese pages use DD/MM/YYYY.
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  return null;
}

function normalizePrice(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.round(v);
  if (typeof v === "string") {
    const digits = v.replace(/[^\d]/g, "");
    return digits ? Number(digits) : null;
  }
  return null;
}

function normalizeUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * "21.1K", "Half Marathon", "10 km", "100 MILES" -> "21km", "21km", "10km", "100mi". Standard distances
 * are snapped so LLM wording drift between checks does not register as a change.
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

function normalizeDistances(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const d of v) if (typeof d === "string" && d.trim() && !NOT_A_DISTANCE.test(d)) out.add(normalizeDistance(d));
  return [...out].sort((a, b) => km(a) - km(b) || a.localeCompare(b));
}

function km(d: string): number {
  const m = d.match(/^(\d+(?:\.\d+)?)km$/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

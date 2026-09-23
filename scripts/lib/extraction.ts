import { foldVietnamese, resolvePlace } from "./places.ts";
import { REGISTRATION_STATUSES, type CanonicalRace, type RegistrationStatus } from "./schema.ts";

/**
 * JSON schema handed to Firecrawl's `changeTracking` (json mode) format. Whatever
 * Firecrawl returns for it is stored verbatim as a source's `rawExtracted`, and
 * `normalizeExtracted` turns it into canonical race fields.
 */
export const SPORTS = ["running", "multisport", "cycling", "swimming", "other", "none"] as const;

const MULTISPORT_NAME = /\b(triathlon|duathlon|aquathlon|ironman|ironkids|festrival|70 3)\b/;

export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    sport: {
      type: "string",
      enum: [...SPORTS],
      description: "What kind of event this page describes. running = road race, trail race, marathon or ultra. multisport = triathlon, duathlon, aquathlon, Ironman. none = login, error or empty page.",
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
    // ActiUp event pages only show a "Chỉ từ" (from) price; the full price list is
    // behind a login. Asking for a max made the model copy the from price or invent one.
    priceMin: { type: "number", description: "The \"Chỉ từ\" (from) price as a plain number in the listed currency, no separators. \"Miễn phí\" means 0." },
    currency: { type: "string", description: "ISO 4217 currency code of the prices, usually VND." },
    registrationStatus: {
      type: "string",
      enum: [...REGISTRATION_STATUSES],
      description: "open = can register; closing_soon = page says registration ends soon or few slots left; sold_out = all slots taken; closed = registration ended.",
    },
    registrationUrl: { type: "string", description: "Absolute URL where runners register or buy a bib." },
    organizer: { type: "string", description: "Organizing company or body." },
  },
  required: ["sport", "name", "date"],
} as const;

export const EXTRACTION_PROMPT =
  "Extract details of the running race described on this event page. The page is usually in Vietnamese: " +
  "convert dates such as \"21 - 22 tháng 11, 2026\" to YYYY-MM-DD, and prices such as \"350.000đ\" to plain numbers. " +
  "Ignore the \"Có thể bạn sẽ thích\" section: those are other events. " +
  "If the page shows no event details (login, error or empty page), set sport to none and omit everything else. " +
  "Only report what the page states; omit fields that are not stated. Never guess.";

export type NormalizeResult =
  | { ok: true; race: CanonicalRace }
  | { ok: false; reason: string };

export function normalizeExtracted(raw: Record<string, unknown>): NormalizeResult {
  if (raw.sport !== "running") return { ok: false, reason: `not a running race (sport: ${JSON.stringify(raw.sport)})` };

  const name = str(raw.name);
  if (!name) return { ok: false, reason: "missing name" };
  // The model still labels some multisport events "running"; their names give them away.
  if (MULTISPORT_NAME.test(foldVietnamese(name))) return { ok: false, reason: `multisport event: ${name}` };
  const date = normalizeDate(raw.date);
  if (!date) return { ok: false, reason: `missing or unparseable date: ${JSON.stringify(raw.date)}` };

  let priceMin = normalizePrice(raw.priceMin);
  let priceMax = normalizePrice(raw.priceMax);
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) [priceMin, priceMax] = [priceMax, priceMin];

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
      date,
      distances: normalizeDistances(raw.distances),
      location: { venue: str(raw.venue), city: place.city, region: place.region },
      priceMin,
      priceMax,
      currency: str(raw.currency)?.toUpperCase().slice(0, 3) ?? "VND",
      registrationStatus: REGISTRATION_STATUSES.includes(status as RegistrationStatus)
        ? (status as RegistrationStatus)
        : null,
      registrationUrl: normalizeUrl(raw.registrationUrl),
      organizer: str(raw.organizer),
      foreignerEligible: typeof raw.foreignerEligible === "boolean" ? raw.foreignerEligible : null,
    },
  };
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

function normalizeDistances(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const d of v) if (typeof d === "string" && d.trim()) out.add(normalizeDistance(d));
  return [...out].sort((a, b) => km(a) - km(b) || a.localeCompare(b));
}

function km(d: string): number {
  const m = d.match(/^(\d+(?:\.\d+)?)km$/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

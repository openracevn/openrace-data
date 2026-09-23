import { resolvePlace } from "./places.ts";
import { REGISTRATION_STATUSES, type CanonicalRace, type RegistrationStatus } from "./schema.ts";

/**
 * JSON schema handed to Firecrawl's `changeTracking` (json mode) format. Whatever
 * Firecrawl returns for it is stored verbatim as a source's `rawExtracted`, and
 * `normalizeExtracted` turns it into canonical race fields.
 */
export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    isRunningRace: {
      type: "boolean",
      description: "True only if this page is a single running event (road race, trail race, marathon, ultra). False for listings, cycling, swimming, triathlon-only, or non-sport events.",
    },
    name: { type: "string", description: "Official event name, in English if the page offers it." },
    date: { type: "string", description: "Race day as YYYY-MM-DD. For multi-day events, the first race day." },
    distances: {
      type: "array",
      items: { type: "string" },
      description: "Race distances offered, e.g. [\"5km\", \"10km\", \"21km\", \"42km\"].",
    },
    venue: { type: "string", description: "Start/finish venue or area, if stated." },
    city: { type: "string", description: "City or province in Vietnam where the race takes place." },
    priceMin: { type: "number", description: "Cheapest registration price as a plain number in the listed currency (no separators)." },
    priceMax: { type: "number", description: "Most expensive registration price as a plain number in the listed currency." },
    currency: { type: "string", description: "ISO 4217 currency code of the prices, usually VND." },
    registrationStatus: {
      type: "string",
      enum: [...REGISTRATION_STATUSES],
      description: "open = can register; closing_soon = page says registration ends soon or few slots left; sold_out = all slots taken; closed = registration ended.",
    },
    registrationUrl: { type: "string", description: "Absolute URL where runners register or buy a bib." },
    organizer: { type: "string", description: "Organizing company or body." },
    foreignerEligible: {
      type: "boolean",
      description: "Whether non-Vietnamese runners can register. Omit if the page does not say.",
    },
  },
  required: ["isRunningRace", "name", "date"],
} as const;

export const EXTRACTION_PROMPT =
  "Extract details of the running race described on this event page. Only report what the page states; omit fields that are not stated.";

export type NormalizeResult =
  | { ok: true; race: CanonicalRace }
  | { ok: false; reason: string };

export function normalizeExtracted(raw: Record<string, unknown>): NormalizeResult {
  if (raw.isRunningRace === false) return { ok: false, reason: "not a running race" };

  const name = str(raw.name);
  if (!name) return { ok: false, reason: "missing name" };
  const date = normalizeDate(raw.date);
  if (!date) return { ok: false, reason: `missing or unparseable date: ${JSON.stringify(raw.date)}` };

  let priceMin = normalizePrice(raw.priceMin);
  let priceMax = normalizePrice(raw.priceMax);
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) [priceMin, priceMax] = [priceMax, priceMin];

  const place = resolvePlace(str(raw.city));
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
 * "21.1K", "Half Marathon", "10 km" -> "21km", "21km", "10km". Standard distances
 * are snapped so LLM wording drift between checks does not register as a change.
 */
export function normalizeDistance(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (/\bhalf\b|bán marathon|ban marathon/.test(s)) return "21km";
  if (/\b(full )?marathon\b/.test(s) && !/ultra/.test(s)) return "42km";
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

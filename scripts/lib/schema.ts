import { z } from "zod";

export const RACES_DIR = "data/races";
export const INDEX_PATH = "data/index.json";
export const SERIES_PATH = "data/series.json";
export const ORGANIZERS_PATH = "data/organizers.json";

/**
 * Version of the data contract (race files, index.json, series.json,
 * organizers.json) that consumers such as openrace-api code against. Bump it on a
 * breaking change: removing or renaming a field, narrowing a type, or changing a
 * field's meaning. Additive changes (a new field, a new enum value) don't bump it;
 * consumers must ignore unknown fields and tolerate unknown enum values.
 * Published as JSON Schema under schema/ (npm run schema).
 *
 * 2: design v2 (.claude/docs/design-v2.md): price tiers, series and organizers,
 *    registrations, links, flags, location as written, sources keyed by site.
 * 3: courses[] replaces distances[], geo, edition, tier `inferred`.
 */
export const SCHEMA_VERSION = 3;

// Sanity bounds: values outside them are extraction mistakes, not races.
export const MAX_PRICE = 100_000_000; // VND
export const MIN_RACE_YEAR = 2015;
export const MAX_YEARS_AHEAD = 3;

/** "10km", "750m", "100mi", a bare number ("56.5"), or a named multisport format ("Sprint", "70.3"). */
export function isDistance(s: string): boolean {
  return (
    /^\d+(\.\d+)?(km|mi|m)$/.test(s) ||
    /^\d{1,3}(\.\d+)?$/.test(s) ||
    /^(super sprint|sprint|olympic|standard|half|full|70\.3|140\.6|5150|kids)$/i.test(s)
  );
}

export function courseMeters(label: string): number | null {
  const normalized = label.trim().toLowerCase();
  const named: Record<string, number | null> = {
    "super sprint": 12_900,
    sprint: 25_750,
    olympic: 51_500,
    standard: 51_500,
    "5150": 51_500,
    "70.3": 113_000,
    half: 113_000,
    "140.6": 226_000,
    full: 226_000,
    kids: null,
  };
  if (Object.hasOwn(named, normalized)) return named[normalized]!;
  if (normalized === "21km") return 21_097;
  if (normalized === "42km") return 42_195;
  const withUnit = normalized.match(/^(\d+(?:\.\d+)?)(km|mi|m)$/);
  const bare = normalized.match(/^\d+(?:\.\d+)?$/);
  if (!withUnit && !bare) return null;
  const value = Number(withUnit?.[1] ?? bare?.[0]);
  const meters = withUnit ? (withUnit[2] === "km" ? value * 1_000 : withUnit[2] === "m" ? value : Math.round(value * 1_609.344)) : value * 1_000;
  return Number.isSafeInteger(meters) && meters > 0 ? meters : null;
}

export const REGISTRATION_STATUSES = ["open", "closing_soon", "sold_out", "closed"] as const;

// Event formats, for filtering. A race can have several (e.g. a road 10K plus a
// trail 21K). Distance classes (marathon, half, ultra) are not types: they follow
// from `courses`. Adding values later is backwards compatible.
export const RACE_TYPES = [
  "road_run", //     road running: fun runs, 10K, half, marathon
  "trail_run", //    trail / mountain running, including ultra trail
  "city_trail", //   urban trail: stairs, parks, alleys through a city
  "obstacle_run", // obstacle course race (OCR)
  "triathlon", //    swim + bike + run
  "duathlon", //     run + bike + run
  "aquathlon", //    swim + run
  "aquabike", //     swim + bike
  "swimrun", //      alternating open-water swim and trail run legs
  "swim", //         open-water or pool swimming
  "road_cycle", //   road cycling: gran fondo, criterium, time trial
  "mtb", //          mountain biking
  "other", //        a sport event that fits none of the above
] as const;

// Normalized price tier. The label as written is kept in `tier`.
export const TIER_KINDS = ["super_early", "early", "regular", "late", "group", "other"] as const;

// Who a price is for, when a race prices runners differently (HCMC Marathon:
// Resident / Non-resident). null: everyone, or not stated.
export const AUDIENCES = ["resident", "non_resident"] as const;

// What a related URL is. `seller` links also show up in `registrations`.
export const LINK_KINDS = ["official", "seller", "facebook", "rules", "results", "news", "other"] as const;

// official: the race's own site (wins for date, courses and location).
// seller: a ticket seller (ActiUp, bibchung, 5bib, ...). reference: entered by hand
// by OpenRace (never scraped; its url is where we took the facts from).
export const SOURCE_ROLES = ["official", "seller", "reference"] as const;

// single-sourced: one usable source. multi-sourced: several sources agree on race
// day. conflicting: they disagree on race day (see flags). See reconcile.ts.
export const CONFIDENCE_LEVELS = ["single-sourced", "multi-sourced", "conflicting"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const raceDate = isoDate.refine((d) => {
  const year = Number(d.slice(0, 4));
  return year >= MIN_RACE_YEAR && year <= new Date().getUTCFullYear() + MAX_YEARS_AHEAD;
}, `race year must be between ${MIN_RACE_YEAR} and ${MAX_YEARS_AHEAD} years from now`);
const isoDateTime = z.iso.datetime();
const slug = z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected kebab-case slug");
// A site key from config/sites.yaml, or "openrace".
const siteKey = slug;
// No URLs or prices: those are extraction mistakes.
const raceName = z
  .string()
  .min(1)
  .max(200)
  .refine((n) => !/https?:\/\/|\d{1,3}(?:[.,]\d{3})+\s*(?:đ|₫|vnd)/i.test(n), "name contains a URL or a price");
// Permanent key: file name, index key, API key. Never derived from race data.
const raceId = z.uuid();

export const PriceTierSchema = z
  .object({
    // Normalized ("21km"); null when one price covers every distance.
    distance: z.string().refine(isDistance, "not a distance").nullable(),
    tier: z.string().min(1).max(80),
    kind: z.enum(TIER_KINDS),
    audience: z.enum(AUDIENCES).nullable(),
    price: z.number().int().nonnegative().max(MAX_PRICE),
    from: isoDate.nullable(),
    to: isoDate.nullable(),
    inferred: z.array(z.enum(["from", "to"])),
    // The site whose page gave this price (sellers can differ, e.g. a group price).
    site: siteKey,
  })
  .refine((t) => t.from === null || t.to === null || t.from <= t.to, { message: "from must be <= to", path: ["from"] });

export const GEO_SOURCES = ["maps_link", "nominatim", "manual"] as const;
export const GEO_PRECISIONS = ["venue", "ward", "province"] as const;

export const CourseSchema = z.object({
  label: z.string().refine(isDistance, "not a distance"),
  meters: z.number().int().positive().nullable(),
  type: z.enum(RACE_TYPES).nullable(),
  elevationGain: z.number().int().nonnegative().max(20_000).nullable(),
});

export const GeoSchema = z.object({
  lat: z.number().min(8).max(24),
  lng: z.number().min(102).max(110),
  source: z.enum(GEO_SOURCES),
  precision: z.enum(GEO_PRECISIONS),
  current: z.object({
    province: z.string().regex(/^\d{2}$/),
    ward: z.string().regex(/^\d{5}$/).nullable(),
  }),
  legacy: z
    .object({
      province: z.string().regex(/^\d{2}$/),
      district: z.string().regex(/^\d{3}$/).nullable(),
      ward: z.string().regex(/^\d{5}$/).nullable(),
    })
    .nullable(),
  access: z.enum(["road", "flight_or_ferry"]),
  fromPlaces: z.record(
    z.string(),
    z.object({
      km: z.number().nonnegative(),
      minutes: z.number().int().nonnegative().nullable(),
      method: z.enum(["road", "straight_line"]),
    }),
  ),
});

export const RegistrationSchema = z.object({ site: siteKey, url: z.url() });

export const LinkSchema = z.object({
  url: z.url(),
  kind: z.enum(LINK_KINDS),
  // Host of the page the link was found on.
  foundOn: z.string().min(1),
});

// Fields that come from sources, or from an OpenRace override (everything except
// bookkeeping). Diffs, commit summaries and Discord notifications use these.
export const CANONICAL_FIELDS = [
  "name",
  "types",
  "date",
  "endDate",
  "seriesId",
  "organizerId",
  "organizer",
  "edition",
  "courses",
  "location",
  "geo",
  "prices",
  "currency",
  "registrationStatus",
  "registrations",
  "links",
] as const;

export const SourceSchema = z.object({
  site: siteKey,
  role: z.enum(SOURCE_ROLES),
  url: z.url(),
  lastCheckedAt: isoDateTime,
  lastChangedAt: isoDateTime,
  // What this source said, verbatim: facts read from the site's own data, and each
  // page's and price image's extraction. Canonical fields are derived from these,
  // so reconciliation can be re-run later without re-reading anything.
  extracted: z.record(z.string(), z.unknown()),
});

/**
 * A value set by OpenRace that wins over every source, e.g. a correction or a fact no
 * source states. It survives re-checks and re-derivation; removing it brings the source
 * value back. The race's field always equals `value` (so readers can ignore this block).
 */
export const OverrideSchema = z.object({
  value: z.unknown(),
  reason: z.string().min(1),
  at: isoDateTime,
});

// `null` means "unknown / not stated by any source", never "false" or "zero".
export const RaceSchema = z
  .object({
    id: raceId,
    // URL slug for the frontend. Unique, and allowed to change (SEO) with
    // `npm run edit -- slug`. Names the file (see raceFileName). Never used as a key: `id` is.
    slug,
    name: raceName,
    types: z.array(z.enum(RACE_TYPES)).min(1),
    date: raceDate,
    // Last race day of a multi-day event; null for a one-day race.
    endDate: raceDate.nullable(),
    seriesId: slug.nullable(),
    organizerId: slug.nullable(),
    // The organizer as a source writes it.
    organizer: z.string().min(1).nullable(),
    edition: z.number().int().min(1).max(200).nullable(),
    courses: z.array(CourseSchema),
    // As the source writes it; not normalized.
    location: z.object({
      venue: z.string().min(1).nullable(),
      city: z.string().min(1).nullable(),
    }),
    geo: GeoSchema.nullable(),
    prices: z.array(PriceTierSchema),
    currency: z.string().regex(/^[A-Z]{3}$/, "expected an ISO 4217 code"),
    registrationStatus: z.enum(REGISTRATION_STATUSES).nullable(),
    registrations: z.array(RegistrationSchema),
    links: z.array(LinkSchema),
    // Things someone should look at (sources disagree, no prices close to race day, ...).
    // Derived on every write; shown on Discord.
    flags: z.array(z.string().min(1)),
    overrides: z.partialRecord(z.enum(CANONICAL_FIELDS), OverrideSchema),
    sources: z.array(SourceSchema).min(1),
    confidence: z.enum(CONFIDENCE_LEVELS),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .refine((r) => r.endDate === null || r.endDate >= r.date, { message: "endDate must be >= date", path: ["endDate"] })
  .refine((r) => r.createdAt <= r.updatedAt, { message: "createdAt must be <= updatedAt", path: ["updatedAt"] })
  .superRefine((r, ctx) => {
    for (const [field, override] of Object.entries(r.overrides)) {
      if (!deepEqual(r[field as CanonicalField], override?.value)) {
        ctx.addIssue({ code: "custom", message: `${field} must equal its override value`, path: [field] });
      }
    }
  });

export function upgradeRace(json: unknown): unknown {
  if (!isRecord(json)) return json;
  const upgraded: Record<string, unknown> = { ...json };
  let changed = false;
  if (Object.hasOwn(json, "distances")) {
    delete upgraded.distances;
    changed = true;
  }
  for (const [field, value] of [["courses", []], ["geo", null], ["edition", null]] as const) {
    if (!Object.hasOwn(json, field)) {
      upgraded[field] = value;
      changed = true;
    }
  }
  if (Array.isArray(json.prices)) {
    const currentPrices = json.prices;
    const prices = currentPrices.map(upgradePrice);
    if (prices.some((price, i) => price !== currentPrices[i])) {
      upgraded.prices = prices;
      changed = true;
    }
  }
  if (isRecord(json.overrides)) {
    const pricesOverride = json.overrides.prices;
    if (isRecord(pricesOverride) && Array.isArray(pricesOverride.value)) {
      const currentPrices = pricesOverride.value;
      const prices = currentPrices.map(upgradePrice);
      if (prices.some((price, i) => price !== currentPrices[i])) {
        upgraded.overrides = { ...json.overrides, prices: { ...pricesOverride, value: prices } };
        changed = true;
      }
    }
  }
  return changed ? upgraded : json;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function upgradePrice(price: unknown): unknown {
  if (!isRecord(price) || Object.hasOwn(price, "inferred")) return price;
  return { ...price, inferred: [] };
}

/** A series (recurring event, e.g. "HCMC Marathon") or an organizer. Keys are readable slugs. */
export const EntitySchema = z.object({
  id: slug,
  name: z.string().min(1).max(200),
  website: z.url().nullable(),
});
export const SeriesSchema = EntitySchema.extend({ organizerId: slug.nullable() });
export const SeriesListSchema = z.array(SeriesSchema);
export const OrganizerListSchema = z.array(EntitySchema);

/** Structural equality for JSON values (object key order doesn't matter). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export const IndexEntrySchema = z.object({
  id: raceId,
  slug,
  // Name and race day, so a page from another source can be matched to its race
  // without reading every race file.
  name: raceName,
  date: raceDate,
  // The race's last day, for freshness (final after it, and never checked again).
  endDate: raceDate.nullable().default(null),
  lastModified: isoDateTime,
  // The race's file in data/races (raceFileName), so readers don't need the naming rule.
  file: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-\d{4}\.json$/, "expected <slug>-<year>.json"),
  // The race's series, so series can be worked out without reading every race file.
  seriesId: slug.nullable().default(null),
  // Lets ingestion map a source URL to its race without reading every race file,
  // so a renamed race keeps its id instead of forking a new file. One URL can
  // belong to several races: an official site serves a new edition every year.
  sourceUrls: z.array(z.url()),
  // Official and seller URLs the race's pages link to: a page at one of these
  // URLs is this race (the strongest match across sites).
  linkUrls: z.array(z.url()),
});

export const IndexSchema = z.array(IndexEntrySchema);

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export type RaceType = (typeof RACE_TYPES)[number];
export type TierKind = (typeof TIER_KINDS)[number];
export type Audience = (typeof AUDIENCES)[number];
export type LinkKind = (typeof LINK_KINDS)[number];
export type SourceRole = (typeof SOURCE_ROLES)[number];
export type PriceTier = z.infer<typeof PriceTierSchema>;
export type Course = z.infer<typeof CourseSchema>;
export type Geo = z.infer<typeof GeoSchema>;
export type Registration = z.infer<typeof RegistrationSchema>;
export type Link = z.infer<typeof LinkSchema>;
export type RaceSource = z.infer<typeof SourceSchema>;
export type Override = z.infer<typeof OverrideSchema>;
export type Overrides = Race["overrides"];
export type Race = z.infer<typeof RaceSchema>;
export type IndexEntry = z.infer<typeof IndexEntrySchema>;
export type Series = z.infer<typeof SeriesSchema>;
export type Organizer = z.infer<typeof EntitySchema>;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];
// Every canonical field is a Race field.
const _canonicalFieldsAreRaceFields: readonly (keyof Race)[] = CANONICAL_FIELDS;
void _canonicalFieldsAreRaceFields;
export type CanonicalRace = Pick<Race, CanonicalField>;

/**
 * A race's file name: its slug, with the race year at the end and never at the
 * start, so files are readable and editions don't blur ("vung-tau-city-trail" in
 * 2026 → "vung-tau-city-trail-2026.json"; "2026-international-run-for-a-green-da-lat"
 * → "international-run-for-a-green-da-lat-2026.json"; "tet-run-mien-nam-2027" stays).
 * The key is still the `id` inside. A race moved to another year gets its file renamed.
 */
export function raceFileName(slug: string, date: string): string {
  const year = date.slice(0, 4);
  const base = slug.replace(/^(?:19|20)\d{2}-(?=[a-z0-9])/, "");
  return `${base.endsWith(`-${year}`) ? base : `${base}-${year}`}.json`;
}

export function racePath(race: { slug: string; date: string }): string {
  return `${RACES_DIR}/${raceFileName(race.slug, race.date)}`;
}

/** Stable serialization so identical data always yields byte-identical files. */
export function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

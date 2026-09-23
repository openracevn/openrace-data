import { z } from "zod";

export const RACES_DIR = "data/races";
export const INDEX_PATH = "data/index.json";

/**
 * Version of the data contract (race files + index.json) that consumers such as
 * openrace-api code against. Bump it on a breaking change: removing or renaming a
 * field, narrowing a type, or changing a field's meaning. Additive changes (a new
 * field, a new enum value) don't bump it; consumers must ignore unknown fields and
 * tolerate unknown enum values. Published as JSON Schema under schema/ (npm run schema).
 */
export const SCHEMA_VERSION = 1;

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

export const REGIONS = ["north", "central", "south"] as const;
export const REGISTRATION_STATUSES = ["open", "closing_soon", "sold_out", "closed"] as const;

// Event formats, for filtering. A race can have several (e.g. a road 10K plus a
// trail 21K). Distance classes (marathon, half, ultra) are not types: they follow
// from `distances`. Adding values later is backwards compatible.
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

// single-sourced: one usable source. multi-sourced: several sources agree on race
// day. conflicting: they disagree on race day (someone should look). See reconcile.ts.
export const CONFIDENCE_LEVELS = ["single-sourced", "multi-sourced", "conflicting"] as const;

// Source names are stable keys; add new ones as ingestion sources are added.
// actiup: primary. bibchung: group purchase at a discount (groupPriceMin), plus
// distances and prices ActiUp hides behind its login. openrace: entered by us, for a
// race no site lists (never scraped; its url is the reference we took it from).
export const SOURCE_NAMES = ["actiup", "bibchung", "openrace"] as const;
/** Sources we scrape (everything but openrace). */
export const SCRAPED_SOURCES = ["actiup", "bibchung"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const raceDate = isoDate.refine((d) => {
  const year = Number(d.slice(0, 4));
  return year >= MIN_RACE_YEAR && year <= new Date().getUTCFullYear() + MAX_YEARS_AHEAD;
}, `race year must be between ${MIN_RACE_YEAR} and ${MAX_YEARS_AHEAD} years from now`);
const price = z.number().int().nonnegative().max(MAX_PRICE).nullable();
const isoDateTime = z.iso.datetime();
const slug = z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected kebab-case slug");
// No URLs or prices: those are extraction mistakes.
const raceName = z
  .string()
  .min(1)
  .max(200)
  .refine((n) => !/https?:\/\/|\d{1,3}(?:[.,]\d{3})+\s*(?:đ|₫|vnd)/i.test(n), "name contains a URL or a price");
// Permanent key: file name, index key, API key. Never derived from race data.
const raceId = z.uuid();

// Fields that come from sources, or from an OpenRace override (everything except
// bookkeeping). Diffs, commit summaries and Discord notifications use these.
export const CANONICAL_FIELDS = [
  "name",
  "types",
  "date",
  "distances",
  "location",
  "priceMin",
  "priceMax",
  "groupPriceMin",
  "currency",
  "registrationStatus",
  "registrationUrl",
  "organizer",
  "foreignerEligible",
] as const;

export const SourceSchema = z.object({
  name: z.enum(SOURCE_NAMES),
  url: z.url(),
  lastCheckedAt: isoDateTime,
  lastChangedAt: isoDateTime,
  // Verbatim Firecrawl extraction for this source (for openrace: the fields we entered).
  // Canonical fields are derived from these, so reconciliation can be re-run later
  // without re-scraping.
  rawExtracted: z.record(z.string(), z.unknown()),
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
    // URL slug for the frontend. Unique, and allowed to change (SEO); for now it's
    // the source's own slug (ActiUp's /vi/event/<slug>). Never used as a key.
    slug,
    name: raceName,
    types: z.array(z.enum(RACE_TYPES)).min(1),
    date: raceDate,
    distances: z.array(z.string().refine(isDistance, "not a distance")),
    location: z.object({
      venue: z.string().min(1).nullable(),
      city: z.string().min(1).nullable(),
      region: z.enum(REGIONS).nullable(),
    }),
    priceMin: price,
    priceMax: price,
    // Cheapest discounted (group) price on bibchung; null when the race isn't on bibchung.
    groupPriceMin: price,
    currency: z.string().regex(/^[A-Z]{3}$/, "expected an ISO 4217 code"),
    registrationStatus: z.enum(REGISTRATION_STATUSES).nullable(),
    registrationUrl: z.url().nullable(),
    organizer: z.string().min(1).nullable(),
    foreignerEligible: z.boolean().nullable(),
    overrides: z.partialRecord(z.enum(CANONICAL_FIELDS), OverrideSchema),
    sources: z.array(SourceSchema).min(1),
    confidence: z.enum(CONFIDENCE_LEVELS),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .refine((r) => r.priceMin === null || r.priceMax === null || r.priceMin <= r.priceMax, {
    message: "priceMin must be <= priceMax",
    path: ["priceMin"],
  })
  .refine((r) => r.createdAt <= r.updatedAt, { message: "createdAt must be <= updatedAt", path: ["updatedAt"] })
  .superRefine((r, ctx) => {
    for (const [field, override] of Object.entries(r.overrides)) {
      if (!deepEqual(r[field as CanonicalField], override?.value)) {
        ctx.addIssue({ code: "custom", message: `${field} must equal its override value`, path: [field] });
      }
    }
  });

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
  lastModified: isoDateTime,
  // Lets ingestion map a source URL to its race without reading every race file,
  // so a renamed race keeps its id instead of forking a new file.
  sourceUrls: z.array(z.url()),
});

export const IndexSchema = z.array(IndexEntrySchema);

export type Region = (typeof REGIONS)[number];
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export type RaceType = (typeof RACE_TYPES)[number];
export type SourceName = (typeof SOURCE_NAMES)[number];
export type ScrapedSourceName = (typeof SCRAPED_SOURCES)[number];
export type RaceSource = z.infer<typeof SourceSchema>;
export type Override = z.infer<typeof OverrideSchema>;
export type Overrides = Race["overrides"];
export type Race = z.infer<typeof RaceSchema>;
export type IndexEntry = z.infer<typeof IndexEntrySchema>;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];
// Every canonical field is a Race field.
const _canonicalFieldsAreRaceFields: readonly (keyof Race)[] = CANONICAL_FIELDS;
void _canonicalFieldsAreRaceFields;
export type CanonicalRace = Pick<Race, CanonicalField>;

export function racePath(id: string): string {
  return `${RACES_DIR}/${id}.json`;
}

/** Stable serialization so identical data always yields byte-identical files. */
export function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

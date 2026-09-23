import { z } from "zod";

export const RACES_DIR = "data/races";
export const INDEX_PATH = "data/index.json";

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
// distances and prices ActiUp hides behind its login.
export const SOURCE_NAMES = ["actiup", "bibchung"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const isoDateTime = z.iso.datetime();
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected kebab-case slug");
// Permanent key: file name, index key, API key. Never derived from race data.
const raceId = z.uuid();

export const SourceSchema = z.object({
  name: z.enum(SOURCE_NAMES),
  url: z.url(),
  lastCheckedAt: isoDateTime,
  lastChangedAt: isoDateTime,
  // Verbatim Firecrawl extraction for this source. Canonical fields are derived
  // from these, so reconciliation can be re-run later without re-scraping.
  rawExtracted: z.record(z.string(), z.unknown()),
});

// `null` means "unknown / not stated by any source", never "false" or "zero".
export const RaceSchema = z
  .object({
    id: raceId,
    // URL slug for the frontend. Unique, and allowed to change (SEO); for now it's
    // the source's own slug (ActiUp's /vi/event/<slug>). Never used as a key.
    slug,
    name: z.string().min(1),
    types: z.array(z.enum(RACE_TYPES)).min(1),
    date: isoDate,
    distances: z.array(z.string().min(1)),
    location: z.object({
      venue: z.string().min(1).nullable(),
      city: z.string().min(1).nullable(),
      region: z.enum(REGIONS).nullable(),
    }),
    priceMin: z.number().int().nonnegative().nullable(),
    priceMax: z.number().int().nonnegative().nullable(),
    // Cheapest discounted (group) price on bibchung; null when the race isn't on bibchung.
    groupPriceMin: z.number().int().nonnegative().nullable(),
    currency: z.string().length(3),
    registrationStatus: z.enum(REGISTRATION_STATUSES).nullable(),
    registrationUrl: z.url().nullable(),
    organizer: z.string().min(1).nullable(),
    foreignerEligible: z.boolean().nullable(),
    sources: z.array(SourceSchema).min(1),
    confidence: z.enum(CONFIDENCE_LEVELS),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .refine((r) => r.priceMin === null || r.priceMax === null || r.priceMin <= r.priceMax, {
    message: "priceMin must be <= priceMax",
    path: ["priceMin"],
  });

export const IndexEntrySchema = z.object({
  id: raceId,
  slug,
  // Name and race day, so a page from another source can be matched to its race
  // without reading every race file.
  name: z.string().min(1),
  date: isoDate,
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
export type RaceSource = z.infer<typeof SourceSchema>;
export type Race = z.infer<typeof RaceSchema>;
export type IndexEntry = z.infer<typeof IndexEntrySchema>;

// Fields that come from sources (everything except bookkeeping). Diffs, commit
// summaries and Discord notifications are all computed over these.
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
] as const satisfies readonly (keyof Race)[];

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];
export type CanonicalRace = Pick<Race, CanonicalField>;

export function racePath(id: string): string {
  return `${RACES_DIR}/${id}.json`;
}

/** Stable serialization so identical data always yields byte-identical files. */
export function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

import { z } from "zod";

export const RACES_DIR = "data/races";
export const INDEX_PATH = "data/index.json";

export const REGIONS = ["north", "central", "south"] as const;
export const REGISTRATION_STATUSES = ["open", "closing_soon", "sold_out", "closed"] as const;

// Only "single-sourced" is produced today. Multi-source reconciliation will add
// values here (e.g. "multi-sourced", "conflicting"); adding enum members is
// backwards compatible, so existing files never need migrating.
export const CONFIDENCE_LEVELS = ["single-sourced"] as const;

// Source names are stable keys; add new ones as ingestion sources are added.
export const SOURCE_NAMES = ["actiup"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const isoDateTime = z.iso.datetime();
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected kebab-case slug");

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
    id: slug,
    name: z.string().min(1),
    date: isoDate,
    distances: z.array(z.string().min(1)),
    location: z.object({
      venue: z.string().min(1).nullable(),
      city: z.string().min(1).nullable(),
      region: z.enum(REGIONS).nullable(),
    }),
    priceMin: z.number().int().nonnegative().nullable(),
    priceMax: z.number().int().nonnegative().nullable(),
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
  id: slug,
  lastModified: isoDateTime,
  // Lets ingestion map a source URL to its existing slug without reading every
  // race file, so a renamed race keeps its id instead of forking a new file.
  sourceUrls: z.array(z.url()),
});

export const IndexSchema = z.array(IndexEntrySchema);

export type Region = (typeof REGIONS)[number];
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export type SourceName = (typeof SOURCE_NAMES)[number];
export type RaceSource = z.infer<typeof SourceSchema>;
export type Race = z.infer<typeof RaceSchema>;
export type IndexEntry = z.infer<typeof IndexEntrySchema>;

// Fields that come from sources (everything except bookkeeping). Diffs, commit
// summaries and Discord notifications are all computed over these.
export const CANONICAL_FIELDS = [
  "name",
  "date",
  "distances",
  "location",
  "priceMin",
  "priceMax",
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

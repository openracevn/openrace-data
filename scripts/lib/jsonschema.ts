/**
 * The data contract as JSON Schema, generated from the zod schemas so it can't
 * drift: consumers (openrace-api) validate against these files, and `validate`
 * fails if they're out of date. Refinements that JSON Schema can't express (e.g.
 * a tier's from <= to, the race-year window) are enforced here, not there.
 */
import { z } from "zod";
import { IndexSchema, OrganizerListSchema, RaceSchema, SCHEMA_VERSION, SeriesListSchema, serialize } from "./schema.ts";

export const SCHEMA_DIR = "schema";

export function jsonSchemaFiles(): Record<string, string> {
  const file = (name: string, title: string, schema: z.ZodType) =>
    serialize({
      ...z.toJSONSchema(schema, { unrepresentable: "any" }),
      $id: `https://openrace.vn/schema/v${SCHEMA_VERSION}/${name}`,
      title,
      "x-schema-version": SCHEMA_VERSION,
    });
  return {
    [`${SCHEMA_DIR}/race.schema.json`]: file("race.schema.json", "OpenRace race (data/races/<slug>-<year>.json)", RaceSchema),
    [`${SCHEMA_DIR}/index.schema.json`]: file("index.schema.json", "OpenRace race index (data/index.json)", IndexSchema),
    [`${SCHEMA_DIR}/series.schema.json`]: file("series.schema.json", "OpenRace series (data/series.json)", SeriesListSchema),
    [`${SCHEMA_DIR}/organizers.schema.json`]: file("organizers.schema.json", "OpenRace organizers (data/organizers.json)", OrganizerListSchema),
  };
}

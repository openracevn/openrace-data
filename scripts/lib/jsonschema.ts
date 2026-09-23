/**
 * The data contract as JSON Schema, generated from the zod schemas so it can't
 * drift: consumers (openrace-api) validate against these files, and `validate`
 * fails if they're out of date. Refinements that JSON Schema can't express (e.g.
 * priceMin <= priceMax, the race-year window) are enforced here, not there.
 */
import { z } from "zod";
import { IndexSchema, RaceSchema, SCHEMA_VERSION, serialize } from "./schema.ts";

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
    [`${SCHEMA_DIR}/race.schema.json`]: file("race.schema.json", "OpenRace race (data/races/<id>.json)", RaceSchema),
    [`${SCHEMA_DIR}/index.schema.json`]: file("index.schema.json", "OpenRace race index (data/index.json)", IndexSchema),
  };
}

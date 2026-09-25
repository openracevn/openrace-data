import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { enrichGeo, geoTargetFromRace, type GeoTarget } from "./lib/geocode.ts";
import { loadPlaces, locationKey, parseGeoCache, type AdminUnits, type Region } from "./lib/geo.ts";
import { INDEX_PATH, IndexSchema, RaceSchema, serialize, upgradeRace } from "./lib/schema.ts";
import { serializeSorted } from "./lib/state.ts";

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const dryRun = args.includes("--dry-run");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;
if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) throw new Error("--limit must be a positive integer");

const index = IndexSchema.parse(JSON.parse(readFileSync(INDEX_PATH, "utf8")));
const targets: GeoTarget[] = index.map((entry) => {
  const path = join("data/races", entry.file);
  const race = RaceSchema.parse(upgradeRace(JSON.parse(readFileSync(path, "utf8"))));
  return geoTargetFromRace(race);
});

const cache = parseGeoCache(existsSync("state/geo.json") ? readFileSync("state/geo.json", "utf8") : null);
let failures = 0;
const enriched = await enrichGeo(targets, cache, {
  refresh,
  ...(limit !== undefined && { limit }),
  onEntry: (next) => {
    if (!dryRun) write("state/geo.json", serializeSorted(next));
  },
  onError: (target, error) => {
    failures++;
    console.error(`geo lookup failed for ${target.name}: ${error.message}`);
  },
});

if (!dryRun) {
  write("data/places.json", serialize(placesData()));
  write("data/admin-units.json", serialize(adminUnitsData()));
}

printSummary(enriched, failures, limit);

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function placesData() {
  return loadPlaces().map(({ id, name, center, radiusKm, region }) => ({ id, name, center, radiusKm, region }));
}

function adminUnitsData(): AdminUnits {
  const current = JSON.parse(readFileSync("ref/units-2025.json", "utf8")) as { provinces: { code: string; name: string }[] };
  const legacy = JSON.parse(readFileSync("ref/units-legacy.json", "utf8")) as {
    provinces: { code: string; name: string }[];
    districts: { code: string; province: string; name: string }[];
  };
  const regions = JSON.parse(readFileSync("ref/regions.json", "utf8")) as { code: string; region: Region }[];
  const regionByCode = new Map(regions.map(({ code, region }) => [code, region]));
  const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);
  return {
    current: {
      provinces: current.provinces
        .map(({ code, name }) => {
          const region = regionByCode.get(code);
          if (!region) throw new Error(`ref/regions.json is missing province ${code} (${name})`);
          return { code, name, region };
        })
        .sort(byCode),
    },
    legacy: {
      provinces: legacy.provinces.map(({ code, name }) => ({ code, name })).sort(byCode),
      districts: legacy.districts.map(({ code, province, name }) => ({ code, province, name })).sort(byCode),
    },
  };
}

function printSummary(result: typeof enriched, failed: number, max: number | undefined): void {
  const source = new Map<string, number>();
  const precision = new Map<string, number>();
  const methods = new Map<string, number>();
  const noPoint: string[] = [];
  const approximate: string[] = [];
  for (const target of targets) {
    const key = locationKey(target.location);
    const entry = key === null ? null : result[key];
    if (entry?.geo) {
      source.set(entry.geo.source, (source.get(entry.geo.source) ?? 0) + 1);
      precision.set(entry.geo.precision, (precision.get(entry.geo.precision) ?? 0) + 1);
      if (entry.geo.precision === "province") approximate.push(target.name);
      for (const value of Object.values(entry.geo.fromPlaces)) methods.set(value.method, (methods.get(value.method) ?? 0) + 1);
    } else {
      noPoint.push(`${target.name}${entry?.note ? ` (${entry.note})` : key === null ? " (no location text)" : ""}`);
    }
  }
  const unprocessed = targets.filter((target) => {
    const key = locationKey(target.location);
    return key !== null && !result[key];
  });
  const lines = [
    `Geo summary: ${targets.length} race(s), ${sourceCount(source)} located, ${noPoint.length} without a point, ${approximate.length} province precision, ${failed} failed${max !== undefined ? `, limit ${max}` : ""}.`,
    `Sources: ${formatCounts(source)}.`,
    `Precision: ${formatCounts(precision)}.`,
    `Routing entries: ${formatCounts(methods)}.`,
    ...(noPoint.length ? [`No point: ${noPoint.join("; ")}`] : []),
    ...(approximate.length ? [`Province precision: ${approximate.join("; ")}`] : []),
    ...(unprocessed.length ? [`Not processed: ${unprocessed.map((target) => target.name).join("; ")}`] : []),
  ];
  console.log(lines.join("\n"));
}

function sourceCount(values: Map<string, number>): number {
  return [...values.values()].reduce((sum, value) => sum + value, 0);
}

function formatCounts(values: Map<string, number>): string {
  return values.size ? [...values].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key} ${value}`).join(", ") : "none";
}

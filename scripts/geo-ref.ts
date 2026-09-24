import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import { foldVietnamese } from "./lib/text.ts";
import { serialize } from "./lib/schema.ts";

const CACHE_DIR = "ref/.cache";
const OUTPUT_DIR = "ref";
const GEOMETRY_ROOT = join(CACHE_DIR, "geojson_11Mar2026");
const SOURCES = [
  {
    file: "geojson_11Mar2026.zip",
    url: "https://raw.githubusercontent.com/thanglequoc/vietnamese-provinces-database/8b78ba5118715e1fa81769286724db79346abf52/dataset-generation-scripts/resources/gis/geojson_11Mar2026.zip",
  },
  {
    file: "wards-2025.csv",
    url: "https://raw.githubusercontent.com/tranngocminhhieu/vietnamadminunits/7fac8c45805aad9916b17237c54baf4502303b93/data/processed/2025_34-province-3221-ward_with_location.csv",
  },
  {
    file: "legacy.csv",
    url: "https://raw.githubusercontent.com/tranngocminhhieu/vietnamadminunits/7fac8c45805aad9916b17237c54baf4502303b93/data/processed/convert_legacy_2025_with_location_and_default_ward.csv",
  },
] as const;

type CsvRow = Record<string, string>;
type Position = [number, number];
type MultiPolygon = Position[][][];
type CurrentProvince = { code: string; name: string; short: string; lat: number; lng: number };
type CurrentWard = { code: string; province: string; name: string; short: string; type: string; lat: number; lng: number };
type LegacyRow = {
  code: string;
  district: string;
  province: string;
  name: string;
  lat: number;
  lng: number;
  newWard: string;
  default: boolean;
};
type WardGeometry = { code: string; province: string; bbox: [number, number, number, number]; polygons: MultiPolygon };
type GeoJson = { features?: { geometry?: { type?: string; coordinates?: unknown } }[] };

await downloadSources();
const wardsCsv = readCsv(join(CACHE_DIR, "wards-2025.csv"));
const legacyCsv = readCsv(join(CACHE_DIR, "legacy.csv"));
const { provinces, wards } = currentUnits(wardsCsv);
const legacy = legacyUnits(legacyCsv);
ensureGeometryExtracted();

const provinceGeometry = readdirSync(GEOMETRY_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const folder = entry.name;
    const path = join(GEOMETRY_ROOT, folder, "province.geojson");
    if (!existsSync(path)) throw new Error(`missing ${path}`);
    const document = readJson(path) as GeoJson;
    const geometry = multiPolygon(document);
    let matches = provinces.filter((province) => pointInMulti([province.lng, province.lat], geometry));
    if (matches.length !== 1) {
      const folded = foldPlaceName(folder.replace(/^\d+_/, ""));
      matches = provinces.filter((province) => placeNamesMatch(folded, province));
    }
    if (matches.length !== 1) throw new Error(`could not match province folder ${folder} (${matches.length} matches)`);
    return { code: matches[0]!.code, path: join(GEOMETRY_ROOT, folder, "wards") };
  });
if (provinceGeometry.length !== provinces.length) throw new Error(`expected ${provinces.length} province folders, found ${provinceGeometry.length}`);

const centers = new Map<string, CurrentWard[]>();
for (const ward of wards) {
  const key = cellKey(ward.lng, ward.lat);
  centers.set(key, [...(centers.get(key) ?? []), ward]);
}

const output: WardGeometry[] = [];
const matchedWards = new Set<string>();
const unmatchedGeometry: string[] = [];
for (const { code: province, path } of provinceGeometry.sort((a, b) => a.code.localeCompare(b.code))) {
  if (!existsSync(path)) continue;
  for (const file of readdirSync(path).filter((name) => name.endsWith(".geojson")).sort()) {
    const pathName = join(path, file);
    const raw = multiPolygon(readJson(pathName) as GeoJson);
    const bbox = rawBbox(raw);
    const inside = centerCandidates(bbox, centers).filter((ward) => pointInMulti([ward.lng, ward.lat], raw));
    let ward: CurrentWard | undefined;
    if (inside.length === 1) ward = inside[0];
    else ward = wards.find((candidate) => candidate.province === province && nameMatchesFile(candidate, file));
    if (!ward || matchedWards.has(ward.code)) {
      unmatchedGeometry.push(pathName);
      continue;
    }
    const polygons = simplifyMulti(raw, 0.0005);
    if (!polygons.length) {
      unmatchedGeometry.push(pathName);
      continue;
    }
    matchedWards.add(ward.code);
    output.push({ code: ward.code, province, bbox: polygonBbox(polygons), polygons });
  }
}

const missingWards = wards.filter((ward) => !matchedWards.has(ward.code));
console.log(`Matched ${matchedWards.size} of ${wards.length} CSV wards to ZIP polygons.`);
if (missingWards.length) console.log(`CSV wards without a polygon: ${missingWards.map((ward) => `${ward.code} ${ward.name}`).join("; ")}`);
if (unmatchedGeometry.length) console.log(`ZIP wards matched to nothing: ${unmatchedGeometry.join("; ")}`);
if (matchedWards.size < 3_300) throw new Error(`only ${matchedWards.size} wards matched; need at least 3300`);

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(join(OUTPUT_DIR, "units-2025.json"), serialize({ provinces, wards }));
writeFileSync(join(OUTPUT_DIR, "units-legacy.json"), serialize(legacy));
const compressed = gzipSync(Buffer.from(JSON.stringify(output)), { level: 9 });
const geometryPath = join(OUTPUT_DIR, "wards-2025.json.gz");
writeFileSync(geometryPath, compressed);
const sizeMb = compressed.length / 1_000_000;
if (sizeMb >= 15) throw new Error(`ref/wards-2025.json.gz is ${sizeMb.toFixed(2)} MB; must be under 15 MB`);
writeFileSync(geometryPath, compressed);
console.log(`Wrote ref/units-2025.json (${provinces.length} provinces, ${wards.length} wards).`);
console.log(`Wrote ref/units-legacy.json (${legacy.provinces.length} provinces, ${legacy.districts.length} districts, ${legacy.wards.length} wards).`);
console.log(`Wrote ref/wards-2025.json.gz (${output.length} polygons, ${sizeMb.toFixed(2)} MB).`);

async function downloadSources(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  for (const source of SOURCES) {
    const path = join(CACHE_DIR, source.file);
    if (existsSync(path)) {
      console.log(`Using cached ${path}`);
      continue;
    }
    console.log(`Downloading ${source.url}`);
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${source.url}`);
    const body = Buffer.from(await response.arrayBuffer());
    writeFileSync(path, body);
    console.log(`Wrote ${path}`);
  }
}

function readCsv(path: string): CsvRow[] {
  const input = readFileSync(path, "utf8");
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      record.push(value);
      value = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      record.push(value);
      if (record.some((cell) => cell !== "")) records.push(record);
      record = [];
      value = "";
    } else value += char;
  }
  if (value || record.length) {
    record.push(value);
    records.push(record);
  }
  const headers = records.shift();
  if (!headers) throw new Error(`${path} is empty`);
  return records.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`${path}:${index + 2} has ${cells.length} fields, expected ${headers.length}`);
    return Object.fromEntries(headers.map((header, i) => [header, cells[i]!]));
  });
}

function currentUnits(rows: CsvRow[]): { provinces: CurrentProvince[]; wards: CurrentWard[] } {
  const provinces = new Map<string, CurrentProvince>();
  const wards: CurrentWard[] = [];
  for (const row of rows) {
    const code = pad(field(row, "provinceCode"), 2);
    if (!provinces.has(code)) {
      provinces.set(code, {
        code,
        name: field(row, "province"),
        short: field(row, "provinceShort"),
        lat: number(field(row, "provinceLat")),
        lng: number(field(row, "provinceLon")),
      });
    }
    wards.push({
      code: pad(field(row, "wardCode"), 5),
      province: code,
      name: field(row, "ward"),
      short: field(row, "wardShort"),
      type: field(row, "wardType"),
      lat: number(field(row, "wardLat")),
      lng: number(field(row, "wardLon")),
    });
  }
  return { provinces: [...provinces.values()], wards };
}

function legacyUnits(rows: CsvRow[]): { provinces: { code: string; name: string }[]; districts: { code: string; province: string; name: string }[]; wards: LegacyRow[] } {
  const byWard = new Map<string, LegacyRow>();
  for (const row of rows) {
    const wardCode = field(row, "wardCode");
    if (!wardCode) continue;
    const ward: LegacyRow = {
      code: pad(wardCode, 5),
      district: pad(field(row, "districtCode"), 3),
      province: pad(field(row, "provinceCode"), 2),
      name: field(row, "ward"),
      lat: number(field(row, "wardLat")),
      lng: number(field(row, "wardLon")),
      newWard: pad(field(row, "newWardCode"), 5),
      default: field(row, "isDefaultNewWard") === "True",
    };
    const previous = byWard.get(ward.code);
    if (!previous || (ward.default && !previous.default)) byWard.set(ward.code, ward);
  }
  const provinces = new Map<string, { code: string; name: string }>();
  const districts = new Map<string, { code: string; province: string; name: string }>();
  for (const ward of byWard.values()) {
    if (!provinces.has(ward.province)) provinces.set(ward.province, { code: ward.province, name: legacyName(rows, "provinceCode", ward.province, 2, "province") });
    if (!districts.has(ward.district)) districts.set(ward.district, { code: ward.district, province: ward.province, name: legacyName(rows, "districtCode", ward.district, 3, "district") });
  }
  return { provinces: [...provinces.values()], districts: [...districts.values()], wards: [...byWard.values()] };
}

function legacyName(rows: CsvRow[], codeField: string, code: string, length: number, nameField: string): string {
  const row = rows.find((candidate) => pad(field(candidate, codeField), length) === code);
  if (!row) throw new Error(`missing legacy ${nameField} ${code}`);
  return field(row, nameField);
}

function ensureGeometryExtracted(): void {
  const folders = existsSync(GEOMETRY_ROOT) ? readdirSync(GEOMETRY_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory()) : [];
  if (folders.length === 34) return;
  if (existsSync(GEOMETRY_ROOT)) rmSync(GEOMETRY_ROOT, { recursive: true, force: true });
  console.log(`Unzipping ${join(CACHE_DIR, "geojson_11Mar2026.zip")}`);
  execFileSync("unzip", ["-oq", join(CACHE_DIR, "geojson_11Mar2026.zip"), "-d", CACHE_DIR], { stdio: "inherit" });
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`);
  }
}

function multiPolygon(document: unknown): MultiPolygon {
  const features = (document as GeoJson).features;
  if (!Array.isArray(features) || features.length !== 1 || features[0]?.geometry?.type !== "MultiPolygon") throw new Error("expected one MultiPolygon feature");
  return features[0]!.geometry!.coordinates as MultiPolygon;
}

function pointInMulti(point: Position, multi: MultiPolygon): boolean {
  return multi.some((polygon) => pointInPolygon(point, polygon));
}

function pointInPolygon(point: Position, polygon: Position[][]): boolean {
  const [outer, ...holes] = polygon;
  return !!outer && pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole));
}

function pointInRing([x, y]: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (onSegment([x, y], [xi, yi], [xj, yj])) return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function onSegment(point: Position, a: Position, b: Position): boolean {
  const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(cross) > 1e-12) return false;
  return point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]) && point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1]);
}

function simplifyMulti(multi: MultiPolygon, tolerance: number): MultiPolygon {
  return multi
    .map((polygon) => polygon.map((ring) => simplifyRing(ring, tolerance)).filter((ring) => ring.length >= 4))
    .filter((polygon) => polygon.length > 0);
}

function simplifyRing(points: Position[], tolerance: number): Position[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const toleranceSquared = tolerance * tolerance;
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let furthest = -1;
    let distance = 0;
    for (let i = first + 1; i < last; i++) {
      const candidate = segmentDistanceSquared(points[i]!, points[first]!, points[last]!);
      if (candidate > distance) {
        distance = candidate;
        furthest = i;
      }
    }
    if (furthest >= 0 && distance > toleranceSquared) {
      keep[furthest] = 1;
      stack.push([first, furthest], [furthest, last]);
    }
  }
  const rounded: Position[] = [];
  for (let i = 0; i < points.length; i++) {
    if (!keep[i]) continue;
    const point: Position = [round5(points[i]![0]), round5(points[i]![1])];
    const previous = rounded.at(-1);
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) rounded.push(point);
  }
  return rounded;
}

function segmentDistanceSquared(point: Position, start: Position, end: Position): number {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = end[0];
      y = end[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

function round5(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

function rawBbox(multi: MultiPolygon): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const polygon of multi) for (const ring of polygon) for (const [lng, lat] of ring) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return [minLng, minLat, maxLng, maxLat];
}

function polygonBbox(multi: MultiPolygon): [number, number, number, number] {
  return rawBbox(multi);
}

function centerCandidates(bbox: [number, number, number, number], index: Map<string, CurrentWard[]>): CurrentWard[] {
  const candidates = new Map<string, CurrentWard>();
  for (let lng = Math.floor(bbox[0]); lng <= Math.floor(bbox[2]); lng++) {
    for (let lat = Math.floor(bbox[1]); lat <= Math.floor(bbox[3]); lat++) {
      for (const ward of index.get(`${lng}:${lat}`) ?? []) candidates.set(ward.code, ward);
    }
  }
  return [...candidates.values()];
}

function cellKey(lng: number, lat: number): string {
  return `${Math.floor(lng)}:${Math.floor(lat)}`;
}

function foldPlaceName(name: string): string {
  return foldVietnamese(name.replace(/^(?:tinh|thu do|tp|thanh pho)\s+/, ""));
}

function placeNamesMatch(folder: string, province: CurrentProvince): boolean {
  const short = foldVietnamese(province.short);
  const name = foldVietnamese(province.name).replace(/^(?:thanh pho|tp)\s+/, "");
  return folder === short || folder === name || folder.includes(short) || short.includes(folder);
}

function nameMatchesFile(ward: CurrentWard, file: string): boolean {
  const name = foldVietnamese(basename(file, ".geojson").replace(/^\d+_/, "").replace(/_(?:xa|phuong|dac_khu)$/i, ""));
  const short = foldVietnamese(ward.short);
  const full = foldVietnamese(ward.name).replace(/^(?:phuong|xa|thi tran|thon)\s+/, "");
  return name === short || name === full;
}

function pad(value: string, length: number): string {
  const digits = value.includes(".") ? value.slice(0, value.indexOf(".")) : value;
  return digits.padStart(length, "0");
}

function field(row: CsvRow, name: string): string {
  const value = row[name];
  if (value === undefined) throw new Error(`missing CSV field ${name}`);
  return value;
}

function number(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`expected a number, got ${value}`);
  return parsed;
}

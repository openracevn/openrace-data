import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parse } from "yaml";
import { z } from "zod";
import { foldVietnamese } from "./text.ts";
import { GeoSchema, type Geo } from "./schema.ts";

const coordinate = z.number().finite();
export const PlaceSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  center: z.tuple([coordinate, coordinate]),
  radiusKm: coordinate.nonnegative(),
  legacy: z.object({ districts: z.array(z.string().regex(/^\d{3}$/)) }),
});
const PlacesFileSchema = z.object({ places: z.array(PlaceSchema) });
export type Place = z.infer<typeof PlaceSchema>;

export const PlacesListSchema = z.array(
  z.object({
    id: PlaceSchema.shape.id,
    name: PlaceSchema.shape.name,
    center: PlaceSchema.shape.center,
    radiusKm: PlaceSchema.shape.radiusKm,
  }),
);

export const AdminUnitsSchema = z.object({
  current: z.object({ provinces: z.array(z.object({ code: z.string().regex(/^\d{2}$/), name: z.string().min(1) })) }),
  legacy: z.object({
    provinces: z.array(z.object({ code: z.string().regex(/^\d{2}$/), name: z.string().min(1) })),
    districts: z.array(z.object({ code: z.string().regex(/^\d{3}$/), province: z.string().regex(/^\d{2}$/), name: z.string().min(1) })),
  }),
});
export type AdminUnits = z.infer<typeof AdminUnitsSchema>;

export const GEO_PATH = "state/geo.json";
export const GeoCacheEntrySchema = z.object({
  geo: GeoSchema.nullable(),
  query: z.string(),
  at: z.iso.datetime(),
  note: z.string().optional(),
});
export const GeoCacheSchema = z.record(z.string(), GeoCacheEntrySchema);
export type GeoCacheEntry = z.infer<typeof GeoCacheEntrySchema>;
export type GeoCache = z.infer<typeof GeoCacheSchema>;

export function parseGeoCache(text: string | null): GeoCache {
  return text ? GeoCacheSchema.parse(JSON.parse(text)) : {};
}

type CurrentProvince = { code: string; name: string; short: string; lat: number; lng: number };
type CurrentWard = { code: string; province: string; name: string; short: string; type: string; lat: number; lng: number };
type LegacyWard = { code: string; district: string; province: string; name: string; lat: number; lng: number; newWard: string };
type Position = [number, number];
type MultiPolygon = Position[][][];
type WardGeometry = { code: string; province: string; bbox: [number, number, number, number]; polygons: MultiPolygon };
type References = {
  provinces: CurrentProvince[];
  wards: CurrentWard[];
  legacyWards: LegacyWard[];
  geometries: WardGeometry[];
};
type Location = {
  current: { province: string; ward: string | null };
  legacy: { province: string; district: string | null; ward: string | null } | null;
  special: boolean;
};

let references: References | null = null;

export function loadPlaces(path = "config/places.yaml"): Place[] {
  return PlacesFileSchema.parse(parse(readFileSync(path, "utf8"))).places;
}

export function haversineKm(a: [number, number], b: [number, number]): number {
  const radians = Math.PI / 180;
  const lat1 = a[0] * radians;
  const lat2 = b[0] * radians;
  const dLat = (b[0] - a[0]) * radians;
  const dLng = (b[1] - a[1]) * radians;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 6_371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function locate(lat: number, lng: number): Location | null {
  const ref = loadReferences();
  let geometry = ref.geometries.find((candidate) => inBbox([lng, lat], candidate.bbox) && pointInMulti([lng, lat], candidate.polygons));
  if (!geometry) {
    const nearest = nearestVertex(lat, lng, ref.geometries);
    if (!nearest || nearest.km > 3) return null;
    geometry = ref.geometries.find((candidate) => candidate.code === nearest.code);
  }
  if (!geometry) return null;
  const ward = ref.wards.find((candidate) => candidate.code === geometry.code);
  if (!ward) return null;
  const current = { province: geometry.province, ward: geometry.code };
  const mapped = ref.legacyWards.filter((candidate) => candidate.newWard === current.ward);
  const sameProvince = ref.legacyWards.filter((candidate) => candidate.newWard.slice(0, 2) === current.province);
  const legacyWard = nearestWard(lat, lng, mapped.length ? mapped : sameProvince);
  return {
    current,
    legacy: legacyWard ? { province: legacyWard.province, district: legacyWard.district, ward: legacyWard.code } : null,
    special: ward.type === "Đặc khu" && ward.code !== "06994",
  };
}

export function locationKey(location: { venue: string | null; city: string | null }): string | null {
  if (location.venue === null && location.city === null) return null;
  return [foldVietnamese(location.venue ?? ""), foldVietnamese(location.city ?? "")].join(" | ");
}

export function parseMapsUrl(url: string): [number, number] | null {
  const text = url.trim();
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {}
  let parsed: URL | null = null;
  try {
    parsed = new URL(text);
  } catch {}
  if (parsed && (parsed.hostname === "maps.app.goo.gl" || (parsed.hostname === "goo.gl" && parsed.pathname.startsWith("/maps")))) return null;
  const at = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) return validPoint(at[1]!, at[2]!);
  const bang = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (bang) return validPoint(bang[1]!, bang[2]!);
  if (parsed) {
    for (const key of ["q", "query"]) {
      const query = parsed.searchParams.get(key);
      const point = query?.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
      if (point) return validPoint(point[1]!, point[2]!);
    }
  }
  const bare = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  return bare ? validPoint(bare[1]!, bare[2]!) : null;
}

export function isNear(geo: Pick<Geo, "lat" | "lng" | "legacy">, place: Place): boolean {
  return haversineKm([geo.lat, geo.lng], place.center) <= place.radiusKm || (geo.legacy?.district !== null && geo.legacy?.district !== undefined && place.legacy.districts.includes(geo.legacy.district));
}

function loadReferences(): References {
  if (references) return references;
  const current = JSON.parse(readFileSync("ref/units-2025.json", "utf8")) as { provinces: CurrentProvince[]; wards: CurrentWard[] };
  const legacy = JSON.parse(readFileSync("ref/units-legacy.json", "utf8")) as { wards: LegacyWard[] };
  const geometries = JSON.parse(gunzipSync(readFileSync("ref/wards-2025.json.gz")).toString("utf8")) as WardGeometry[];
  if (!Array.isArray(current.provinces) || !Array.isArray(current.wards) || !Array.isArray(legacy.wards) || !Array.isArray(geometries)) throw new Error("invalid reference data in ref/");
  references = { provinces: current.provinces, wards: current.wards, legacyWards: legacy.wards, geometries };
  return references;
}

function inBbox([lng, lat]: Position, bbox: [number, number, number, number]): boolean {
  return lng >= bbox[0] && lat >= bbox[1] && lng <= bbox[2] && lat <= bbox[3];
}

function pointInMulti(point: Position, multi: MultiPolygon): boolean {
  return multi.some((polygon) => {
    const [outer, ...holes] = polygon;
    return !!outer && pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole));
  });
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
  return Math.abs(cross) <= 1e-12 && point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]) && point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1]);
}

function nearestVertex(lat: number, lng: number, geometries: WardGeometry[]): { code: string; km: number } | null {
  let best: { code: string; km: number } | null = null;
  const latPad = 3 / 111;
  const lngPad = 3 / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  for (const geometry of geometries) {
    if (lng < geometry.bbox[0] - lngPad || lat < geometry.bbox[1] - latPad || lng > geometry.bbox[2] + lngPad || lat > geometry.bbox[3] + latPad) continue;
    for (const polygon of geometry.polygons) for (const ring of polygon) for (const vertex of ring) {
      if (Math.abs(vertex[0] - lng) > lngPad || Math.abs(vertex[1] - lat) > latPad) continue;
      const km = haversineKm([lat, lng], [vertex[1], vertex[0]]);
      if (!best || km < best.km) best = { code: geometry.code, km };
    }
  }
  return best;
}

function nearestWard(lat: number, lng: number, wards: LegacyWard[]): LegacyWard | null {
  let best: LegacyWard | null = null;
  let bestKm = Infinity;
  for (const ward of wards) {
    const km = haversineKm([lat, lng], [ward.lat, ward.lng]);
    if (km < bestKm) {
      best = ward;
      bestKm = km;
    }
  }
  return best;
}

function validPoint(lat: string, lng: string): [number, number] | null {
  const point: [number, number] = [Number(lat), Number(lng)];
  return Number.isFinite(point[0]) && Number.isFinite(point[1]) && point[0] >= -90 && point[0] <= 90 && point[1] >= -180 && point[1] <= 180 ? point : null;
}

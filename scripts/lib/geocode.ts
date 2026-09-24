import { env } from "./env.ts";
import { haversineKm, isNear, loadPlaces, locate, locationKey, parseMapsUrl, type GeoCache, type GeoCacheEntry, type Place } from "./geo.ts";
import { foldVietnamese } from "./text.ts";
import type { Geo, Race } from "./schema.ts";

const USER_AGENT = "openrace-data/0.1 (https://github.com/openracevn/openrace-data)";
const REQUEST_GAP_MS = 1_000;
const VIETNAM = { minLat: 8, maxLat: 24, minLng: 102, maxLng: 110 } as const;
let nextRequestAt = 0;

export type GeoTarget = {
  id: string;
  name: string;
  types: readonly string[];
  location: { venue: string | null; city: string | null };
  mapsUrls?: readonly string[];
};

export type EnrichGeoOptions = {
  refresh?: boolean;
  limit?: number;
  onEntry?: (cache: GeoCache, key: string) => void;
  onError?: (target: GeoTarget, error: Error) => void;
};

export async function enrichGeo(targets: readonly GeoTarget[], initial: GeoCache, options: EnrichGeoOptions = {}): Promise<GeoCache> {
  const cache: GeoCache = { ...initial };
  const seen = new Set<string>();
  let lookups = 0;
  for (const target of targets) {
    const key = locationKey(target.location);
    if (key === null || seen.has(key)) continue;
    if (!options.refresh && cache[key]) continue;
    if (options.limit !== undefined && lookups >= options.limit) break;
    seen.add(key);
    lookups++;
    try {
      const entry = isVirtual(target) ? virtualEntry(key) : await lookupEntry(target, key);
      cache[key] = entry;
      options.onEntry?.(cache, key);
    } catch (error) {
      options.onError?.(target, error as Error);
    }
  }
  return cache;
}

export async function manualGeo(lat: number, lng: number): Promise<Geo> {
  return buildGeo(lat, lng, "manual", "venue");
}

export function geoTargetFromRace(race: Pick<Race, "id" | "name" | "types" | "location" | "sources" | "links">): GeoTarget {
  const fromExtraction = race.sources.flatMap((source) => geoTargetFromExtraction(source.extracted)?.mapsUrls ?? []);
  return {
    id: race.id,
    name: race.name,
    types: race.types,
    location: race.location,
    mapsUrls: [...new Set([...fromExtraction, ...race.links.map((link) => link.url).filter(isGoogleMapsUrl)])],
  };
}

export function geoTargetFromExtraction(input: unknown): GeoTarget | null {
  if (!isRecord(input)) return null;
  const mapsUrls = new Set<string>();
  if (isRecord(input.facts) && typeof input.facts.mapsUrl === "string") mapsUrls.add(input.facts.mapsUrl);
  if (Array.isArray(input.pages)) {
    for (const page of input.pages) {
      if (isRecord(page) && isRecord(page.json) && typeof page.json.mapsUrl === "string") mapsUrls.add(page.json.mapsUrl);
    }
  }
  if (Array.isArray(input.links)) {
    for (const link of input.links) {
      if (isRecord(link) && typeof link.url === "string" && isGoogleMapsUrl(link.url)) mapsUrls.add(link.url);
    }
  }
  return { id: "", name: "", types: [], location: { venue: null, city: null }, mapsUrls: [...mapsUrls] };
}

async function lookupEntry(target: GeoTarget, key: string): Promise<GeoCacheEntry> {
  const point = await pointFor(target);
  const located = point ? locate(point.lat, point.lng) : null;
  if (point && located) {
    const geo = await buildGeo(point.lat, point.lng, point.source, point.precision, located);
    return { geo, query: point.query, at: new Date().toISOString() };
  }
  // Old city names ("Nha Trang", "Vũng Tàu") are no longer units: Nominatim finds nothing,
  // or the centroid of the old boundary out at sea. A venue that names one of our places
  // gets that place's centre, marked as coarse as a province.
  const place = placeNamed(target.location);
  if (place) {
    const geo = await buildGeo(place.center[0], place.center[1], "place", "province");
    return { geo, query: place.name, at: new Date().toISOString(), note: point ? "geocoded point outside the wards; used the place's centre" : "no point found; used the place's centre" };
  }
  if (!point) return { geo: null, query: queries(target.location)[0] ?? key, at: new Date().toISOString(), note: "no point found" };
  return { geo: null, query: point.query, at: new Date().toISOString(), note: "point outside Vietnam's wards" };
}

function placeNamed(location: GeoTarget["location"]): Place | null {
  const text = ` ${foldVietnamese([location.venue, location.city].filter(Boolean).join(" "))} `;
  return loadPlaces().find((p) => text.includes(` ${foldVietnamese(p.name)} `)) ?? null;
}

async function buildGeo(lat: number, lng: number, source: Geo["source"], precision: Geo["precision"], located = locate(lat, lng)): Promise<Geo> {
  if (!located) throw new Error("point outside Vietnam's wards");
  const places = loadPlaces();
  const base: Geo = {
    lat,
    lng,
    source,
    precision,
    current: located.current,
    legacy: located.legacy,
    access: located.special ? "flight_or_ferry" : "road",
    fromPlaces: {},
  };
  base.fromPlaces = await fromPlaces(base, places);
  return base;
}

async function fromPlaces(geo: Geo, places: readonly Place[]): Promise<Geo["fromPlaces"]> {
  const straight = new Map<string, Geo["fromPlaces"][string]>();
  for (const place of places) {
    straight.set(place.id, {
      km: round1(haversineKm([geo.lat, geo.lng], place.center)),
      minutes: null,
      method: "straight_line",
      near: isNear(geo, place),
    });
  }
  if (geo.access === "flight_or_ferry" || geo.precision === "province") return Object.fromEntries(straight);
  const matrix = await routingMatrix(geo, places);
  if (!matrix) return Object.fromEntries(straight);
  const destinationSnapped = matrix.destination && haversineKm([geo.lat, geo.lng], [matrix.destination[1], matrix.destination[0]]) > 5;
  return Object.fromEntries(
    places.map((place, index) => {
      const km = matrix.distances[index];
      const minutes = matrix.minutes[index];
      const fallback = straight.get(place.id)!;
      if (destinationSnapped || km === null || km === undefined || !Number.isFinite(km) || minutes === null || minutes === undefined || !Number.isFinite(minutes)) return [place.id, fallback];
      return [place.id, { km: round1(km), minutes: Math.max(0, Math.round(minutes)), method: "road" as const, near: fallback.near }];
    }),
  );
}

async function routingMatrix(geo: Geo, places: readonly Place[]): Promise<{ distances: (number | null)[]; minutes: (number | null)[]; destination: [number, number] | null } | null> {
  const locations: [number, number][] = [[geo.lng, geo.lat], ...places.map((place): [number, number] => [place.center[1], place.center[0]])];
  try {
    const key = env("ORS_API_KEY");
    if (key) {
      const response = await rateFetch("https://api.openrouteservice.org/v2/matrix/driving-car", {
        method: "POST",
        headers: { Authorization: key, "Content-Type": "application/json", "User-Agent": USER_AGENT },
        body: JSON.stringify({ locations, sources: places.map((_, index) => index + 1), destinations: [0], metrics: ["distance", "duration"], units: "km" }),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { distances?: unknown[][]; durations?: unknown[][] };
      return {
        distances: numericRow(body.distances?.[0], places.length, 1),
        minutes: numericRow(body.durations?.[0], places.length, 60),
        destination: null,
      };
    }
    const coordinates = locations.map(([lng, lat]) => `${lng},${lat}`).join(";");
    const query = new URLSearchParams({
      sources: places.map((_, index) => index + 1).join(";"),
      destinations: "0",
      annotations: "distance,duration",
    });
    const response = await rateFetch(`https://router.project-osrm.org/table/v1/driving/${coordinates}?${query}`, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) return null;
    const body = (await response.json()) as { distances?: unknown[][]; durations?: unknown[][]; locations?: { location?: unknown }[] };
    const snapped = body.locations?.[0]?.location;
    const destination = coordinatePair(snapped);
    return {
      distances: numericColumn(body.distances, places.length, 1_000),
      minutes: numericColumn(body.durations, places.length, 60),
      destination,
    };
  } catch {
    return null;
  }
}

async function pointFor(target: GeoTarget): Promise<{ lat: number; lng: number; source: Geo["source"]; precision: Geo["precision"]; query: string } | null> {
  for (const url of target.mapsUrls ?? []) {
    const point = await mapsPoint(url);
    if (point) return { lat: point[0], lng: point[1], source: "maps_link", precision: "venue", query: url };
  }
  for (const query of queries(target.location)) {
    const result = await nominatim(query);
    if (result) return { ...result, source: "nominatim", query };
  }
  return null;
}

async function mapsPoint(url: string): Promise<[number, number] | null> {
  const direct = parseMapsUrl(url);
  if (direct) return direct;
  if (!isShortMapsUrl(url)) return null;
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const response = await rateFetch(url, { method, redirect: "follow", headers: { "User-Agent": USER_AGENT } });
      const point = parseMapsUrl(response.url);
      if (point) return point;
      if (method === "HEAD" && response.status >= 400) continue;
      if (response.status >= 400) break;
    } catch {
      if (method === "GET") break;
    }
  }
  return null;
}

async function nominatim(query: string): Promise<{ lat: number; lng: number; precision: Geo["precision"] } | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({ format: "jsonv2", countrycodes: "vn", limit: "1", addressdetails: "1", q: query }).toString();
  const response = await rateFetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Nominatim ${response.status} ${response.statusText}`);
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) return null;
  for (const value of body) {
    if (!isRecord(value)) continue;
    const lat = Number(value.lat);
    const lng = Number(value.lon);
    if (!inVietnam(lat, lng)) continue;
    return { lat, lng, precision: precisionOf(value.addresstype, value.type) };
  }
  return null;
}

function queries(location: GeoTarget["location"]): string[] {
  const venue = location.venue?.trim() ?? "";
  const city = location.city?.trim() ?? "";
  // Venues are written like addresses ("Công Viên Hồ Bán Nguyệt, Quận 7, TP. Hồ Chí Minh")
  // and often use pre-2025 units Nominatim no longer finds. Drop leading parts one at a
  // time, so at worst the province is found (precision then says how coarse it is).
  const parts = venue.split(",").map((p) => p.trim()).filter(Boolean);
  const tails = parts.slice(1).map((_, i) => parts.slice(i + 1).join(", "));
  return [
    ...new Set(
      [venue && city ? `${venue}, ${city}` : "", venue, ...tails, city].map((query) => query.replace(/\s+/g, " ").trim()).filter(Boolean),
    ),
  ];
}

function precisionOf(addressType: unknown, type: unknown): Geo["precision"] {
  const value = typeof addressType === "string" ? addressType : typeof type === "string" ? type : "";
  if (["suburb", "quarter", "village", "town", "municipality"].includes(value)) return "ward";
  if (["state", "province", "city", "county", "historic", "administrative"].includes(value)) return "province";
  return "venue";
}

function virtualEntry(key: string): GeoCacheEntry {
  return { geo: null, query: key, at: new Date().toISOString(), note: "virtual race" };
}

export function isVirtual(target: Pick<GeoTarget, "name" | "types" | "location">): boolean {
  if (target.types.some((type) => /virtual|online/.test(foldVietnamese(type)))) return true;
  return [target.name, target.location.venue].some((value) => value !== null && /virtual|online|truc tuyen/.test(foldVietnamese(value)));
}

function isGoogleMapsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "maps.app.goo.gl" || url.hostname === "goo.gl" || /(^|\.)google\.(com|com\.vn)$/.test(url.hostname);
  } catch {
    return false;
  }
}

function isShortMapsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "maps.app.goo.gl" || (url.hostname === "goo.gl" && url.pathname.startsWith("/maps"));
  } catch {
    return false;
  }
}

function inVietnam(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= VIETNAM.minLat && lat <= VIETNAM.maxLat && lng >= VIETNAM.minLng && lng <= VIETNAM.maxLng;
}

function numericRow(value: unknown, length: number, divisor: number): (number | null)[] {
  const row = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_, index) => {
    const number = row[index];
    return typeof number === "number" && Number.isFinite(number) ? number / divisor : null;
  });
}

function numericColumn(value: unknown, length: number, divisor: number): (number | null)[] {
  const matrix = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_, index) => {
    const number = Array.isArray(matrix[index]) ? matrix[index][0] : null;
    return typeof number === "number" && Number.isFinite(number) ? number / divisor : null;
  });
}

function coordinatePair(value: unknown): [number, number] | null {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number" ? [value[0], value[1]] : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

async function rateFetch(input: string | URL, init: RequestInit): Promise<Response> {
  const wait = Math.max(0, nextRequestAt - Date.now());
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  nextRequestAt = Date.now() + REQUEST_GAP_MS;
  return fetch(input, init);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

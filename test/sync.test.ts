import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCandidate, isRefreshDue, vietnamDate, type Check } from "../scripts/lib/checks.ts";
import { normalizeDistance, normalizeExtracted } from "../scripts/lib/extraction.ts";
import { resolvePlace } from "../scripts/lib/places.ts";
import { INDEX_PATH, RaceSchema, racePath, type IndexEntry, type Race } from "../scripts/lib/schema.ts";
import { formatCommitMessage, planSync, type RaceStore, type SyncInput } from "../scripts/sync.ts";

const URL_A = "https://actiup.net/vi/event/tay-ho-half-marathon-2026";
const URL_B = "https://actiup.net/vi/event/da-lat-ultra-trail-2026";

const extractedA = {
  pageKind: "sport",
  types: ["road_run"],
  name: "Tay Ho Half Marathon 2026",
  date: "2026-11-15",
  distances: ["21.1K", "5 km", "10km"],
  venue: "Tay Ho Lake",
  city: "Hà Nội",
  priceMin: 300000,
  priceMax: 800000,
  currency: "VND",
  registrationStatus: "open",
  registrationUrl: "https://actiup.net/vi/event/tay-ho-half-marathon-2026/register",
  organizer: "Tay Ho Sports",
  foreignerEligible: true,
};

// Deterministic UUIDs so tests can name files; every planSync call gets fresh ones.
let idCounter = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}`;
const plan = (store: RaceStore, inputs: SyncInput[], now?: string) => planSync(store, inputs, now, nextId);

function memoryStore(files: Record<string, string> = {}): RaceStore & { files: Record<string, string> } {
  return { files, read: async (p) => files[p] ?? null };
}

function input(url: string, extracted: Record<string, unknown>, checkedAt = "2026-09-23T10:00:00.000Z"): SyncInput {
  return { url, extracted, checkedAt };
}

async function seeded(): Promise<RaceStore & { files: Record<string, string>; id: string }> {
  const store = memoryStore();
  const first = await plan(store, [input(URL_A, extractedA, "2026-09-20T08:00:00.000Z")], "2026-09-20T08:00:05.000Z");
  Object.assign(store.files, first.files);
  return { ...store, id: first.changes[0]!.id };
}

describe("planSync", () => {
  it("creates a new race file and index entry", async () => {
    const p = await plan(memoryStore(), [input(URL_A, extractedA)], "2026-09-23T10:00:05.000Z");
    const id = p.changes[0]!.id;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(p.changes, [{ id, slug: "tay-ho-half-marathon-2026", kind: "added", fields: [] }]);

    const race = RaceSchema.parse(JSON.parse(p.files[racePath(id)]!));
    assert.equal(race.slug, "tay-ho-half-marathon-2026");
    assert.deepEqual(race.types, ["road_run"]);
    assert.deepEqual(race.distances, ["5km", "10km", "21km"]);
    assert.deepEqual(race.location, { venue: "Tay Ho Lake", city: "Hanoi", region: "north" });
    assert.equal(race.confidence, "single-sourced");
    assert.equal(race.sources.length, 1);
    assert.equal(race.sources[0]!.lastChangedAt, "2026-09-23T10:00:00.000Z");
    assert.deepEqual(race.sources[0]!.rawExtracted, extractedA);
    assert.equal(race.createdAt, race.updatedAt);

    const index = JSON.parse(p.files[INDEX_PATH]!) as IndexEntry[];
    assert.deepEqual(index, [{ id, slug: "tay-ho-half-marathon-2026", lastModified: "2026-09-23T10:00:05.000Z", sourceUrls: [URL_A] }]);
  });

  it("writes nothing when the extraction is unchanged", async () => {
    const store = await seeded();
    const p = await plan(store, [input(URL_A, { ...extractedA, distances: ["5K", "10 km", "Half Marathon"] })]);
    assert.deepEqual(p.files, {});
    assert.deepEqual(p.changes, []);
  });

  it("updates changed fields and bumps updatedAt + source lastChangedAt", async () => {
    const store = await seeded();
    const p = await plan(
      store,
      [input(URL_A, { ...extractedA, registrationStatus: "sold_out", priceMax: 900000 }, "2026-09-23T10:00:00.000Z")],
      "2026-09-23T10:00:05.000Z",
    );
    assert.deepEqual(p.changes, [{ id: store.id, slug: "tay-ho-half-marathon-2026", kind: "updated", fields: ["priceMax", "registrationStatus"] }]);
    const race = JSON.parse(p.files[racePath(store.id)]!) as Race;
    assert.equal(race.createdAt, "2026-09-20T08:00:05.000Z");
    assert.equal(race.updatedAt, "2026-09-23T10:00:05.000Z");
    assert.equal(race.sources[0]!.lastChangedAt, "2026-09-23T10:00:00.000Z");
    assert.equal(race.registrationStatus, "sold_out");
    assert.match(formatCommitMessage(p), /^data: 1 updated\n\n~ tay-ho-half-marathon-2026: priceMax, registrationStatus$/);
  });

  it("ignores rewording of venue and organizer, but not a real move", async () => {
    const store = await seeded();
    const reworded = await plan(store, [input(URL_A, { ...extractedA, venue: "Tay Ho Lake area", organizer: "Tay Ho Sports JSC" })]);
    assert.deepEqual(reworded.files, {});
    const withAddress = await plan(store, [input(URL_A, { ...extractedA, venue: "Tay Ho Lake, Phường Tây Hồ, TP. Hà Nội" })]);
    assert.deepEqual(withAddress.files, {});
    const moved = await plan(store, [input(URL_A, { ...extractedA, venue: "My Dinh Stadium" })]);
    assert.deepEqual(moved.changes[0]!.fields, ["location"]);
  });

  it("keeps the id and slug when a race is renamed", async () => {
    const store = await seeded();
    const p = await plan(store, [input(URL_A, { ...extractedA, name: "VPBank Tay Ho Half Marathon 2026" })]);
    assert.deepEqual(Object.keys(p.files).sort(), [INDEX_PATH, racePath(store.id)]);
    assert.deepEqual(p.changes[0]!.fields, ["name"]);
    assert.equal(p.changes[0]!.slug, "tay-ho-half-marathon-2026");
  });

  it("keeps a hand-edited slug on refresh", async () => {
    const store = await seeded();
    const path = racePath(store.id);
    const race = JSON.parse(store.files[path]!) as Race;
    store.files[path] = JSON.stringify({ ...race, slug: "tay-ho-hm" });
    const p = await plan(store, [input(URL_A, { ...extractedA, registrationStatus: "sold_out" })]);
    assert.equal((JSON.parse(p.files[path]!) as Race).slug, "tay-ho-hm");
  });

  it("batches several races into one plan and deduplicates URLs", async () => {
    const store = await seeded();
    const p = await plan(store, [
      input(URL_B, { pageKind: "sport", name: "Da Lat Ultra Trail", date: "2026-06-20", city: "Đà Lạt", distances: ["70km", "42km"] }),
      input(`${URL_A}?ref=x#y`, extractedA), // same page as the seeded race, unchanged
      input("https://actiup.net/vi/event/vung-tau-trail", { ...extractedA, name: "Vung Tau Trail" }),
    ]);
    assert.deepEqual(p.changes.map((c) => [c.slug, c.kind]), [["da-lat-ultra-trail-2026", "added"], ["vung-tau-trail", "added"]]);
    const index = JSON.parse(p.files[INDEX_PATH]!) as IndexEntry[];
    assert.equal(new Set(index.map((e) => e.id)).size, 3);
  });

  it("suffixes a new race's slug when another race already uses it", async () => {
    const store = await seeded();
    const path = racePath(store.id);
    const race = JSON.parse(store.files[path]!) as Race;
    // The seeded race was hand-renamed to the slug the next new race would get.
    store.files[path] = JSON.stringify({ ...race, slug: "da-lat-ultra-trail-2026" });
    const index = JSON.parse(store.files[INDEX_PATH]!) as IndexEntry[];
    store.files[INDEX_PATH] = JSON.stringify(index.map((e) => ({ ...e, slug: "da-lat-ultra-trail-2026" })));
    const p = await plan(store, [input(URL_B, { pageKind: "sport", name: "Da Lat Ultra Trail", date: "2026-06-20" })]);
    assert.equal(p.changes[0]!.slug, "da-lat-ultra-trail-2026-2");
  });

  it("skips non-event pages and unusable extractions", async () => {
    const p = await plan(memoryStore(), [
      input("https://actiup.net/vi/events/sports", extractedA),
      input("https://actiup.net/vi/event/6ab0cd39c8f626a86b6342e8/tickets", extractedA),
      input("https://actiup.net/en/event/tay-ho-half-marathon-2026", extractedA),
      input(URL_B, { pageKind: "non_sport", name: "Da Lat Music Night", date: "2026-06-20" }),
      input("https://actiup.net/vi/event/no-date", { pageKind: "sport", name: "No Date Run" }),
    ]);
    assert.deepEqual(p.files, {});
    assert.equal(p.skipped.length, 5);
  });
});

describe("normalization", () => {
  it("snaps standard distances", () => {
    assert.equal(normalizeDistance("42.195 KM"), "42km");
    assert.equal(normalizeDistance("Half Marathon"), "21km");
    assert.equal(normalizeDistance("Full Marathon"), "42km");
    assert.equal(normalizeDistance("Ultra Marathon 70K"), "70km");
    assert.equal(normalizeDistance("12,5km"), "12.5km");
    assert.equal(normalizeDistance("100MILES"), "100mi");
  });

  it("resolves Vietnamese city names to display name + region", () => {
    assert.deepEqual(resolvePlace("TP. Hồ Chí Minh"), { city: "Ho Chi Minh City", region: "south" });
    assert.deepEqual(resolvePlace("Đà Nẵng"), { city: "Da Nang", region: "central" });
    assert.deepEqual(resolvePlace("Tỉnh Lào Cai"), { city: "Lao Cai", region: "north" });
    assert.deepEqual(resolvePlace("Thành Phố Đà Lạt, Tỉnh Lâm Đồng"), { city: "Da Lat", region: "central" });
    assert.deepEqual(resolvePlace("Atlantis"), { city: "Atlantis", region: null });
    const venue = "Quảng trường Văn Miếu, Phường Cao Lãnh, Tỉnh Đồng Tháp";
    for (const city of ["Cao Lãnh", "Đồng Tháp"]) {
      const r = normalizeExtracted({ pageKind: "sport", name: "X", date: "2026-10-09", city, venue });
      assert.ok(r.ok && r.race.location.city === "Dong Thap" && r.race.location.region === "south", city);
    }
  });

  it("keeps every sport and normalizes its types", () => {
    const types = (raw: Record<string, unknown>) => {
      const r = normalizeExtracted({ pageKind: "sport", date: "2027-03-21", ...raw });
      assert.ok(r.ok);
      return r.race.types;
    };
    assert.deepEqual(types({ name: "Vietnam FesTRIval 2027", types: ["aquathlon", "road_run"] }), ["road_run", "triathlon", "aquathlon"]);
    assert.deepEqual(types({ name: "Sơn Trà City Trail 2026", types: ["trail_run"] }), ["city_trail"]);
    assert.deepEqual(types({ name: "Vietnam MTB Series", types: ["mtb", "mtb", "bogus"] }), ["mtb"]);
    assert.deepEqual(types({ name: "Open Water Swim", types: [] }), ["other"]);
    assert.deepEqual(types({ name: "Tri Tôn Mountain Run", types: ["trail_run"] }), ["trail_run"]);
    assert.equal(normalizeExtracted({ pageKind: "non_sport", name: "Music Night", date: "2027-03-21" }).ok, false);
    assert.equal(normalizeExtracted({ pageKind: "none" }).ok, false);
  });

  it("parses DD/MM/YYYY dates and string prices", () => {
    const r = normalizeExtracted({ pageKind: "sport", name: "X", date: "5/1/2027", priceMin: "350.000đ", priceMax: "200000" });
    assert.ok(r.ok);
    assert.equal(r.race.date, "2027-01-05");
    assert.equal(r.race.priceMin, 200000);
    assert.equal(r.race.priceMax, 350000);
    assert.equal(r.race.registrationStatus, null);
  });

});

describe("check schedule", () => {
  const now = new Date("2026-09-23T01:00:00.000Z");
  const today = vietnamDate(now);
  const daysAgo = (d: number, status: Check["status"] = "ok", permanent?: boolean): Check => ({
    lastCheckedAt: new Date(now.getTime() - d * 86_400_000).toISOString(),
    status,
    ...(permanent && { permanent }),
  });

  it("uses Vietnam's date", () => {
    assert.equal(vietnamDate(new Date("2026-09-22T18:00:00.000Z")), "2026-09-23");
  });

  it("re-checks upcoming races every 14 days, including race day", () => {
    assert.equal(isRefreshDue("2026-12-01", undefined, today, now), true);
    assert.equal(isRefreshDue("2026-12-01", daysAgo(13), today, now), false);
    assert.equal(isRefreshDue("2026-12-01", daysAgo(14), today, now), true);
    assert.equal(isRefreshDue(today, daysAgo(20), today, now), true);
  });

  it("never re-checks a race that has passed", () => {
    assert.equal(isRefreshDue("2026-09-22", daysAgo(100), today, now), false);
    assert.equal(isRefreshDue("2026-09-22", undefined, today, now), false);
  });

  it("retries a failed check after 3 days", () => {
    assert.equal(isRefreshDue("2026-12-01", daysAgo(2, "error"), today, now), false);
    assert.equal(isRefreshDue("2026-12-01", daysAgo(3, "error"), today, now), true);
  });

  it("discovers unseen pages, retries transient rejections, skips permanent ones", () => {
    assert.equal(isCandidate(undefined, now), true);
    assert.equal(isCandidate(daysAgo(1, "rejected"), now), false);
    assert.equal(isCandidate(daysAgo(3, "rejected"), now), true);
    assert.equal(isCandidate(daysAgo(400, "rejected", true), now), false);
  });
});

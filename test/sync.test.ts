import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitMessages } from "../scripts/lib/changes.ts";
import { isCandidate, isRefreshDue, vietnamDate, type Check } from "../scripts/lib/checks.ts";
import { normalizeDistance, normalizeExtracted } from "../scripts/lib/extraction.ts";
import { resolvePlace } from "../scripts/lib/places.ts";
import { INDEX_PATH, RaceSchema, racePath, type IndexEntry, type Race } from "../scripts/lib/schema.ts";
import { formatCommitMessage, nameSimilarity, planEdit, planRename, planSync, type RaceStore, type SyncInput } from "../scripts/sync.ts";

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

/** A test race's file; most test races are on 2026-11-15. */
const pathOf = (slug: string, date = "2026-11-15") => racePath({ slug, date });

/** Writes a plan's files into the store, deleting the null ones. */
function apply(store: { files: Record<string, string> }, files: Record<string, string | null>): void {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) delete store.files[path];
    else store.files[path] = content;
  }
}

function input(url: string, extracted: Record<string, unknown>, checkedAt = "2026-09-23T10:00:00.000Z"): SyncInput {
  return { url, extracted, checkedAt };
}

async function seeded(): Promise<RaceStore & { files: Record<string, string>; id: string; slug: string }> {
  const store = memoryStore();
  const first = await plan(store, [input(URL_A, extractedA, "2026-09-20T08:00:00.000Z")], "2026-09-20T08:00:05.000Z");
  apply(store, first.files);
  return { ...store, id: first.changes[0]!.id, slug: first.changes[0]!.slug };
}

describe("planSync", () => {
  it("creates a new race file and index entry", async () => {
    const p = await plan(memoryStore(), [input(URL_A, extractedA)], "2026-09-23T10:00:05.000Z");
    const id = p.changes[0]!.id;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(p.changes, [{ id, slug: "tay-ho-half-marathon-2026", kind: "added", fields: [] }]);

    const race = RaceSchema.parse(JSON.parse(p.files[pathOf(p.changes[0]!.slug)]!));
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
    assert.deepEqual(index, [
      { id, slug: "tay-ho-half-marathon-2026", name: "Tay Ho Half Marathon 2026", date: "2026-11-15", lastModified: "2026-09-23T10:00:05.000Z", file: "tay-ho-half-marathon-2026.json", sourceUrls: [URL_A] },
    ]);
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
    const race = JSON.parse(p.files[pathOf(store.slug)]!) as Race;
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
    assert.deepEqual(Object.keys(p.files).sort(), [INDEX_PATH, pathOf(store.slug)]);
    assert.deepEqual(p.changes[0]!.fields, ["name"]);
    assert.equal(p.changes[0]!.slug, "tay-ho-half-marathon-2026");
  });

  it("renames a race's slug: the file moves, the id stays, and refreshes keep it", async () => {
    const store = await seeded();
    const p = await planRename(store, "tay-ho-half-marathon-2026", "tay-ho-hm", "2026-09-24T00:00:00.000Z");
    assert.deepEqual(p.changes, [{ id: store.id, slug: "tay-ho-hm", kind: "updated", fields: [], renamedFrom: "tay-ho-half-marathon-2026" }]);
    assert.equal(p.files[pathOf("tay-ho-half-marathon-2026")], null);
    assert.match(formatCommitMessage(p), /~ tay-ho-hm: slug \(was tay-ho-half-marathon-2026\)/);
    apply(store, p.files);
    const renamed = RaceSchema.parse(JSON.parse(store.files[pathOf("tay-ho-hm")]!));
    assert.equal(renamed.id, store.id);
    assert.equal(renamed.updatedAt, "2026-09-24T00:00:00.000Z");
    assert.deepEqual((JSON.parse(store.files[INDEX_PATH]!) as IndexEntry[]).map((e) => [e.id, e.slug]), [[store.id, "tay-ho-hm"]]);

    const refresh = await plan(store, [input(URL_A, { ...extractedA, registrationStatus: "sold_out" })]);
    assert.deepEqual(Object.keys(refresh.files).sort(), [INDEX_PATH, pathOf("tay-ho-hm")]);
    assert.equal(refresh.changes[0]!.id, store.id);

    await assert.rejects(planRename(store, store.id, "Not A Slug"), /invalid slug/);
    assert.deepEqual((await planRename(store, store.id, "tay-ho-hm")).changes, []);
  });

  it("adds the race year to a file name without one, and renames the file when the race moves to another year", async () => {
    const store = memoryStore();
    const url = "https://actiup.net/vi/event/vung-tau-city-trail";
    const first = await plan(store, [input(url, { ...extractedA, name: "Vung Tau City Trail" })]);
    assert.equal(first.changes[0]!.slug, "vung-tau-city-trail"); // the slug stays the source's
    assert.ok(first.files["data/races/vung-tau-city-trail-2026.json"]);
    apply(store, first.files);

    const moved = await plan(store, [input(url, { ...extractedA, name: "Vung Tau City Trail", date: "2027-01-10" })]);
    assert.deepEqual(moved.changes[0]!.fields, ["date"]);
    assert.equal(moved.changes[0]!.slug, "vung-tau-city-trail");
    assert.equal(moved.files["data/races/vung-tau-city-trail-2026.json"], null);
    assert.equal(RaceSchema.parse(JSON.parse(moved.files["data/races/vung-tau-city-trail-2027.json"]!)).id, first.changes[0]!.id);
  });

  it("moves a year at the start of a slug to the end of the file name", async () => {
    const p = await plan(memoryStore(), [input("https://actiup.net/vi/event/2026-green-run", { ...extractedA, name: "Green Run" })]);
    assert.equal(p.changes[0]!.slug, "2026-green-run"); // the slug stays the source's
    assert.ok(p.files["data/races/green-run-2026.json"]);
  });

  it("gives a new race a -2 slug when its file name is taken", async () => {
    const store = await seeded(); // tay-ho-half-marathon-2026.json
    await planRename(store, store.id, "tay-ho-half-marathon").then((p) => apply(store, p.files)); // file name unchanged
    // Another race whose source slug is "tay-ho-half-marathon-2026": that slug is free, its file name isn't.
    const other = await plan(store, [input("https://bibchung.pro/events/tay-ho-half-marathon-2026", { ...extractedA, name: "Something Else Entirely", date: "2026-05-01" })]);
    assert.equal(other.changes[0]!.slug, "tay-ho-half-marathon-2026-2");
  });

  it("refuses a slug another race already uses", async () => {
    const store = await seeded();
    const other = await plan(store, [input(URL_B, { pageKind: "sport", name: "Da Lat Ultra Trail", date: "2026-06-20" })]);
    apply(store, other.files);
    await assert.rejects(planRename(store, store.id, "da-lat-ultra-trail-2026"), /already used/);
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
    // The seeded race was renamed to the slug the next new race would get.
    apply(store, (await planRename(store, store.id, "da-lat-ultra-trail-2026")).files);
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

describe("multiple sources", () => {
  const BIB_URL = "https://bibchung.pro/events/tayho-hm-2026";
  const bib = {
    pageKind: "sport",
    types: ["road_run"],
    name: "TayHo Half Marathon 2026",
    date: "2026-11-15",
    distances: ["21KM", "10KM", "5KM"],
    venue: "Hồ Tây",
    city: "Hà Nội",
    priceMin: 300000,
    priceMax: 950000,
    groupPriceMin: 240000,
    organizer: "Tay Ho Sports",
  };
  const actiupOnly = { ...extractedA, distances: [], priceMax: undefined };

  it("joins a bibchung page to the ActiUp race: ActiUp wins, bibchung fills the gaps", async () => {
    const store = memoryStore();
    apply(store, (await plan(store, [input(URL_A, actiupOnly)])).files);
    const p = await plan(store, [input(BIB_URL, bib)]);
    const id = p.changes[0]!.id;
    assert.equal(p.changes.length, 1);
    assert.equal(p.changes[0]!.kind, "updated");
    assert.equal(p.changes[0]!.joined, true);
    const race = RaceSchema.parse(JSON.parse(p.files[pathOf(p.changes[0]!.slug)]!));
    assert.equal(race.name, "Tay Ho Half Marathon 2026"); // ActiUp's
    assert.equal(race.slug, "tay-ho-half-marathon-2026"); // unchanged
    assert.deepEqual(race.location, { venue: "Tay Ho Lake", city: "Hanoi", region: "north" }); // ActiUp's
    assert.deepEqual(race.distances, ["5km", "10km", "21km"]); // bibchung fills
    assert.equal(race.priceMin, 300000);
    assert.equal(race.priceMax, 950000); // bibchung fills
    assert.equal(race.groupPriceMin, 240000); // bibchung only
    assert.equal(race.confidence, "multi-sourced");
    assert.deepEqual(race.sources.map((s) => s.name), ["actiup", "bibchung"]);
    const index = JSON.parse(p.files[INDEX_PATH]!) as IndexEntry[];
    assert.deepEqual(index[0]!.sourceUrls, [URL_A, BIB_URL]);
    assert.match(formatCommitMessage(p), /~ tay-ho-half-marathon-2026: \+source, distances, priceMax, groupPriceMin/);
  });

  it("pairs both pages when they arrive in the same run, in either order", async () => {
    const p = await plan(memoryStore(), [input(BIB_URL, bib), input(URL_A, actiupOnly)]);
    assert.equal(p.changes.length, 1);
    const race = RaceSchema.parse(JSON.parse(p.files[pathOf(p.changes[0]!.slug)]!));
    assert.equal(race.slug, "tay-ho-half-marathon-2026"); // the primary source's slug
    assert.equal(race.sources.length, 2);
  });

  it("flags a race day mismatch as conflicting", async () => {
    const p = await plan(memoryStore(), [input(URL_A, actiupOnly), input(BIB_URL, { ...bib, date: "2026-11-16" })]);
    const race = RaceSchema.parse(JSON.parse(p.files[pathOf(p.changes[0]!.slug)]!));
    assert.equal(race.confidence, "conflicting");
    assert.equal(race.date, "2026-11-15"); // ActiUp's
  });

  it("keeps different races apart, and a bibchung-only race gets its own slug", async () => {
    const p = await plan(memoryStore(), [
      input(URL_A, actiupOnly),
      input("https://bibchung.pro/events/bac-ninh-legacy", { ...bib, name: "Bắc Ninh Legacy Marathon" }), // same day
      input("https://bibchung.pro/events/tayho-2027", { ...bib, date: "2027-11-14" }), // other year
    ]);
    assert.deepEqual(p.changes.map((c) => c.slug).sort(), ["bac-ninh-legacy", "tay-ho-half-marathon-2026", "tayho-2027"]);
    const index = JSON.parse(p.files[INDEX_PATH]!) as IndexEntry[];
    // File names always end with the race year.
    assert.deepEqual(index.map((e) => e.file).sort(), ["bac-ninh-legacy-2026.json", "tay-ho-half-marathon-2026.json", "tayho-2027.json"]);
    for (const e of index) assert.equal(RaceSchema.parse(JSON.parse(p.files[`data/races/${e.file}`]!)).confidence, "single-sourced");
  });

  it("repairs bibchung extraction mistakes", () => {
    const r = normalizeExtracted({ ...bib, priceMin: 542000, priceMax: 678000, groupPriceMin: 542000, organizer: "TẾT RUN MIỀN NAM 2027", name: "Tết Run Miền Nam 2027" });
    assert.ok(r.ok);
    assert.equal(r.race.priceMin, null); // it was the group price, not a regular one
    assert.equal(r.race.priceMax, 678000);
    assert.equal(r.race.groupPriceMin, 542000);
    assert.equal(r.race.organizer, null); // it was the event name
  });

  it("scores name similarity across spacing and diacritics", () => {
    assert.ok(nameSimilarity("Giải chạy Vũng Tàu City Trail 2026", "VungTau CityTrail 2026") >= 0.5);
    assert.ok(nameSimilarity("Tết Run Miền Nam 2027", "TẾT RUN MIỀN NAM 2027") === 1);
    assert.ok(nameSimilarity("Bắc Ninh Legacy Marathon", "Tay Ho Half Marathon 2026") < 0.5);
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

  it("drops prices the model put in distances", () => {
    const r = normalizeExtracted({ pageKind: "sport", name: "X", date: "2027-01-24", distances: ["Chỉ từ 678.000đ", "10km", "1.000 VND", "70.3", "Sprint"] });
    assert.ok(r.ok);
    assert.deepEqual(r.race.distances, ["10km", "70.3", "Sprint"]);
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

describe("OpenRace overrides and hand-entered races", () => {
  it("an override wins over the sources, survives a re-check, and can be removed", async () => {
    const store = await seeded();
    const set = await planEdit(store, "tay-ho-half-marathon-2026", [{ kind: "set", field: "distances", value: ["21km", "42km"], reason: "BTC confirmed" }], "2026-09-24T00:00:00.000Z");
    assert.deepEqual(set.changes[0]!.fields, ["distances"]);
    apply(store, set.files);
    let race = RaceSchema.parse(JSON.parse(store.files[pathOf(store.slug)]!));
    assert.deepEqual(race.distances, ["21km", "42km"]);
    assert.deepEqual(race.overrides.distances, { value: ["21km", "42km"], reason: "BTC confirmed", at: "2026-09-24T00:00:00.000Z" });

    // The source changes that field: the override stays, and nothing else moves.
    const recheck = await plan(store, [input(URL_A, { ...extractedA, distances: ["10km"] }, "2026-09-25T00:00:00.000Z")]);
    assert.deepEqual(recheck.changes, [{ id: store.id, slug: "tay-ho-half-marathon-2026", kind: "updated", fields: [], shadowed: ["distances"] }]);
    assert.deepEqual((JSON.parse(recheck.files[pathOf(store.slug)]!) as Race).distances, ["21km", "42km"]); // override kept
    assert.match(formatCommitMessage(recheck), /distances changed at the source \(override kept\)/);
    const other = await plan(store, [input(URL_A, { ...extractedA, distances: ["10km"], registrationStatus: "sold_out" })]);
    race = RaceSchema.parse(JSON.parse(other.files[pathOf(store.slug)]!));
    assert.deepEqual(race.distances, ["21km", "42km"]);
    assert.equal(race.registrationStatus, "sold_out");

    const unset = await planEdit(store, store.id, [{ kind: "unset", field: "distances" }]);
    race = RaceSchema.parse(JSON.parse(unset.files[pathOf(store.slug)]!));
    assert.deepEqual(race.distances, ["5km", "10km", "21km"]); // back to the source
    assert.deepEqual(race.overrides, {});
  });

  it("rejects an override that isn't a valid value for its field, and a field that disagrees with its override", async () => {
    const store = await seeded();
    await assert.rejects(planEdit(store, store.id, [{ kind: "set", field: "priceMin", value: "cheap", reason: "x" }]), /invalid record/);
    await assert.rejects(planEdit(store, store.id, [{ kind: "unset", field: "priceMin" }]), /no override/);
    const race = JSON.parse(store.files[pathOf(store.slug)]!) as Race;
    const bad = { ...race, overrides: { priceMin: { value: 1, reason: "x", at: race.updatedAt } } };
    assert.equal(RaceSchema.safeParse(bad).success, false);
  });

  it("adds a race no site lists, then lets ActiUp join it as the primary source", async () => {
    const store = memoryStore();
    const fb = "https://www.facebook.com/tayho.run/posts/123?ref=share";
    const manual = { pageKind: "sport", name: "Tây Hồ Half Marathon 2026", date: "2026-11-15", types: ["road_run"], distances: ["21km"], city: "Hà Nội", priceMin: 250000 };
    const added = await plan(store, [{ url: fb, extracted: manual, checkedAt: "2026-09-24T00:00:00.000Z", source: "openrace" }]);
    const { id, slug } = added.changes[0]!;
    let race = RaceSchema.parse(JSON.parse(added.files[pathOf(slug)]!));
    assert.equal(race.slug, "tay-ho-half-marathon-2026"); // from the name
    assert.deepEqual(race.sources.map((s) => [s.name, s.url]), [["openrace", "https://facebook.com/tayho.run/posts/123"]]);
    apply(store, added.files);

    const joined = await plan(store, [input(URL_A, actiupForJoin)]);
    assert.equal(joined.changes[0]!.id, id);
    race = RaceSchema.parse(JSON.parse(joined.files[pathOf(slug)]!));
    assert.equal(race.priceMin, 300000); // ActiUp wins
    assert.equal(race.confidence, "multi-sourced");
  });
});

const actiupForJoin = { ...extractedA, distances: [] };

describe("sanity bounds", () => {
  const valid = async () => {
    const p = await plan(memoryStore(), [input(URL_A, extractedA)]);
    return JSON.parse(p.files[pathOf(p.changes[0]!.slug)]!) as Race;
  };

  it("the schema rejects values that are extraction mistakes", async () => {
    const race = await valid();
    assert.ok(RaceSchema.safeParse(race).success);
    const bad: Partial<Race>[] = [
      { distances: ["Chỉ từ 678.000đ"] },
      { priceMin: 200_000_000 },
      { date: "2099-01-01" },
      { date: "2009-01-01" },
      { name: "Tet Run 678.000đ" },
      { name: "See https://actiup.net" },
      { currency: "vnd" },
      { updatedAt: "2000-01-01T00:00:00.000Z" },
    ];
    for (const patch of bad) assert.equal(RaceSchema.safeParse({ ...race, ...patch }).success, false, JSON.stringify(patch));
  });

  it("normalization drops out-of-bounds values instead of failing the race", () => {
    const r = normalizeExtracted({ pageKind: "sport", name: "X", date: "2027-01-24", distances: ["10km", "lots", "Sprint"], priceMin: 999_999_999, priceMax: 500000 });
    assert.ok(r.ok);
    assert.deepEqual(r.race.distances, ["10km", "Sprint"]);
    assert.equal(r.race.priceMin, null);
    assert.equal(normalizeExtracted({ pageKind: "sport", name: "X", date: "2099-01-24" }).ok, false);
  });
});

describe("discord messages", () => {
  it("splits between lines, never over the limit", () => {
    const lines = ["header", "a".repeat(8), "b".repeat(8), "c".repeat(30)];
    const out = splitMessages(lines, 20);
    assert.deepEqual(out, ["header\naaaaaaaa", "bbbbbbbb", `${"c".repeat(19)}…`]);
    for (const m of out) assert.ok(m.length <= 20);
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

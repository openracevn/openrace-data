import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitMessages } from "../scripts/lib/changes.ts";
import type { StoredExtraction } from "../scripts/lib/reconcile.ts";
import { INDEX_PATH, ORGANIZERS_PATH, RaceSchema, SERIES_PATH, racePath, type IndexEntry, type Race } from "../scripts/lib/schema.ts";
import { parseSites, type SitesConfig } from "../scripts/lib/sites.ts";
import { formatCommitMessage, nameSimilarity, planEdit, planRename, planSync, type RaceStore, type SyncInput } from "../scripts/sync.ts";

const config: SitesConfig = parseSites(`
monthlyCredits: 900
sites:
  - { key: actiup, name: ActiUp, kind: seller, url: "https://actiup.net/vi/events/sports", recipe: actiup, check: weekly }
  - { key: irace, name: iRace, kind: seller, url: "https://irace.vn/", hosts: [irace.vn, ticket.irace.vn], recipe: none }
  - key: hcmc-marathon
    name: HCMC Marathon
    kind: race-site
    url: https://hcmcmarathon.com/
    recipe: default
    check: quarterly
    series: { id: hcmc-marathon, name: HCMC Marathon }
    organizer: { id: pulse-active, name: Pulse Active }
`);

const OFFICIAL = "https://hcmcmarathon.com/";
const ACTIUP = "https://actiup.net/vi/event/hcmc-marathon-2027";
const OTHER = "https://actiup.net/vi/event/tay-ho-half-marathon-2026";

const officialPage = {
  pageKind: "sport",
  types: ["road_run"],
  name: "HCMC Marathon 2027",
  date: "2027-01-17",
  distances: ["42km", "21km", "10km"],
  venue: "30/4 Park, Le Duan",
  city: "TP. Hồ Chí Minh",
  prices: [
    { distance: "21KM", tier: "Early Bird", from: "23/06", to: "15/08", price: 1_050_000 },
    { distance: "21KM", tier: "Regular", from: "2026-08-16", to: "2026-10-15", price: 1_250_000 },
  ],
};

/** An official-site source: one page read, plus the site's series/organizer hints and its links. */
function official(page: Record<string, unknown> = officialPage, links: { url: string; text: string }[] = []): StoredExtraction {
  return {
    pages: [{ url: OFFICIAL, json: page }],
    links,
    series: { id: "hcmc-marathon", name: "HCMC Marathon" },
    organizer: { id: "pulse-active", name: "Pulse Active" },
  };
}

/** An ActiUp source: facts from its API plus the OCR'd price image. */
function actiup(facts: Record<string, unknown>, prices: Record<string, unknown>[] = []): StoredExtraction {
  return {
    facts: { name: "HCMC Marathon 2027", date: "2027-01-17", venue: "Công viên 30/4", organizer: "Pulse Active", ...facts },
    pages: [{ url: ACTIUP, json: { pageKind: "sport", types: ["road_run"], distances: ["21km", "42km"] } }],
    ...(prices.length > 0 && { images: [{ url: "https://pix.actiup.net/price.png", json: { prices } }] }),
  };
}

// Deterministic UUIDs so tests can name files; every planSync call gets fresh ones.
let idCounter = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}`;
const LATER = "2026-09-25T10:00:00.000Z";
const plan = (store: RaceStore, inputs: SyncInput[], now = "2026-09-24T10:00:05.000Z") => planSync(store, inputs, config, now, nextId);

function memoryStore(files: Record<string, string> = {}): RaceStore & { files: Record<string, string> } {
  return { files, read: async (p) => files[p] ?? null };
}

function apply(store: { files: Record<string, string> }, files: Record<string, string | null>): void {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) delete store.files[path];
    else store.files[path] = content;
  }
}

const officialInput = (extracted = official(), checkedAt = "2026-09-24T10:00:00.000Z"): SyncInput => ({
  url: OFFICIAL,
  site: "hcmc-marathon",
  role: "official",
  extracted,
  checkedAt,
});
const actiupInput = (extracted: StoredExtraction, url = ACTIUP, checkedAt = "2026-09-24T10:00:00.000Z"): SyncInput => ({
  url,
  site: "actiup",
  role: "seller",
  extracted,
  checkedAt,
  slugHint: new URL(url).pathname.split("/")[3],
});

function readRace(store: { files: Record<string, string> }, slug: string, date = "2027-01-17"): Race {
  return RaceSchema.parse(JSON.parse(store.files[racePath({ slug, date })]!));
}
const index = (store: { files: Record<string, string> }): IndexEntry[] => JSON.parse(store.files[INDEX_PATH]!);

describe("planSync", () => {
  it("creates a race from an official site, with its tiers, series and organizer", async () => {
    const store = memoryStore();
    const p = await plan(store, [officialInput()]);
    apply(store, p.files);
    assert.equal(p.changes.length, 1);
    assert.equal(p.changes[0]!.kind, "added");
    const race = readRace(store, "hcmc-marathon-2027");
    assert.equal(race.date, "2027-01-17");
    assert.deepEqual(race.distances, ["10km", "21km", "42km"]);
    assert.deepEqual(race.location, { venue: "30/4 Park, Le Duan", city: "TP. Hồ Chí Minh" });
    assert.equal(race.seriesId, "hcmc-marathon");
    assert.equal(race.organizerId, "pulse-active");
    assert.deepEqual(race.prices, [
      { distance: "21km", tier: "Early Bird", kind: "early", price: 1_050_000, from: "2026-06-23", to: "2026-08-15", site: "hcmc-marathon" },
      { distance: "21km", tier: "Regular", kind: "regular", price: 1_250_000, from: "2026-08-16", to: "2026-10-15", site: "hcmc-marathon" },
    ]);
    assert.deepEqual(JSON.parse(store.files[SERIES_PATH]!), [{ id: "hcmc-marathon", name: "HCMC Marathon", website: null, organizerId: "pulse-active" }]);
    assert.deepEqual(JSON.parse(store.files[ORGANIZERS_PATH]!), [{ id: "pulse-active", name: "Pulse Active", website: null }]);
    assert.equal(race.confidence, "single-sourced");
    assert.deepEqual(race.flags, []);
  });

  it("writes nothing when a re-read says the same", async () => {
    const store = memoryStore();
    apply(store, (await plan(store, [officialInput()])).files);
    const again = await plan(store, [officialInput(official(), "2026-10-01T10:00:00.000Z")], "2026-10-01T10:00:05.000Z");
    assert.deepEqual(again, { files: {}, changes: [], skipped: [] });
  });

  it("joins the ActiUp page the official site links to, even under another name, and keeps both sellers' prices", async () => {
    const store = memoryStore();
    const links = [
      { url: ACTIUP, text: "dang ky tai actiup" },
      { url: "https://ticket.irace.vn/hcmc-marathon-2027", text: "irace" },
      { url: "https://www.facebook.com/hcmcmarathon", text: "" },
    ];
    apply(store, (await plan(store, [officialInput(official(officialPage, links))])).files);
    const seller = actiupInput(
      actiup({ name: "Giải Marathon Quốc tế TP.HCM Techcombank 2027", date: "2027-01-16" }, [{ distance: "21 km", tier: "Nhóm", price: 990_000 }]),
    );
    const p = await plan(store, [seller]);
    apply(store, p.files);
    assert.equal(index(store).length, 1);
    assert.deepEqual(p.changes[0]!.joined, ["actiup"]);
    const race = readRace(store, "hcmc-marathon-2027");
    // The official site wins race day and the name.
    assert.equal(race.date, "2027-01-17");
    assert.equal(race.name, "HCMC Marathon 2027");
    assert.equal(race.confidence, "conflicting");
    assert.match(race.flags[0]!, /disagree on race day: hcmc-marathon 2027-01-17, actiup 2027-01-16/);
    assert.deepEqual(
      race.prices.map((t) => [t.site, t.kind, t.price]),
      [
        ["hcmc-marathon", "early", 1_050_000],
        ["hcmc-marathon", "regular", 1_250_000],
        ["actiup", "group", 990_000],
      ],
    );
    assert.deepEqual(race.registrations, [
      { site: "actiup", url: ACTIUP },
      { site: "irace", url: "https://ticket.irace.vn/hcmc-marathon-2027" },
    ]);
    assert.deepEqual(
      race.links.map((l) => [l.kind, l.url]),
      [
        ["facebook", "https://facebook.com/hcmcmarathon"],
        ["seller", ACTIUP],
        ["seller", "https://ticket.irace.vn/hcmc-marathon-2027"],
      ],
    );
  });

  it("treats next year's edition on the same official page as a new race", async () => {
    const store = memoryStore();
    apply(store, (await plan(store, [officialInput()])).files);
    const nextYear = { ...officialPage, name: "HCMC Marathon 2028", date: "2028-01-16", prices: [] };
    const p = await plan(store, [officialInput(official(nextYear), "2027-06-01T10:00:00.000Z")], "2027-06-01T10:00:05.000Z");
    apply(store, p.files);
    assert.equal(p.changes[0]!.kind, "added");
    assert.equal(index(store).length, 2);
    assert.equal(readRace(store, "hcmc-marathon-2027").date, "2027-01-17");
    assert.equal(readRace(store, "hcmc-marathon-2028", "2028-01-16").seriesId, "hcmc-marathon");
  });

  it("matches another site's page by name and race day when nothing links them", async () => {
    const store = memoryStore();
    apply(store, (await plan(store, [officialInput()])).files);
    const p = await plan(store, [actiupInput(actiup({ name: "HCMC Marathon 2027 " }))]);
    assert.equal(p.changes.length, 1);
    assert.equal(p.changes[0]!.kind, "updated");
  });

  it("keeps different races apart and slugs new ones from the site's own slug", async () => {
    const store = memoryStore();
    apply(store, (await plan(store, [officialInput()])).files);
    const p = await plan(store, [actiupInput(actiup({ name: "Tây Hồ Half Marathon 2026", date: "2026-11-15" }), OTHER)]);
    assert.equal(p.changes[0]!.kind, "added");
    assert.equal(p.changes[0]!.slug, "tay-ho-half-marathon-2026");
  });

  it("ignores rewording of venue and organizer between reads, but not a real move", async () => {
    const store = memoryStore();
    apply(store, (await plan(store, [actiupInput(actiup({}))])).files);
    const reworded = await plan(store, [actiupInput(actiup({ venue: "Công viên 30/4, Quận 1" }), ACTIUP, "2026-10-01T10:00:00.000Z")]);
    assert.equal(reworded.changes.length, 0);
    const moved = await plan(store, [actiupInput(actiup({ venue: "Vinhomes Grand Park" }), ACTIUP, "2026-10-01T10:00:00.000Z")]);
    assert.deepEqual(moved.changes[0]!.fields, ["location"]);
  });

  it("skips pages that aren't sports events or have no date", async () => {
    const p = await plan(memoryStore(), [
      officialInput({ pages: [{ url: OFFICIAL, json: { pageKind: "non_sport", name: "Concert", date: "2026-12-01" } }] }),
      actiupInput({ pages: [{ url: OTHER, json: { pageKind: "sport", name: "No date race" } }] }, OTHER),
    ]);
    assert.equal(p.changes.length, 0);
    assert.deepEqual(
      p.skipped.map((s) => s.reason.split(":")[0]),
      ["not a sports event", "missing or unparseable date"],
    );
  });

  it("formats a commit message with joins and new flags", async () => {
    const store = memoryStore();
    apply(store, (await plan(store, [officialInput()])).files);
    const p = await plan(store, [actiupInput(actiup({ date: "2027-01-16", name: "HCMC Marathon 2027" }))]);
    assert.match(formatCommitMessage(p), /~ hcmc-marathon-2027: \+actiup, .*⚠️ sources disagree on race day/);
  });
});

describe("OpenRace overrides and renames", () => {
  it("an override wins over the sources, survives a re-read, and can be removed", async () => {
    const store = memoryStore();
    apply(store, (await plan(store, [officialInput()])).files);
    const set = await planEdit(store, "hcmc-marathon-2027", [{ kind: "set", field: "distances", value: ["42km", "21km", "10km", "5km"], reason: "5km announced on Facebook" }], config, LATER);
    apply(store, set.files);
    assert.deepEqual(readRace(store, "hcmc-marathon-2027").distances, ["42km", "21km", "10km", "5km"]);
    const reread = await plan(store, [officialInput(official(), "2026-10-01T10:00:00.000Z")]);
    assert.equal(reread.changes.length, 0);
    const unset = await planEdit(store, "hcmc-marathon-2027", [{ kind: "unset", field: "distances" }], config, LATER);
    apply(store, unset.files);
    assert.deepEqual(readRace(store, "hcmc-marathon-2027").distances, ["10km", "21km", "42km"]);
  });

  it("renames a slug: the file moves, the id stays, and re-reads keep it", async () => {
    const store = memoryStore();
    apply(store, (await plan(store, [officialInput()])).files);
    const { id } = index(store)[0]!;
    apply(store, (await planRename(store, "hcmc-marathon-2027", "ho-chi-minh-city-marathon", LATER)).files);
    assert.equal(readRace(store, "ho-chi-minh-city-marathon").id, id);
    assert.equal(store.files[racePath({ slug: "hcmc-marathon-2027", date: "2027-01-17" })], undefined);
    const reread = await plan(store, [officialInput(official({ ...officialPage, venue: "Nhà hát Thành phố" }))]);
    assert.equal(reread.changes[0]!.slug, "ho-chi-minh-city-marathon");
  });

  it("adds a race no site lists, from facts entered by hand", async () => {
    const p = await plan(memoryStore(), [
      {
        url: "https://facebook.com/some-race/posts/1",
        site: "openrace",
        role: "reference",
        extracted: { facts: { name: "Làng Chạy Bộ 2026", date: "2026-12-06", distances: ["5km", "10km"], prices: [{ tier: "Vé", price: 200000 }] } },
        checkedAt: "2026-09-24T10:00:00.000Z",
      },
    ]);
    assert.equal(p.changes[0]!.slug, "lang-chay-bo-2026");
    const race = RaceSchema.parse(JSON.parse(p.files[racePath({ slug: "lang-chay-bo-2026", date: "2026-12-06" })]!));
    assert.deepEqual(race.prices, [{ distance: null, tier: "Vé", kind: "other", price: 200000, from: null, to: null, site: "openrace" }]);
  });
});

describe("helpers", () => {
  it("scores name similarity across spacing and diacritics", () => {
    assert.ok(nameSimilarity("Vũng Tàu City Trail 2026", "VungTau CityTrail 2026") > 0.8);
    assert.ok(nameSimilarity("Vũng Tàu City Trail 2026", "Đà Lạt Ultra Trail 2026") < 0.5);
  });

  it("splits Discord messages between lines, never over the limit", () => {
    const messages = splitMessages(["a".repeat(900), "b".repeat(900), "c".repeat(900)], 2000);
    assert.equal(messages.length, 2);
    assert.ok(messages.every((m) => m.length <= 2000));
  });
});

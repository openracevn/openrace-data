// Written by the supervisor for plan 004 stage A. Don't edit: make the code pass it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeExtraction } from "../scripts/lib/extraction.ts";
import { fillTierWindows } from "../scripts/lib/reconcile.ts";
import { RaceSchema, SCHEMA_VERSION, courseMeters, upgradeRace, type PriceTier } from "../scripts/lib/schema.ts";

const tier = (t: Partial<PriceTier>): PriceTier => ({
  distance: "21km",
  tier: "Tier",
  kind: "regular",
  audience: null,
  price: 500000,
  from: null,
  to: null,
  site: "actiup",
  inferred: [],
  ...t,
});

describe("schema v3", () => {
  it("is version 3", () => {
    assert.equal(SCHEMA_VERSION, 3);
  });

  it("turns a course label into meters", () => {
    const cases: [string, number | null][] = [
      ["10km", 10000],
      ["1.5km", 1500],
      ["21km", 21097],
      ["42km", 42195],
      ["750m", 750],
      ["100mi", 160934],
      ["56.50", 56500],
      ["56.5", 56500],
      ["Super Sprint", 12900],
      ["Sprint", 25750],
      ["sprint", 25750],
      ["Olympic", 51500],
      ["Standard", 51500],
      ["5150", 51500],
      ["70.3", 113000],
      ["Half", 113000],
      ["140.6", 226000],
      ["Full", 226000],
      ["Kids", null],
    ];
    for (const [label, meters] of cases) assert.equal(courseMeters(label), meters, label);
  });
});

describe("tier windows", () => {
  const raceDay = "2026-12-06";

  it("fills a gap from the neighbours and ends the last tier on race day", () => {
    const out = fillTierWindows(
      [
        tier({ tier: "Regular", kind: "regular", from: null, to: null }),
        tier({ tier: "Early Bird", kind: "early", from: "2026-08-01", to: "2026-09-15" }),
        tier({ tier: "Late", kind: "late", from: "2026-11-01", to: null }),
      ],
      raceDay,
    );
    // Input order is kept.
    assert.deepEqual(
      out.map((t) => [t.tier, t.from, t.to, t.inferred]),
      [
        ["Regular", "2026-09-16", "2026-10-31", ["from", "to"]],
        ["Early Bird", "2026-08-01", "2026-09-15", []],
        ["Late", "2026-11-01", raceDay, ["to"]],
      ],
    );
  });

  it("leaves the first tier's start open when nothing says when sales opened", () => {
    const out = fillTierWindows([tier({ kind: "early", to: "2026-09-30" }), tier({ kind: "regular", from: null, to: null })], raceDay);
    assert.deepEqual(
      out.map((t) => [t.from, t.to, t.inferred]),
      [
        [null, "2026-09-30", []],
        ["2026-10-01", raceDay, ["from", "to"]],
      ],
    );
  });

  it("keeps ladders apart by distance, audience and site, including distance null", () => {
    const out = fillTierWindows(
      [
        tier({ distance: "5km", kind: "early", to: "2026-09-30" }),
        tier({ distance: "5km", kind: "regular" }),
        tier({ distance: "21km", kind: "regular" }),
        tier({ distance: null, kind: "early", to: "2026-10-15" }),
        tier({ distance: null, kind: "regular" }),
        tier({ distance: "5km", kind: "regular", audience: "non_resident" }),
        tier({ distance: "5km", kind: "regular", site: "bibchung" }),
      ],
      raceDay,
    );
    assert.deepEqual(
      out.map((t) => [t.from, t.to]),
      [
        [null, "2026-09-30"],
        ["2026-10-01", raceDay],
        [null, raceDay],
        [null, "2026-10-15"],
        ["2026-10-16", raceDay],
        [null, raceDay],
        [null, raceDay],
      ],
    );
  });

  it("never touches group or other tiers", () => {
    const input = [tier({ kind: "early", to: "2026-09-30" }), tier({ kind: "group", tier: "Group 10-19" }), tier({ kind: "other", tier: "Combo" })];
    const out = fillTierWindows(input, raceDay);
    assert.deepEqual(out.slice(1), input.slice(1));
  });

  it("never makes from after to", () => {
    // Late starts before Regular's stated end: the filled Late.to (race day) is fine,
    // but Regular.from from Early's end would be after Regular.to, so it stays null.
    const out = fillTierWindows([tier({ kind: "early", to: "2026-10-20" }), tier({ kind: "regular", to: "2026-10-10" })], raceDay);
    assert.deepEqual(out.map((t) => [t.from, t.to, t.inferred]), [
      [null, "2026-10-20", []],
      [null, "2026-10-10", []],
    ]);
  });
});

describe("courses from a source", () => {
  const facts = { name: "Lâm Đồng Trail 2026", date: "2026-12-06" };

  it("builds courses with meters, per-course type and elevation, edition and maps link", () => {
    const r = normalizeExtraction({
      facts,
      pages: [
        {
          url: "https://example.vn",
          json: {
            pageKind: "sport",
            types: ["trail_run", "road_run"],
            distances: ["5KM", "21KM", "70KM"],
            courses: [
              { distance: "70 km", type: "trail_run", elevationGain: 3500.4 },
              { distance: "5km", type: "road_run" },
            ],
            edition: 5,
            mapsUrl: "https://maps.app.goo.gl/abc",
          },
        },
      ],
    });
    assert.ok(r.ok);
    assert.deepEqual(r.facts.courses, [
      { label: "5km", meters: 5000, type: "road_run", elevationGain: null },
      { label: "21km", meters: 21097, type: null, elevationGain: null },
      { label: "70km", meters: 70000, type: "trail_run", elevationGain: 3500 },
    ]);
    assert.equal(r.facts.edition, 5);
    assert.equal(r.facts.mapsUrl, "https://maps.app.goo.gl/abc");
  });

  it("gives every course the race's type when it has only one", () => {
    const r = normalizeExtraction({ facts, pages: [{ url: "https://example.vn", json: { pageKind: "sport", types: ["trail_run"], distances: ["10km"], edition: 0 } }] });
    assert.ok(r.ok);
    assert.deepEqual(r.facts.courses, [{ label: "10km", meters: 10000, type: "trail_run", elevationGain: null }]);
    // 0 is not an edition.
    assert.equal(r.facts.edition, null);
    assert.equal(r.facts.mapsUrl, null);
  });
});

describe("upgrading a v2 file", () => {
  it("drops distances, adds courses, geo, edition and inferred, also inside a prices override", () => {
    const price = { distance: "21km", tier: "Early Bird", kind: "early", audience: null, price: 500000, from: null, to: "2026-09-30", site: "actiup" };
    const v2 = {
      id: "0b7c9a52-3f1e-4c55-9d7c-2f1a1b2c3d4e",
      slug: "vung-tau-city-trail",
      name: "Vũng Tàu City Trail 2026",
      types: ["city_trail"],
      date: "2026-12-06",
      endDate: null,
      seriesId: null,
      organizerId: null,
      organizer: null,
      distances: ["21km"],
      location: { venue: "Bãi Sau", city: "Vũng Tàu" },
      prices: [price],
      currency: "VND",
      registrationStatus: null,
      registrations: [],
      links: [],
      flags: [],
      overrides: { prices: { value: [price], reason: "model shifted rows", at: "2026-09-24T00:00:00.000Z" } },
      sources: [{ site: "actiup", role: "seller", url: "https://actiup.net/vi/event/x", lastCheckedAt: "2026-09-24T00:00:00.000Z", lastChangedAt: "2026-09-24T00:00:00.000Z", extracted: {} }],
      confidence: "single-sourced",
      createdAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T00:00:00.000Z",
    };
    const v3 = RaceSchema.parse(upgradeRace(v2));
    assert.equal("distances" in v3, false);
    assert.deepEqual(v3.courses, []);
    assert.equal(v3.geo, null);
    assert.equal(v3.edition, null);
    assert.deepEqual(v3.prices[0]!.inferred, []);
    // Upgrading twice changes nothing.
    assert.deepEqual(upgradeRace(upgradeRace(v2)), upgradeRace(v2));
  });
});

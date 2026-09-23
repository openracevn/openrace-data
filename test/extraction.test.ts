import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeDistance, normalizeExtraction, tierDate, tierKind } from "../scripts/lib/extraction.ts";

describe("price tiers", () => {
  it("maps tier labels to kinds", () => {
    const kinds = ["Super Early Bird", "Early Bird", "EB", "Giá vé Tiêu chuẩn", "Regular", "Last call", "Late", "Vé nhóm", "Group 20-49", "Siêu sớm", "VIP Package"].map(tierKind);
    assert.deepEqual(kinds, ["super_early", "early", "early", "regular", "regular", "late", "late", "group", "group", "super_early", "other"]);
  });

  it("gives tier dates without a year the race's year, or the year before when that's after race day", () => {
    assert.equal(tierDate("08/7", "2026-11-01"), "2026-07-08");
    assert.equal(tierDate("21/9", "2026-11-01"), "2026-09-21");
    // Registration for a January race opens the year before.
    assert.equal(tierDate("23/06", "2027-01-17"), "2026-06-23");
    assert.equal(tierDate("2026-09-04", "2026-11-29"), "2026-09-04");
    assert.equal(tierDate("04/09/2026", "2026-11-29"), "2026-09-04");
    assert.equal(tierDate("soon", "2026-11-29"), null);
  });

  it("reads month names, and redoes a year the model made up", () => {
    assert.equal(tierDate("24 JUN", "2027-01-17"), "2026-06-24");
    assert.equal(tierDate("5 Sep", "2027-01-17"), "2026-09-05");
    assert.equal(tierDate("24 tháng 6", "2026-11-01"), "2026-06-24");
    // HCMC Marathon 2027's poster prints no year; the model wrote 2023.
    assert.equal(tierDate("2023-06-23", "2027-01-17"), "2026-06-23");
  });

  it("splits prices by audience, and gives a row without dates those of the same tier", () => {
    const result = normalizeExtraction({
      pages: [{ url: "x", json: { pageKind: "sport", name: "HCMC Marathon", date: "2027-01-17" } }],
      images: [
        {
          url: "y",
          json: {
            prices: [
              { distance: "10KM", tier: "Early Bird", audience: "Resident", from: "24/06", to: "16/07", price: 750000 },
              { distance: "10KM", tier: "Early Bird", audience: "Non-resident", price: 1150000 },
              { distance: "10KM", tier: "Late (Nước ngoài)", price: 1600000 },
            ],
          },
        },
      ],
    });
    assert.ok(result.ok);
    assert.deepEqual(
      result.facts.prices.map((t) => [t.tier, t.audience, t.price, t.from, t.to]),
      [
        ["Early Bird", "resident", 750000, "2026-06-24", "2026-07-16"],
        ["Early Bird", "non_resident", 1150000, "2026-06-24", "2026-07-16"],
        ["Late (Nước ngoài)", "non_resident", 1600000, null, null],
      ],
    );
  });

  it("normalizes the Pink Run price image: 2 distances × 5 tiers", () => {
    const tiers = [
      ["Giá vé Tiêu chuẩn", null, null, 569000, 799000],
      ["Super Early Bird", "08/7", "18/7", 459000, 629000],
      ["Early Bird", "19/7", "31/7", 479000, 679000],
      ["Last call", "01/8", "20/9", 529000, 749000],
      ["Late", "21/9", "05/10", 569000, 799000],
    ] as const;
    const prices = tiers.flatMap(([tier, from, to, p3, p10]) => [
      { distance: "3 KM", tier, from, to, price: p3 },
      { distance: "10 KM", tier, from, to, price: p10 },
    ]);
    const result = normalizeExtraction({ facts: { name: "Giải Chạy Hồng – Pink Run 2026", date: "2026-11-01" }, images: [{ url: "x", json: { prices } }] });
    assert.ok(result.ok);
    assert.equal(result.facts.prices.length, 10);
    assert.deepEqual(result.facts.distances, ["3km", "10km"]);
    assert.deepEqual(result.facts.prices[2], { distance: "3km", tier: "Super Early Bird", kind: "super_early", audience: null, price: 459000, from: "2026-07-08", to: "2026-07-18" });
    assert.deepEqual(result.facts.prices[9], { distance: "10km", tier: "Late", kind: "late", audience: null, price: 799000, from: "2026-09-21", to: "2026-10-05" });
  });

  it("prefers a price table read from an image over prices picked out of the text", () => {
    const result = normalizeExtraction({
      pages: [{ url: "x", json: { pageKind: "sport", name: "HCMC Marathon", date: "2027-01-17", prices: [{ distance: "10KM", tier: "Standard", price: 99000 }] } }],
      images: [{ url: "y", json: { prices: [{ distance: "10KM", tier: "Early Bird", from: "23/06", to: "15/08", price: 750000 }] } }],
    });
    assert.ok(result.ok);
    assert.deepEqual(result.facts.prices.map((t) => t.price), [750000]);
  });

  it("drops add-on fees, misread dates and out-of-bounds prices", () => {
    const result = normalizeExtraction({
      facts: { name: "Race", date: "2026-11-01" },
      pages: [
        {
          url: "x",
          json: {
            pageKind: "sport",
            prices: [
              { distance: "21km", tier: "Race photos", price: 119000 },
              { distance: "21km", tier: "VIP upgrade", price: 599000 },
              { distance: "21km", tier: "Transfer fee", price: 300000 },
              { distance: "21km", tier: "Late", from: "2026-11-05", to: "2026-11-20", price: 900000 },
              { distance: "21km", tier: "Regular", price: 999_999_999 },
              { distance: "21km", tier: "Regular", price: "750.000đ" },
              { distance: "21km", tier: "Group 20-49", from: "01/11", to: "01/11", price: 700000 },
              { tier: "Early Bird", from: "01/10", to: "01/10", price: 0 },
              { distance: "1km", tier: "Kids (miễn phí)", price: 0 },
            ],
          },
        },
      ],
    });
    assert.ok(result.ok);
    assert.deepEqual(
      result.facts.prices.map((t) => [t.tier, t.price, t.from, t.to]),
      [
        ["Late", 900000, null, null],
        ["Regular", 750000, null, null],
        ["Group 20-49", 700000, null, null],
        ["Kids (miễn phí)", 0, null, null],
      ],
    );
  });
});

describe("normalizeExtraction", () => {
  it("trusts the site's own facts over the model, and fills the rest from pages", () => {
    const result = normalizeExtraction({
      facts: { name: "Giải Chạy Hồng – Pink Run 2026", date: "2026-11-01", venue: "Celadon City", organizer: "BCNV" },
      pages: [{ url: "x", json: { pageKind: "sport", name: "Pink Run", date: "2026-11-02", city: "TP. Hồ Chí Minh", distances: ["3km", "10 KM"], types: ["road_run"] } }],
    });
    assert.ok(result.ok);
    assert.equal(result.facts.name, "Giải Chạy Hồng – Pink Run 2026");
    assert.equal(result.facts.date, "2026-11-01");
    assert.equal(result.facts.venue, "Celadon City");
    assert.equal(result.facts.city, "TP. Hồ Chí Minh");
    assert.deepEqual(result.facts.distances, ["3km", "10km"]);
    assert.deepEqual(result.facts.types, ["road_run"]);
  });

  it("rejects a page the model calls non-sport, even with site facts", () => {
    const result = normalizeExtraction({ facts: { name: "Concert", date: "2026-11-01" }, pages: [{ url: "x", json: { pageKind: "non_sport" } }] });
    assert.deepEqual(result, { ok: false, reason: "not a sports event" });
  });

  it("keeps multi-day end dates, and forces types from the name", () => {
    const result = normalizeExtraction({ pages: [{ url: "x", json: { pageKind: "sport", name: "Vung Tau City Trail 2026", date: "2026-11-28", endDate: "2026-11-29", types: ["trail_run"] } }] });
    assert.ok(result.ok);
    assert.equal(result.facts.endDate, "2026-11-29");
    assert.deepEqual(result.facts.types, ["city_trail"]);
  });

  it("snaps standard distances", () => {
    assert.deepEqual(["21.1K", "Half Marathon", "42.195km", "10 km", "100 MILES", "5K"].map(normalizeDistance), ["21km", "21km", "42km", "10km", "100mi", "5km"]);
  });
});

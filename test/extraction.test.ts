import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeDistance, normalizeExtraction, statesEdition, statesNumber, tierDate, tierKind } from "../scripts/lib/extraction.ts";

describe("price tiers", () => {
  it("maps tier labels to kinds", () => {
    const kinds = ["Super Early Bird", "Early Bird", "EB", "Giá vé Tiêu chuẩn", "Regular", "Last call", "Late", "Vé nhóm", "Group 20-49", "Siêu sớm", "VIP Package", "Supper Early Bird"].map(tierKind);
    assert.deepEqual(kinds, ["super_early", "early", "early", "regular", "regular", "late", "late", "group", "group", "super_early", "other", "super_early"]);
  });

  it("doesn't read 'Trẻ em' (child) as 'late' (folds to the same 'tre')", () => {
    // lamdong-trail-2026: this exact label was misclassified "late" instead of "regular".
    assert.equal(tierKind("Family Trail Run 5Km (1 Người lớn + 1 Trẻ em) REGULAR"), "regular");
    assert.equal(tierKind("Trẻ em"), "other");
    // A genuinely late tier that happens to mention a child should still read "late".
    assert.equal(tierKind("Đăng ký trễ - trẻ em"), "late");
  });

  it("gives tier dates without a year the race's year, or the year before when that's after race day", () => {
    assert.equal(tierDate("08/7", "2026-11-01"), "2026-07-08");
    assert.equal(tierDate("21/9", "2026-11-01"), "2026-09-21");
    // Registration for a January race opens the year before.
    assert.equal(tierDate("23/06", "2027-01-17"), "2026-06-23");
    assert.equal(tierDate("2026-09-04", "2026-11-29"), "2026-09-04");
    assert.equal(tierDate("04/09/2026", "2026-11-29"), "2026-09-04");
    assert.equal(tierDate("soon", "2026-11-29"), null);
    // Tết Run 2027's poster prints "31/11/2026".
    assert.equal(tierDate("31/11", "2027-01-24"), "2026-11-30");
    assert.equal(tierDate("31/11/2026", "2027-01-24"), "2026-11-30");
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
    assert.deepEqual(result.facts.courses.map((course) => course.label), ["3km", "10km"]);
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
    assert.deepEqual(result.facts.courses.map((course) => course.label), ["3km", "10km"]);
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

  it("counts multisport races by format, not by leg", () => {
    const race = (name: string, types: string[], distances: string[]) => {
      const result = normalizeExtraction({ pages: [{ url: "x", json: { pageKind: "sport", name, date: "2027-11-21", types, distances } }] });
      assert.ok(result.ok);
      return result.facts.courses.map((course) => course.label);
    };
    assert.deepEqual(race("SUNRISE SPRINT Viet Nam", ["triathlon"], ["750m", "20km", "5km"]), ["Sprint"]);
    assert.deepEqual(race("2027 IRONKIDS Viet Nam", ["aquathlon", "triathlon"], ["75 mét bơi và 1km chạy", "3km đạp"]), ["Kids"]);
    assert.deepEqual(race("Vietnam FesTRIval 2027", ["triathlon"], ["70.3", "56.50", "Sprint"]), ["56.50", "70.3", "Sprint"]);
    assert.deepEqual(race("Run and Tri", ["road_run", "triathlon"], ["5km"]), ["5km"]);
  });

  it("snaps standard distances", () => {
    assert.deepEqual(["21.1K", "Half Marathon", "42.195km", "10 km", "100 MILES", "5K"].map(normalizeDistance), ["21km", "21km", "42km", "10km", "100mi", "5km"]);
  });
});

// The misreads of the 2026-10-13 paid check of three untrusted race sites (default recipe).
describe("guesses the model makes on a race site", () => {
  const read = (...pages: Record<string, unknown>[]) => {
    const result = normalizeExtraction({ pages: pages.map((json, i) => ({ url: `p${i}`, json: { pageKind: "sport", ...json } })) });
    assert.ok(result.ok);
    return result.facts;
  };

  it("keeps a new read's edition only when its quote states it", () => {
    // Lamdong Trail 2026: the site says "Sau nhiều mùa tổ chức"; the model wrote 2026 and 1.
    const lamdong = read(
      { name: "Lamdong Trail 2026", date: "2026-11-06", edition: 2026, editionQuote: "" },
      { name: "Lamdong Trail", date: "2026-11-07", edition: 1, editionQuote: "" },
    );
    assert.equal(lamdong.edition, null);
    assert.equal(read({ name: "X", date: "2026-11-15", edition: 6, editionQuote: "Mùa giải thứ sáu" }).edition, 6);
    assert.equal(read({ name: "X", date: "2026-11-15", edition: 3, editionQuote: "RUN TO LV.03 INCOMING" }).edition, 3);
    // Reads made before the quote was asked for (and agent-read) keep their number.
    assert.equal(read({ name: "X", date: "2026-11-15", edition: 4 }).edition, 4);
  });

  it("gives no edition when pages of one site disagree", () => {
    // Run To Live 2027: the home page said 2, the policy page 1.
    const facts = read(
      { name: "Run To Live 2027", date: "2027-04-11", edition: 2, editionQuote: "lần thứ 2" },
      { name: "Run To Live 2027", date: "2027-04-11", edition: 1, editionQuote: "lần thứ 1" },
    );
    assert.equal(facts.edition, null);
  });

  it("matches edition words, not years", () => {
    assert.ok(statesEdition("Giải chạy lần thứ 5", 5));
    assert.ok(statesEdition("the 5th edition", 5));
    assert.ok(statesEdition("Bước sang mùa giải năm thứ sáu", 6));
    assert.ok(statesEdition("the fifth edition", 5));
    assert.ok(statesEdition("Mùa thứ IX", 9));
    assert.ok(!statesEdition("Lamdong Trail 2026", 2));
    assert.ok(!statesEdition("Sau nhiều mùa tổ chức", 1));
  });

  it("drops a count its quote doesn't state, or a target", () => {
    // Run To Live 2027: 500 from "VÉ ĐÃ BÁN TỔNG 0 vé".
    assert.equal(read({ name: "X", date: "2025-04-11", participants: { count: 500, quote: "VÉ ĐÃ BÁN TỔNG 0 vé" } }).participants, null);
    // Hạ Long 2026: a target, not a count.
    assert.equal(read({ name: "X", date: "2025-11-22", participants: { count: 18000, quote: "dự kiến thu hút khoảng 18.000 vận động viên" } }).participants, null);
    assert.equal(read({ name: "X", date: "2025-11-22", participants: { count: 10000, quote: "hơn 10.000 người đăng ký" } }).participants?.count, 10000);
    assert.ok(statesNumber("gần 7 nghìn VĐV", 7000));
    assert.ok(statesNumber("12,500 runners", 12500));
  });

  it("drops an elevation gain of 0", () => {
    const facts = read({ name: "Lamdong Trail 2026", date: "2026-11-06", distances: ["25km", "85km"], courses: [{ distance: "25Km", elevationGain: 0 }, { distance: "85Km", elevationGain: 4200 }] });
    assert.deepEqual(facts.courses.map((c) => c.elevationGain), [null, 4200]);
  });

  it("drops an old edition's tiers still on the page, but redoes a year the model put on an image", () => {
    // Hạ Long 2026's page still lists 2024 tiers; Run To Live 2027's lists May 2024 ones.
    const page = read({
      name: "Hạ Long 2026",
      date: "2026-11-22",
      prices: [
        { distance: "10KM", tier: "Early Bird", from: "2024-01-16", to: "2024-04-26", price: 1125000 },
        { distance: "10KM", tier: "Regular", from: "2026-06-01", to: "2026-09-30", price: 1250000 },
        { distance: "10KM", tier: "Late", from: "01/10", to: "31/10", price: 1400000 },
      ],
    });
    assert.deepEqual(page.prices.map((t) => t.tier), ["Regular", "Late"]);
    const image = normalizeExtraction({
      pages: [{ url: "x", json: { pageKind: "sport", name: "HCMC Marathon", date: "2027-01-17" } }],
      images: [{ url: "y", json: { prices: [{ distance: "42km", tier: "Early Bird", from: "2023-06-23", to: "2023-07-31", price: 1200000 }] } }],
    });
    assert.ok(image.ok);
    assert.equal(image.facts.prices[0]?.from, "2026-06-23");
  });
});

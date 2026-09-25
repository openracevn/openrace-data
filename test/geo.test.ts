// Written by the supervisor for plan 004 stage C. Don't edit: make the code pass it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guessCityFromText, haversineKm, isNear, loadPlaces, locate, locationKey, parseMapsUrl } from "../scripts/lib/geo.ts";

describe("point to admin units (committed ref files, no network)", () => {
  it("HCMC District 1: Bến Thành market", () => {
    const r = locate(10.7725, 106.698);
    assert.ok(r);
    assert.equal(r.current.province, "79");
    assert.equal(r.current.ward, "26743"); // Phường Bến Thành
    assert.equal(r.legacy?.province, "79");
    assert.equal(r.legacy?.district, "760"); // Quận 1
    assert.equal(r.special, false);
  });

  it("Nha Trang: the beach on Trần Phú", () => {
    const r = locate(12.2388, 109.1967);
    assert.ok(r);
    assert.equal(r.current.province, "56");
    assert.equal(r.current.ward, "22366"); // Phường Nha Trang
    assert.equal(r.legacy?.district, "568"); // the old Thành phố Nha Trang
  });

  it("a Bình Dương venue is HCMC now, and Bình Dương before", () => {
    const r = locate(10.9804, 106.6519); // Thủ Dầu Một
    assert.ok(r);
    assert.equal(r.current.province, "79");
    assert.equal(r.legacy?.province, "74");
  });

  it("Đà Lạt: Xuân Hương lake", () => {
    const r = locate(11.9404, 108.4419);
    assert.ok(r);
    assert.equal(r.current.province, "68");
    assert.equal(r.legacy?.district, "672");
  });

  it("Phú Quốc is a special zone (flight or ferry)", () => {
    const r = locate(10.227, 103.967);
    assert.ok(r);
    assert.equal(r.current.province, "91");
    assert.equal(r.current.ward, "31078");
    assert.equal(r.special, true);
  });

  it("the open sea is nowhere", () => {
    assert.equal(locate(9.0, 112.0), null);
  });
});

describe("places", () => {
  const places = loadPlaces();

  it("has the 13 places", () => {
    assert.deepEqual(
      places.map((p) => p.id),
      ["hcmc", "ha-noi", "da-nang", "nha-trang", "da-lat", "can-tho", "hai-phong", "hue", "vung-tau", "quy-nhon", "buon-ma-thuot", "sa-pa", "ha-long"],
    );
  });

  it("counts a race as near by radius or by old district", () => {
    const nhaTrang = places.find((p) => p.id === "nha-trang")!;
    const geo = (lat: number, lng: number, district: string | null) =>
      ({
        lat,
        lng,
        source: "nominatim",
        precision: "venue",
        current: { province: "56", ward: null },
        legacy: district ? { province: "56", district, ward: null } : null,
        access: "road",
        fromPlaces: {},
      }) as const;
    assert.equal(isNear(geo(12.25, 109.19, null), nhaTrang), true);
    // Far from the centre but in the old city: still Nha Trang to people.
    assert.equal(isNear(geo(12.6, 109.3, "568"), nhaTrang), true);
    assert.equal(isNear(geo(11.56, 108.99, "582"), nhaTrang), false); // Phan Rang
  });

  it("measures straight-line km", () => {
    const km = haversineKm([10.7725, 106.698], [21.0285, 105.8522]);
    assert.ok(km > 1130 && km < 1150, String(km));
  });
});

describe("keys and links", () => {
  it("folds the venue text into a cache key", () => {
    assert.equal(locationKey({ venue: "Công Viên  Bờ Hồ", city: "Hà Nội" }), "cong vien bo ho | ha noi");
    assert.equal(locationKey({ venue: null, city: null }), null);
  });

  it("reads coordinates from Google Maps links", () => {
    assert.deepEqual(parseMapsUrl("https://www.google.com/maps/place/X/@12.2388,109.1967,17z"), [12.2388, 109.1967]);
    assert.deepEqual(parseMapsUrl("https://maps.google.com/?q=10.7725,106.698"), [10.7725, 106.698]);
    assert.deepEqual(parseMapsUrl("https://www.google.com/maps/search/?api=1&query=11.9404%2C108.4419"), [11.9404, 108.4419]);
    assert.deepEqual(parseMapsUrl("https://www.google.com/maps/place/X/data=!3d16.0612!4d108.2272"), [16.0612, 108.2272]);
    assert.deepEqual(parseMapsUrl("12.2388, 109.1967"), [12.2388, 109.1967]);
    assert.equal(parseMapsUrl("https://maps.app.goo.gl/abc123"), null);
  });
});

describe("guessCityFromText: a province name found in a race's own name (last resort)", () => {
  it("matches a current province's short name, accent- and case-insensitive", () => {
    assert.equal(guessCityFromText("VnExpress Marathon Ho Chi Minh City Midnight 2026"), "Hồ Chí Minh");
    assert.equal(guessCityFromText("Giải Marathon Quốc tế Hà Nội Techcombank Mùa thứ 5"), "Hà Nội");
  });

  it("doesn't match a district, ward or pre-2025 province that no longer has its own code", () => {
    // Nha Trang is a ward of Khánh Hòa now, not one of the 34 current provinces.
    assert.equal(guessCityFromText("VnExpress Marathon Nha Trang 2026"), null);
  });

  it("returns null for no text or no match", () => {
    assert.equal(guessCityFromText(null), null);
    assert.equal(guessCityFromText("Galaxy Run 2026"), null);
  });
});

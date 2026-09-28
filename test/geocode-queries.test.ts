import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { geocodeQueries, nameMatchesQuery } from "../scripts/lib/geocode.ts";

describe("geocodeQueries: what Nominatim is asked, most specific first", () => {
  it("drops a parenthetical note and also tries the bare names without unit prefixes", () => {
    // vpbank-dat-sen-hong-music-marathon-2026: every query failed while the note and
    // the "Đường/Phường/Tỉnh" prefixes were kept; the bare form finds the street.
    const queries = geocodeQueries({
      venue: "Đường Lý Thường Kiệt, Phường Cao Lãnh, Tỉnh Đồng Tháp (phía trước công viên Văn Miếu)",
      city: null,
    });
    assert.ok(queries.every((q) => !q.includes("(") && !q.includes("phía trước")));
    assert.equal(queries[0], "Đường Lý Thường Kiệt, Phường Cao Lãnh, Tỉnh Đồng Tháp");
    assert.equal(queries[1], "Lý Thường Kiệt, Cao Lãnh, Đồng Tháp");
    assert.ok(queries.includes("Đồng Tháp"));
  });

  it("puts venue + city first and ends with the city alone", () => {
    const queries = geocodeQueries({ venue: "Công Viên Hồ Bán Nguyệt, Quận 7", city: "Thành phố Hồ Chí Minh" });
    assert.equal(queries[0], "Công Viên Hồ Bán Nguyệt, Quận 7, Thành phố Hồ Chí Minh");
    assert.equal(queries.at(-1), "Hồ Chí Minh");
    assert.ok(queries.includes("Công Viên Hồ Bán Nguyệt, Quận 7, Hồ Chí Minh"));
  });

  it("keeps the written form first even when stripping mangles a name, with no duplicates", () => {
    const queries = geocodeQueries({ venue: "Phố đi bộ Nguyễn Huệ", city: null });
    assert.deepEqual(queries, ["Phố đi bộ Nguyễn Huệ", "đi bộ Nguyễn Huệ"]);
    assert.equal(new Set(queries).size, queries.length);
  });

  it("returns nothing for no location text", () => {
    assert.deepEqual(geocodeQueries({ venue: null, city: null }), []);
  });
});

describe("nameMatchesQuery: reject Nominatim's loose matches", () => {
  it("keeps a street, landmark or admin unit named by the query", () => {
    assert.ok(nameMatchesQuery("Lý Thường Kiệt", "Lý Thường Kiệt, Cao Lãnh, Đồng Tháp"));
    assert.ok(nameMatchesQuery("Hồ Bán Nguyệt", "Công Viên Hồ Bán Nguyệt, Quận 7, Hồ Chí Minh"));
    assert.ok(nameMatchesQuery("Thành phố Hồ Chí Minh", "Hồ Chí Minh"));
  });

  it("drops a result that only shares an admin area with the query (seen live)", () => {
    assert.equal(nameMatchesQuery("Khách Sạn Thanh Long", "Thành Phố Hồ Chí Minh, Ho Chi Minh City"), false);
    assert.equal(nameMatchesQuery("Suối Đắk Nông", "Gia Nghĩa - tỉnh Đăk Nông"), false);
  });
});

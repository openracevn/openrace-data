import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatValue } from "../scripts/lib/changes.ts";

describe("Discord field values", () => {
  it("summarizes prices instead of printing [object Object]", () => {
    // 2026-10-13: Gemadept Run HCMC's price override printed "[object Object],[object Object],…".
    const prices = [
      { distance: "5km", tier: "Early Bird", price: 488000 },
      { distance: "21km", tier: "Late", price: 1180000 },
    ];
    assert.equal(formatValue(prices, "prices"), "2 price(s), 488,000–1,180,000");
    assert.equal(formatValue([], "prices"), "none");
  });

  it("keeps course labels, lists of words, objects and numbers readable", () => {
    assert.equal(formatValue([{ label: "5km" }, { label: "21km" }], "courses"), "5km, 21km");
    assert.equal(formatValue(["road_run", "trail_run"], "types"), "road_run, trail_run");
    assert.equal(formatValue([{ url: "a" }, { url: "b" }], "links"), "2 × links");
    assert.equal(formatValue({ venue: "X", city: "Y" }, "location"), '{"venue":"X","city":"Y"}');
    assert.equal(formatValue(1200000), "1,200,000");
    assert.equal(formatValue(null), "∅");
    assert.ok(!formatValue([{ a: 1 }], "registrations").includes("[object Object]"));
  });
});

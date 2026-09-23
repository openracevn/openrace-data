/**
 * Known answers: real Firecrawl reads (test/fixtures/read-*.json, 2026-09-24) must
 * normalize to the prices a person checked against the page or price image by hand.
 * Free and offline; it catches normalization changes that would break real data.
 * To add one: run `npm run check -- --race <url> --dry-run --preview <dir>`, check
 * the prices against the page by eye, save the source as a fixture, list them here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { normalizeExtraction } from "../scripts/lib/extraction.ts";

type Row = [distance: string | null, tier: string, audience: string | null, price: number, from: string | null, to: string | null];

function prices(fixture: string): Row[] {
  const { extracted } = JSON.parse(readFileSync(`test/fixtures/read-${fixture}.json`, "utf8"));
  const result = normalizeExtraction(extracted);
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.facts.prices.map((t) => [t.distance, t.kind, t.audience, t.price, t.from, t.to]);
}

const sorted = (rows: Row[]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe("known answers", () => {
  it("Pink Run 2026 (ActiUp, two price images): 10 individual + 8 group prices", () => {
    const tiers: [string, string | null, string | null, number, number][] = [
      ["super_early", "2026-07-08", "2026-07-18", 459000, 629000],
      ["early", "2026-07-19", "2026-07-31", 479000, 679000],
      ["late", "2026-08-01", "2026-09-20", 529000, 749000], // Last call
      ["late", "2026-09-21", "2026-10-05", 569000, 799000],
      ["regular", null, null, 569000, 799000], // Giá vé tiêu chuẩn
    ];
    const group: [number, number][] = [
      [510000, 720000],
      [480000, 680000],
      [450000, 640000],
      [430000, 600000],
    ];
    const expected: Row[] = [
      ...tiers.flatMap(([kind, from, to, p3, p10]): Row[] => [
        ["3km", kind, null, p3, from, to],
        ["10km", kind, null, p10, from, to],
      ]),
      ...group.flatMap(([p3, p10]): Row[] => [
        ["3km", "group", null, p3, null, null],
        ["10km", "group", null, p10, null, null],
      ]),
    ];
    assert.deepEqual(sorted(prices("pink-run-2026")), sorted(expected));
  });

  it("VnExpress Marathon Hà Nội 2026 (text table): 4 tiers × 4 distances", () => {
    const tiers: [string, string, string, number[]][] = [
      ["super_early", "2026-09-04", "2026-09-24", [420000, 480000, 660000, 780000]],
      ["early", "2026-09-25", "2026-10-15", [500000, 620000, 790000, 950000]],
      ["regular", "2026-10-16", "2026-11-06", [620000, 790000, 950000, 1150000]],
      ["late", "2026-11-07", "2026-11-19", [790000, 950000, 1150000, 1350000]],
    ];
    const distances = ["5km", "10km", "21km", "42km"];
    const expected = tiers.flatMap(([kind, from, to, byDistance]) => byDistance.map((price, i): Row => [distances[i]!, kind, null, price, from, to]));
    assert.deepEqual(sorted(prices("vm-ha-noi-2026")), sorted(expected));
  });

  it("HCMC Marathon 2027 (race site, fee image per distance): 3 distances × 4 tiers × resident/non-resident", () => {
    const dates: [string, string, string][] = [
      ["super_early", "2026-06-23", "2026-06-23"],
      ["early", "2026-06-24", "2026-07-16"],
      ["regular", "2026-07-17", "2026-09-04"], // Normal Rate
      ["late", "2026-09-05", "2026-11-05"],
    ];
    const table: Record<string, [number[], number[]]> = {
      "42km": [
        [810000, 1020000, 1450000, 1925000],
        [1250000, 1550000, 1950000, 2450000],
      ],
      "21km": [
        [720000, 930000, 1350000, 1595000],
        [1100000, 1350000, 1700000, 2100000],
      ],
      "10km": [
        [610000, 750000, 990000, 1210000],
        [900000, 1150000, 1350000, 1600000],
      ],
    };
    const expected = Object.entries(table).flatMap(([distance, [resident, nonResident]]) =>
      dates.flatMap(([kind, from, to], i): Row[] => [
        [distance, kind, "resident", resident[i]!, from, to],
        [distance, kind, "non_resident", nonResident[i]!, from, to],
      ]),
    );
    assert.deepEqual(sorted(prices("hcmc-marathon-2027")), sorted(expected));
  });
});

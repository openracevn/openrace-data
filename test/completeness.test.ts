/**
 * The completeness score (plan 023) against test/fixtures/completeness-cases.json. The same
 * fixture runs in openrace-api, so a rule change that isn't copied there fails one side.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { completeness, scoreItems, type ScoreInput, type SeriesInput } from "../scripts/lib/completeness-core.ts";

type Case = { name: string; input: ScoreInput; items: Record<string, boolean> };
const fixture = JSON.parse(readFileSync("test/fixtures/completeness-cases.json", "utf8")) as {
  today: string;
  series: SeriesInput[];
  races: Case[];
  expected: unknown;
};

describe("completeness score", () => {
  for (const c of fixture.races) {
    it(`items: ${c.name}`, () => assert.deepEqual(scoreItems(c.input, fixture.today), c.items));
  }

  it("totals, per-field order and edition coverage", () => {
    assert.deepEqual(completeness(fixture.races.map((c) => c.input), fixture.series, fixture.today), fixture.expected);
  });

  it("no races scores 100, not NaN", () => {
    const empty = completeness([], [], fixture.today);
    assert.equal(empty.score, 100);
    assert.equal(empty.editionCoverage.score, 100);
  });
});

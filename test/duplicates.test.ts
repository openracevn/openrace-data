// Plan 029: validate's standing duplicate-race check (lib/duplicates.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNotDuplicates, possibleDuplicates, type DuplicateCandidate } from "../scripts/lib/duplicates.ts";

const galaxy: DuplicateCandidate = { slug: "vnexpress-marathon-galaxy-run-2", name: "Galaxy Run 2 2026", date: "2026-11-22", province: "79" };
const samsung: DuplicateCandidate = { slug: "samsung-galaxy-run-2026", name: "Giải chạy Samsung Galaxy Run 2026", date: "2026-11-22", province: null };

describe("possible duplicate races", () => {
  it("flags the Galaxy Run pair sync added twice (name 0.60, same day)", () => {
    const pairs = possibleDuplicates([galaxy, samsung]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0]!.score.toFixed(2), "0.60");
  });

  it("flags a pair a day apart, not two days", () => {
    assert.equal(possibleDuplicates([galaxy, { ...samsung, date: "2026-11-23" }]).length, 1);
    assert.equal(possibleDuplicates([galaxy, { ...samsung, date: "2026-11-24" }]).length, 0);
  });

  it("skips races known to be in different provinces", () => {
    assert.equal(possibleDuplicates([galaxy, { ...samsung, province: "01" }]).length, 0);
  });

  it("skips unrelated names", () => {
    assert.equal(possibleDuplicates([galaxy, { ...samsung, name: "Hạ Long Bay Heritage Marathon 2026" }]).length, 0);
  });

  it("skips a reviewed pair, in either order, and ignores entries for slugs that are gone", () => {
    const reviewed = parseNotDuplicates(`
- races: [samsung-galaxy-run-2026, vnexpress-marathon-galaxy-run-2]
  reason: test
- races: [gone-a, gone-b]
  reason: merged long ago
`);
    assert.equal(possibleDuplicates([galaxy, samsung], reviewed).length, 0);
  });

  it("requires a reason", () => {
    assert.throws(() => parseNotDuplicates(`- races: [a, b]\n`));
  });
});

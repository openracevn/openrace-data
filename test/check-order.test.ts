// Plans 026, 027: which pages a check run takes first.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addCredits, isUnread, sortByUrgency, weekCredits } from "../scripts/lib/state.ts";
import type { Checks } from "../scripts/lib/state.ts";

const checks: Checks = {
  "https://x/read-unchanged": { lastCheckedAt: "2026-10-01T00:00:00.000Z", status: "ok", fingerprint: "a" },
  "https://x/facts-only": { lastCheckedAt: "2026-10-01T00:00:00.000Z", status: "facts" },
  "https://x/facts-after-read": { lastCheckedAt: "2026-10-01T00:00:00.000Z", status: "facts", fingerprint: "a" },
  "https://x/read-unchanged-2": { lastCheckedAt: "2026-10-01T00:00:00.000Z", status: "ok", fingerprint: "a" },
};

describe("unread pages", () => {
  it("are those never read in full, or unknown", () => {
    assert.equal(isUnread(checks["https://x/read-unchanged"]), false);
    assert.equal(isUnread(checks["https://x/facts-only"]), true);
    assert.equal(isUnread(checks["https://x/facts-after-read"]), false);
    assert.equal(isUnread(undefined), true);
  });

  it("come first, then the soonest race day, keeping the listing order otherwise", () => {
    const refs = [
      { url: "https://x/read-unchanged", date: "2026-11-01" },
      { url: "https://x/new" },
      { url: "https://x/facts-only", date: "2026-11-15" },
      { url: "https://x/read-unchanged-2", date: "2026-10-20" },
    ];
    const dayOf = (r: { date?: string }) => r.date ?? "9999-12-31";
    assert.deepEqual(
      sortByUrgency(refs, checks, dayOf).map((r) => r.url),
      ["https://x/facts-only", "https://x/new", "https://x/read-unchanged-2", "https://x/read-unchanged"],
    );
  });
});

describe("credits", () => {
  it("add up per month (UTC) and per day (Vietnam), and old days are dropped", () => {
    const now = new Date("2026-10-15T20:00:00Z"); // 2026-10-16 03:00 in Vietnam
    const out = addCredits({ "2026-10": 100, "2026-08-01": 5, "2026-10-16": 10 }, 25, now);
    assert.deepEqual(out, { "2026-10": 125, "2026-10-16": 35 });
  });

  it("over a week are the 7 days in Vietnam ending today", () => {
    const now = new Date("2026-10-15T03:00:00Z");
    assert.equal(weekCredits({ "2026-10": 999, "2026-10-08": 1, "2026-10-09": 2, "2026-10-15": 3, "2026-10-16": 4 }, now), 5);
  });
});

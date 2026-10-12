// Plan 026: which pages a check run takes first, and which it counts as pending.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPendingCheck, sortByUrgency } from "../scripts/lib/state.ts";
import type { Checks } from "../scripts/lib/state.ts";

const checks: Checks = {
  "https://x/read-unchanged": { lastCheckedAt: "2026-10-01T00:00:00.000Z", status: "ok", fingerprint: "a" },
  "https://x/pending": { lastCheckedAt: "2026-10-01T00:00:00.000Z", status: "ok", fingerprint: "a", pending: "b", pendingSince: "2026-10-06T00:00:00.000Z" },
  "https://x/facts-only": { lastCheckedAt: "2026-10-01T00:00:00.000Z", status: "facts" },
  "https://x/facts-after-read": { lastCheckedAt: "2026-10-01T00:00:00.000Z", status: "facts", fingerprint: "a" },
  "https://x/read-unchanged-2": { lastCheckedAt: "2026-10-01T00:00:00.000Z", status: "ok", fingerprint: "a" },
};

describe("pending pages", () => {
  it("are those changed since their last read, never read in full, or unknown", () => {
    assert.equal(isPendingCheck(checks["https://x/read-unchanged"]), false);
    assert.equal(isPendingCheck(checks["https://x/pending"]), true);
    assert.equal(isPendingCheck(checks["https://x/facts-only"]), true);
    assert.equal(isPendingCheck(checks["https://x/facts-after-read"]), false);
    assert.equal(isPendingCheck(undefined), true);
  });

  it("come first, then the soonest race day, keeping the listing order otherwise", () => {
    const refs = [
      { url: "https://x/read-unchanged", date: "2026-11-01" },
      { url: "https://x/pending", date: "2026-12-01" },
      { url: "https://x/new" },
      { url: "https://x/facts-only", date: "2026-11-15" },
      { url: "https://x/read-unchanged-2", date: "2026-10-20" },
    ];
    const dayOf = (r: { date?: string }) => r.date ?? "9999-12-31";
    assert.deepEqual(
      sortByUrgency(refs, checks, dayOf).map((r) => r.url),
      ["https://x/facts-only", "https://x/pending", "https://x/new", "https://x/read-unchanged-2", "https://x/read-unchanged"],
    );
  });
});

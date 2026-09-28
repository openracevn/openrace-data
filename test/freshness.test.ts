// Written by the supervisor for plan 004 stage B. Don't edit: make the code pass it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFreshness, freshnessStatus, type FreshnessEntry } from "../scripts/lib/freshness.ts";
import type { IndexEntry } from "../scripts/lib/schema.ts";
import type { Checks } from "../scripts/lib/state.ts";
import { loadSites } from "../scripts/lib/sites.ts";

const config = loadSites();
const ID = "0b7c9a52-3f1e-4c55-9d7c-2f1a1b2c3d4e";
const ACTIUP = "https://actiup.net/vi/event/lam-dong-trail-2026"; // weekly
const HCMC = "https://hcmcmarathon.com/"; // quarterly
const BIBCHUNG = "https://bibchung.pro/events/some-race"; // manual

const entry = (e: Partial<IndexEntry>): IndexEntry => ({
  id: ID,
  slug: "lam-dong-trail",
  name: "Lâm Đồng Trail 2026",
  date: "2026-12-06",
  endDate: null,
  mainDate: null,
  lastModified: "2026-09-20T10:00:00.000Z",
  file: "lam-dong-trail-2026.json",
  seriesId: null,
  sourceUrls: [ACTIUP],
  linkUrls: [],
  ...e,
});

const now = new Date("2026-09-24T03:00:00Z"); // 10:00 in Vietnam

describe("freshness file", () => {
  it("takes the newest ok or facts check over the race's sources, and the most frequent cadence", () => {
    const checks: Checks = {
      [ACTIUP]: { lastCheckedAt: "2026-09-21T00:00:00.000Z", status: "ok" },
      [HCMC]: { lastCheckedAt: "2026-09-23T00:00:00.000Z", status: "facts" },
    };
    const out = buildFreshness([entry({ sourceUrls: [HCMC, ACTIUP] })], checks, config, now);
    assert.deepEqual(out[ID], {
      lastCheckedAt: "2026-09-23T00:00:00.000Z",
      lastChangedAt: "2026-09-20T10:00:00.000Z",
      cadence: "weekly",
      // Newest check + 7 days, as a Vietnam date.
      dueAt: "2026-09-30",
      final: false,
    } satisfies FreshnessEntry);
  });

  it("doesn't count failed checks", () => {
    const checks: Checks = {
      [ACTIUP]: { lastCheckedAt: "2026-09-10T00:00:00.000Z", status: "ok" },
      [HCMC]: { lastCheckedAt: "2026-09-23T00:00:00.000Z", status: "error", reason: "timeout" },
    };
    const out = buildFreshness([entry({ sourceUrls: [ACTIUP, HCMC] })], checks, config, now);
    assert.equal(out[ID]!.lastCheckedAt, "2026-09-10T00:00:00.000Z");
  });

  it("marks a race final after its last day in Vietnam, and has no due date for manual sites or unchecked races", () => {
    const out = buildFreshness(
      [
        entry({ id: "11111111-1111-4111-8111-111111111111", date: "2026-09-20", endDate: "2026-09-23" }),
        entry({ id: "22222222-2222-4222-8222-222222222222", date: "2026-09-23", endDate: "2026-09-24" }),
        entry({ id: "33333333-3333-4333-8333-333333333333", sourceUrls: [BIBCHUNG] }),
      ],
      { [BIBCHUNG]: { lastCheckedAt: "2026-09-01T00:00:00.000Z", status: "ok" } },
      config,
      now,
    );
    assert.equal(out["11111111-1111-4111-8111-111111111111"]!.final, true);
    // Its last day is today in Vietnam: not over yet.
    assert.equal(out["22222222-2222-4222-8222-222222222222"]!.final, false);
    assert.equal(out["22222222-2222-4222-8222-222222222222"]!.lastCheckedAt, null);
    assert.equal(out["22222222-2222-4222-8222-222222222222"]!.dueAt, null);
    assert.equal(out["33333333-3333-4333-8333-333333333333"]!.cadence, "manual");
    assert.equal(out["33333333-3333-4333-8333-333333333333"]!.dueAt, null);
  });
});

describe("freshness status", () => {
  const base: FreshnessEntry = { lastCheckedAt: "2026-09-20T00:00:00.000Z", lastChangedAt: "2026-09-01T00:00:00.000Z", cadence: "weekly", dueAt: "2026-09-27", final: false };

  it("is fresh before the due date, due from it, stale past twice the cadence", () => {
    assert.equal(freshnessStatus(base, new Date("2026-09-26T16:00:00Z")), "fresh"); // 23:00 on the 26th in Vietnam
    assert.equal(freshnessStatus(base, new Date("2026-09-26T17:00:00Z")), "due"); // 00:00 on the 27th in Vietnam
    assert.equal(freshnessStatus(base, new Date("2026-10-04T00:00:00Z")), "due"); // exactly 14 days
    assert.equal(freshnessStatus(base, new Date("2026-10-04T00:00:01Z")), "stale");
  });

  it("is final after race day whatever the age, unscheduled for manual sites, stale when never checked", () => {
    assert.equal(freshnessStatus({ ...base, final: true, lastCheckedAt: null }, now), "final");
    assert.equal(freshnessStatus({ ...base, cadence: "manual", dueAt: null }, new Date("2027-09-01T00:00:00Z")), "unscheduled");
    assert.equal(freshnessStatus({ ...base, lastCheckedAt: null, dueAt: null }, now), "stale");
  });
});

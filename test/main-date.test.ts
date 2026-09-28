import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeExtraction } from "../scripts/lib/extraction.ts";
import { reconcile } from "../scripts/lib/reconcile.ts";
import { RaceSchema, type RaceSource } from "../scripts/lib/schema.ts";
import { parseSites } from "../scripts/lib/sites.ts";

const config = parseSites(`
monthlyCredits: 900
sites:
  - { key: actiup, name: ActiUp, kind: seller, url: "https://actiup.net/vi/events/sports", recipe: actiup, check: weekly }
  - { key: irace, name: iRace, kind: seller, url: "https://irace.vn/", hosts: [irace.vn], recipe: none }
`);

const page = (json: Record<string, unknown>) => normalizeExtraction({ pages: [{ url: "x", json: { pageKind: "sport", name: "Hanoi Heritage Race 2026", types: ["road_run"], ...json } }] });
const source = (site: string, facts: Record<string, unknown>): RaceSource => ({
  site,
  role: "seller",
  url: `https://${site}.example/race`,
  lastCheckedAt: "2026-09-28T00:00:00.000Z",
  lastChangedAt: "2026-09-28T00:00:00.000Z",
  extracted: { facts: { name: "Hanoi Heritage Race 2026", ...facts }, pages: [{ url: "x", json: { pageKind: "sport", types: ["road_run"] } }] },
});

describe("mainDate extraction", () => {
  it("keeps a stated main day inside the event's days", () => {
    const r = page({ date: "2026-11-06", endDate: "2026-11-08", mainDate: "2026-11-08" });
    assert.ok(r.ok);
    assert.equal(r.facts.mainDate, "2026-11-08");
  });

  it("drops a main day outside the days, or without an end date", () => {
    const outside = page({ date: "2026-11-06", endDate: "2026-11-08", mainDate: "2026-11-09" });
    assert.ok(outside.ok);
    assert.equal(outside.facts.mainDate, null);
    const oneDay = page({ date: "2026-11-06", mainDate: "2026-11-06" });
    assert.ok(oneDay.ok);
    assert.equal(oneDay.facts.mainDate, null);
  });

  it("is null when the page doesn't state one", () => {
    const r = page({ date: "2026-11-06", endDate: "2026-11-08" });
    assert.ok(r.ok);
    assert.equal(r.facts.mainDate, null);
  });
});

describe("first day and main day of one event", () => {
  it("is not a disagreement, and the main day is carried", () => {
    const out = reconcile([source("irace", { date: "2026-11-06", endDate: "2026-11-08", mainDate: "2026-11-08" }), source("actiup", { date: "2026-11-08" })], config);
    assert.ok("fields" in out);
    assert.equal(out.fields.date, "2026-11-06");
    assert.equal(out.fields.mainDate, "2026-11-08");
    assert.equal(out.confidence, "multi-sourced");
    assert.deepEqual(out.flags.filter((f) => f.includes("disagree")), []);
  });

  it("still flags days outside each other's range", () => {
    const out = reconcile([source("actiup", { date: "2026-11-06", endDate: "2026-11-08" }), source("irace", { date: "2026-11-20" })], config);
    assert.ok("fields" in out);
    assert.equal(out.confidence, "conflicting");
    assert.ok(out.flags.some((f) => f.includes("disagree")));
  });

  it("never copies date into mainDate", () => {
    const out = reconcile([source("actiup", { date: "2026-11-06", endDate: "2026-11-08" })], config);
    assert.ok("fields" in out);
    assert.equal(out.fields.mainDate, null);
  });
});

describe("mainDate in the schema", () => {
  const base = (over: Record<string, unknown>) => {
    const out = reconcile([source("actiup", { date: "2026-11-06", endDate: "2026-11-08" })], config);
    assert.ok("fields" in out);
    return { ...out.fields, id: "0b7c9a52-3f1e-4c55-9d7c-2f1a1b2c3d4e", slug: "hanoi-heritage-race", flags: [], overrides: {}, sources: [source("actiup", { date: "2026-11-06" })], confidence: "single-sourced", createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z", ...over };
  };

  it("accepts a main day within date..endDate", () => {
    assert.ok(RaceSchema.safeParse(base({ mainDate: "2026-11-08" })).success);
  });

  it("rejects one outside the range or without endDate", () => {
    assert.ok(!RaceSchema.safeParse(base({ mainDate: "2026-11-09" })).success);
    assert.ok(!RaceSchema.safeParse(base({ endDate: null, mainDate: "2026-11-06" })).success);
  });
});

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CLAIM_TTL_MS, claimAll, listClaims, releaseUnit } from "../scripts/lib/claims.ts";
import { overlayStore, planBatch, treeValidator } from "../scripts/lib/flush.ts";
import { formatRaceChecklist, formatSeriesChecklist, raceChecklist, seriesChecklist } from "../scripts/lib/race-gaps.ts";
import { RaceSchema, type Race } from "../scripts/lib/schema.ts";
import { loadSites } from "../scripts/lib/sites.ts";
import { archiveUnit, parseBundle, readStaged, writeBundle } from "../scripts/lib/staging.ts";
import { workspaceAt } from "../scripts/lib/workspace.ts";
import type { RaceStore } from "../scripts/sync.ts";

const load = (file: string): Race => RaceSchema.parse(JSON.parse(readFileSync(`data/races/${file}.json`, "utf8")));
const tmp = () => mkdtempSync(join(tmpdir(), "openrace-test-"));
const wsIn = (root: string) => workspaceAt(root, join(root, ".git"));

describe("race-gaps", () => {
  it("lists gaps by status and asks for participants only on past races", () => {
    const race = load("hcmc-run-2015");
    const past = raceChecklist(race, "2026-09-29");
    assert.ok(past.items.some((i) => i.field === "participants"));
    assert.ok(!past.items.some((i) => i.field === "registration link"));
    const upcoming = raceChecklist({ ...race, date: "2030-01-01", endDate: null }, "2026-09-29");
    assert.ok(!upcoming.items.some((i) => i.field === "participants"));
    assert.ok(upcoming.items.some((i) => i.field === "registration link"));
    assert.equal(upcoming.items.find((i) => i.field === "prices")?.status, "gap");
    assert.match(formatRaceChecklist(past), /gap\(s\)|no gaps/);
  });

  it("finds series year gaps, missing edition numbers and a shortfall against the stated count", () => {
    const base = load("hcmc-run-2015");
    const ed = (year: number, edition: number | null): Race => ({ ...base, slug: `s-${year}`, seriesId: "s", date: `${year}-01-10`, endDate: null, edition });
    const c = seriesChecklist({ id: "s", name: "S", statedEditionCount: 6 }, [ed(2020, 1), ed(2022, 3), ed(2023, null)]);
    assert.deepEqual(c.missingYears, [2021]);
    assert.deepEqual(c.missingEditionNumbers, [2]);
    assert.equal(c.missingByCount, 3);
    assert.match(formatSeriesChecklist(c), /short of the stated count/);
    assert.equal(seriesChecklist({ id: "s", name: "S", statedEditionCount: null }, [ed(2020, 1)]).notes.length, 1);
  });
});

describe("claims", () => {
  it("refuses a held id, allows the owner to refresh, and takes over a stale claim", () => {
    const dir = join(tmp(), "claims");
    const t0 = Date.parse("2026-09-29T10:00:00Z");
    assert.deepEqual(claimAll(dir, "a", ["race-1", "race-2"], t0).map((r) => r.ok), [true, true]);
    const second = claimAll(dir, "b", ["race-1", "race-3"], t0 + 1000);
    assert.deepEqual(second.map((r) => r.ok), [false, true]);
    assert.equal(second[0]!.ok === false && second[0]!.heldBy, "a");
    assert.equal(claimAll(dir, "a", ["race-1"], t0 + 2000)[0]!.ok, true);
    assert.equal(claimAll(dir, "b", ["race-1"], t0 + CLAIM_TTL_MS + 5000)[0]!.ok, true, "expired claim is taken over");
    assert.deepEqual(releaseUnit(dir, "b").sort(), ["race-1", "race-3"]);
    assert.deepEqual(listClaims(dir, t0).map((c) => c.id), ["race-2"]);
  });
});

describe("staging", () => {
  it("round-trips a bundle, reports a bad one without throwing, and archives without deleting", () => {
    const root = tmp();
    const ws = wsIn(root);
    writeBundle(ws, { unit: "unit-a", summary: "fill x", ops: [{ op: "set-many", race: "x", fields: { edition: 3 }, reason: "organizer page" }], deadEnds: [] });
    mkdirSync(ws.stagingDir, { recursive: true });
    writeFileSync(join(ws.stagingDir, "bad.json"), JSON.stringify({ unit: "bad", summary: "s", ops: [{ op: "set-many", race: "x", fields: { edition: 3 }, reason: "" }] }));
    const staged = readStaged(ws);
    assert.equal(staged.length, 2);
    assert.ok("error" in staged[0]! && /reason/.test(staged[0]!.error));
    assert.ok("bundle" in staged[1]!);
    assert.throws(() => parseBundle(JSON.stringify({ unit: "Bad Name", summary: "s", ops: [] })));

    mkdirSync(join(ws.workDir, "unit-a"), { recursive: true });
    writeFileSync(join(ws.workDir, "unit-a", "page.html"), "<html/>");
    claimAll(ws.claimsDir, "unit-a", ["x"]);
    const dest = archiveUnit(ws, "unit-a", "committed", "ok", new Date("2026-09-29T00:00:00Z"));
    assert.ok(dest.endsWith("2026-09-29-unit-a"));
    assert.ok(existsSync(join(dest, "bundle.json")) && existsSync(join(dest, "work", "page.html")) && existsSync(join(dest, "status.json")));
    assert.ok(!existsSync(join(ws.stagingDir, "unit-a.json")));
    assert.equal(listClaims(ws.claimsDir).length, 0);
    assert.notEqual(archiveUnit(ws, "unit-a", "rejected", "again", new Date("2026-09-29T00:00:00Z")), dest, "never overwrites an earlier archive");
  });
});

describe("flush batch", () => {
  const local: RaceStore = { read: async (path) => (existsSync(path) ? readFileSync(path, "utf8") : null) };
  const config = loadSites();
  const now = "2026-09-29T10:00:00.000Z";
  const setMany = (unit: string, race: string, fields: Record<string, unknown>) => parseBundle(JSON.stringify({ unit, summary: `set ${race}`, ops: [{ op: "set-many", race, fields, reason: "test" }] }));
  const badTier = { distance: "10km", tier: "Regular", kind: "regular", audience: null, price: 500_000, from: null, to: null, inferred: [], site: "not-a-source" };

  it("overlays written files over the base store", async () => {
    const store = overlayStore(local, { "data/x.json": "new", "data/index.json": null });
    assert.equal(await store.read("data/x.json"), "new");
    assert.equal(await store.read("data/index.json"), null);
    assert.ok((await store.read("config/sites.yaml"))?.includes("sites:"));
  });

  it("rejects a bundle that fails validation (bad prices[].site) without blocking the others", { timeout: 120_000 }, async () => {
    const bundles = [
      setMany("unit-good-1", "hcmc-marathon-2025", { edition: 12 }),
      setMany("unit-bad", "hcmc-marathon-2026", { prices: [badTier] }),
      setMany("unit-good-2", "hcmc-marathon-2024", { edition: 11 }),
    ];
    const result = await planBatch(local, bundles, config, now, treeValidator(process.cwd()));
    assert.deepEqual(result.accepted.map((a) => a.unit), ["unit-good-1", "unit-good-2"]);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0]!.unit, "unit-bad");
    assert.match(result.rejected[0]!.reason, /price site "not-a-source"/);
    assert.deepEqual(result.plan.changes.map((c) => c.slug).sort(), ["hcmc-marathon-2024", "hcmc-marathon-2025"]);
    assert.ok(!Object.values(result.plan.files).some((f) => f?.includes("not-a-source")), "the rejected bundle leaves no trace");
  });

  it("rejects a bundle naming an unknown race or field at planning time", async () => {
    const result = await planBatch(local, [setMany("unit-a", "no-such-race-1999", { edition: 1 }), setMany("unit-b", "hcmc-marathon-2025", { nonsense: 1 })], config, now, null);
    assert.equal(result.rejected.length, 2);
    assert.match(result.rejected[1]!.reason, /unknown field/);
  });

  it("merges two operations on one race into one change and reports unchanged bundles", async () => {
    const two = parseBundle(JSON.stringify({ unit: "unit-two", summary: "two ops", ops: [
      { op: "set-many", race: "hcmc-marathon-2025", fields: { edition: 12 }, reason: "a" },
      { op: "set-many", race: "hcmc-marathon-2025", fields: { seriesId: "hcmc-marathon" }, reason: "b" },
    ] }));
    const result = await planBatch(local, [two], config, now, null);
    assert.equal(result.plan.changes.length, 1);
    const file = Object.entries(result.plan.files).find(([path]) => path.endsWith("hcmc-marathon-2025.json"))![1]!;
    assert.deepEqual(Object.keys(JSON.parse(file).overrides).sort(), ["edition", "seriesId"], "the second op builds on the first");
    const empty = await planBatch(local, [parseBundle(JSON.stringify({ unit: "unit-empty", summary: "nothing", ops: [] }))], config, now, null);
    assert.deepEqual(empty.unchanged, ["unit-empty"]);
  });
});

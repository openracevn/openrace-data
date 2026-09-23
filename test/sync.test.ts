import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { verifySignature } from "../worker/src/firecrawl.ts";
import { normalizeDistance, normalizeExtracted } from "../scripts/lib/extraction.ts";
import { resolvePlace } from "../scripts/lib/places.ts";
import { INDEX_PATH, RaceSchema, racePath, type IndexEntry, type Race } from "../scripts/lib/schema.ts";
import { raceSlug } from "../scripts/lib/slug.ts";
import { formatCommitMessage, planSync, type RaceStore, type SyncInput } from "../scripts/sync.ts";

const URL_A = "https://actiup.net/en/event/tay-ho-half-marathon-2026";
const URL_B = "https://actiup.net/en/event/da-lat-ultra-trail-2026";

const extractedA = {
  isRunningRace: true,
  name: "Tay Ho Half Marathon 2026",
  date: "2026-11-15",
  distances: ["21.1K", "5 km", "10km"],
  venue: "Tay Ho Lake",
  city: "Hà Nội",
  priceMin: 300000,
  priceMax: 800000,
  currency: "VND",
  registrationStatus: "open",
  registrationUrl: "https://actiup.net/en/event/tay-ho-half-marathon-2026/register",
  organizer: "Tay Ho Sports",
  foreignerEligible: true,
};

function memoryStore(files: Record<string, string> = {}): RaceStore & { files: Record<string, string> } {
  return { files, read: async (p) => files[p] ?? null };
}

function input(url: string, extracted: Record<string, unknown>, checkedAt = "2026-09-23T10:00:00.000Z"): SyncInput {
  return { url, extracted, checkedAt };
}

async function seeded(): Promise<RaceStore & { files: Record<string, string> }> {
  const store = memoryStore();
  const plan = await planSync(store, [input(URL_A, extractedA, "2026-09-20T08:00:00.000Z")], "2026-09-20T08:00:05.000Z");
  Object.assign(store.files, plan.files);
  return store;
}

describe("planSync", () => {
  it("creates a new race file and index entry", async () => {
    const plan = await planSync(memoryStore(), [input(URL_A, extractedA)], "2026-09-23T10:00:05.000Z");
    assert.deepEqual(plan.changes, [{ id: "tay-ho-half-marathon-2026", kind: "added", fields: [] }]);

    const race = RaceSchema.parse(JSON.parse(plan.files[racePath("tay-ho-half-marathon-2026")]!));
    assert.deepEqual(race.distances, ["5km", "10km", "21km"]);
    assert.deepEqual(race.location, { venue: "Tay Ho Lake", city: "Hanoi", region: "north" });
    assert.equal(race.confidence, "single-sourced");
    assert.equal(race.sources.length, 1);
    assert.equal(race.sources[0]!.lastChangedAt, "2026-09-23T10:00:00.000Z");
    assert.deepEqual(race.sources[0]!.rawExtracted, extractedA);
    assert.equal(race.createdAt, race.updatedAt);

    const index = JSON.parse(plan.files[INDEX_PATH]!) as IndexEntry[];
    assert.deepEqual(index, [{ id: "tay-ho-half-marathon-2026", lastModified: "2026-09-23T10:00:05.000Z", sourceUrls: [URL_A] }]);
  });

  it("writes nothing when the extraction is unchanged", async () => {
    const store = await seeded();
    const plan = await planSync(store, [input(URL_A, { ...extractedA, distances: ["5K", "10 km", "Half Marathon"] })]);
    assert.deepEqual(plan.files, {});
    assert.deepEqual(plan.changes, []);
  });

  it("updates changed fields and bumps updatedAt + source lastChangedAt", async () => {
    const store = await seeded();
    const plan = await planSync(
      store,
      [input(URL_A, { ...extractedA, registrationStatus: "sold_out", priceMax: 900000 }, "2026-09-23T10:00:00.000Z")],
      "2026-09-23T10:00:05.000Z",
    );
    assert.deepEqual(plan.changes, [{ id: "tay-ho-half-marathon-2026", kind: "updated", fields: ["priceMax", "registrationStatus"] }]);
    const race = JSON.parse(plan.files[racePath("tay-ho-half-marathon-2026")]!) as Race;
    assert.equal(race.createdAt, "2026-09-20T08:00:05.000Z");
    assert.equal(race.updatedAt, "2026-09-23T10:00:05.000Z");
    assert.equal(race.sources[0]!.lastChangedAt, "2026-09-23T10:00:00.000Z");
    assert.equal(race.registrationStatus, "sold_out");
    assert.match(formatCommitMessage(plan), /^data: 1 updated\n\n~ tay-ho-half-marathon-2026: priceMax, registrationStatus$/);
  });

  it("keeps the id when a race is renamed", async () => {
    const store = await seeded();
    const plan = await planSync(store, [input(URL_A, { ...extractedA, name: "VPBank Tay Ho Half Marathon 2026" })]);
    assert.deepEqual(Object.keys(plan.files).sort(), [INDEX_PATH, racePath("tay-ho-half-marathon-2026")]);
    assert.deepEqual(plan.changes[0]!.fields, ["name"]);
  });

  it("batches several races into one plan and suffixes colliding slugs", async () => {
    const store = await seeded();
    const plan = await planSync(store, [
      input(URL_B, { isRunningRace: true, name: "Da Lat Ultra Trail", date: "2026-06-20", city: "Đà Lạt", distances: ["70km", "42km"] }),
      input("https://actiup.net/en/event/tay-ho-hm-other", extractedA),
    ]);
    assert.deepEqual(
      plan.changes.map((c) => c.id),
      ["da-lat-ultra-trail-2026", "tay-ho-half-marathon-2026-2"],
    );
    const index = JSON.parse(plan.files[INDEX_PATH]!) as IndexEntry[];
    assert.deepEqual(
      index.map((e) => e.id),
      ["da-lat-ultra-trail-2026", "tay-ho-half-marathon-2026", "tay-ho-half-marathon-2026-2"],
    );
  });

  it("skips non-event pages and unusable extractions", async () => {
    const plan = await planSync(memoryStore(), [
      input("https://actiup.net/en/events/sports", extractedA),
      input(URL_B, { isRunningRace: false, name: "Cycling Tour", date: "2026-06-20" }),
      input("https://actiup.net/en/event/no-date", { isRunningRace: true, name: "No Date Run" }),
    ]);
    assert.deepEqual(plan.files, {});
    assert.equal(plan.skipped.length, 3);
  });
});

describe("normalization", () => {
  it("snaps standard distances", () => {
    assert.equal(normalizeDistance("42.195 KM"), "42km");
    assert.equal(normalizeDistance("Half Marathon"), "21km");
    assert.equal(normalizeDistance("Full Marathon"), "42km");
    assert.equal(normalizeDistance("Ultra Marathon 70K"), "70km");
    assert.equal(normalizeDistance("12,5km"), "12.5km");
  });

  it("resolves Vietnamese city names to display name + region", () => {
    assert.deepEqual(resolvePlace("TP. Hồ Chí Minh"), { city: "Ho Chi Minh City", region: "south" });
    assert.deepEqual(resolvePlace("Đà Nẵng"), { city: "Da Nang", region: "central" });
    assert.deepEqual(resolvePlace("Tỉnh Lào Cai"), { city: "Lao Cai", region: "north" });
    assert.deepEqual(resolvePlace("Atlantis"), { city: "Atlantis", region: null });
  });

  it("parses DD/MM/YYYY dates and string prices", () => {
    const r = normalizeExtracted({ name: "X", date: "5/1/2027", priceMin: "350.000đ", priceMax: "200000" });
    assert.ok(r.ok);
    assert.equal(r.race.date, "2027-01-05");
    assert.equal(r.race.priceMin, 200000);
    assert.equal(r.race.priceMax, 350000);
    assert.equal(r.race.registrationStatus, null);
  });

  it("builds slugs from name and year", () => {
    assert.equal(raceSlug("Tây Hồ Half Marathon", "2026-11-15"), "tay-ho-half-marathon-2026");
    assert.equal(raceSlug("Tay Ho Half Marathon 2026", "2026-11-15"), "tay-ho-half-marathon-2026");
  });
});

describe("verifySignature", () => {
  const secret = "whsec_test";
  const body = new TextEncoder().encode(JSON.stringify({ type: "monitor.check.completed" }));
  const good = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a valid Firecrawl signature", async () => {
    assert.equal(await verifySignature(body.buffer, good, secret), true);
  });

  it("rejects a wrong secret, tampered body, or malformed header", async () => {
    assert.equal(await verifySignature(body.buffer, good, "other"), false);
    assert.equal(await verifySignature(new TextEncoder().encode("{}").buffer, good, secret), false);
    assert.equal(await verifySignature(body.buffer, good.replace("sha256", "sha1"), secret), false);
    assert.equal(await verifySignature(body.buffer, null, secret), false);
  });
});

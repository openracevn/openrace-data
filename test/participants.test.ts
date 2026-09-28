import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeExtraction, type SourceFacts } from "../scripts/lib/extraction.ts";
import { pickParticipants } from "../scripts/lib/reconcile.ts";
import { ParticipantsSchema, upgradeRace, type RaceSource } from "../scripts/lib/schema.ts";

const source = (site: string, role: RaceSource["role"], lastCheckedAt: string): RaceSource => ({
  site,
  role,
  url: `https://${site}.example/race`,
  lastCheckedAt,
  lastChangedAt: lastCheckedAt,
  extracted: {},
});
const facts = (participants: SourceFacts["participants"]) => ({ participants }) as SourceFacts;

const stated = (count: number, quote: string | null, sourceUrl: string | null = null) => facts({ count, sourceUrl, quote });

describe("participants", () => {
  it("rejects a count with no link, no confidence, or a zero count", () => {
    assert.equal(ParticipantsSchema.safeParse({ count: 2000, confidence: "low" }).success, false);
    assert.equal(ParticipantsSchema.safeParse({ count: 0, sourceUrl: "https://a.example/x", confidence: "low" }).success, false);
    assert.equal(ParticipantsSchema.safeParse({ count: 2000, sourceUrl: "https://a.example/x" }).success, false);
    assert.equal(ParticipantsSchema.safeParse({ count: 2000, sourceUrl: "https://a.example/x", quote: "~2000", confidence: "medium" }).success, true);
  });

  it("reads a stated count, dropping zero and non-integers and any approx flag", () => {
    const read = (participants: unknown) => {
      const r = normalizeExtraction({ facts: { name: "X", date: "2024-05-01", participants } });
      assert.ok(r.ok);
      return r.facts.participants;
    };
    assert.deepEqual(read({ count: 2000, approx: true, quote: "~2000" }), { count: 2000, sourceUrl: null, quote: "~2000" });
    assert.equal(read({ count: 0 }), null);
    assert.equal(read({ count: 12.5 }), null);
    assert.equal(read(undefined), null);
  });

  it("prefers official, then the most recent", () => {
    const official = { source: source("own", "official", "2026-01-01T00:00:00Z"), facts: stated(2000, "2000 VĐV", "https://own.example/recap") };
    const seller = { source: source("shop", "seller", "2026-02-01T00:00:00Z"), facts: stated(2317, null) };
    assert.equal(pickParticipants([seller, official])?.count, 2000);
    const older = { source: source("a", "reference", "2026-01-01T00:00:00Z"), facts: stated(100, null) };
    const newer = { source: source("b", "reference", "2026-03-01T00:00:00Z"), facts: stated(120, null) };
    assert.equal(pickParticipants([older, newer])?.count, 120);
    assert.equal(pickParticipants([{ source: source("s", "seller", "2026-01-01T00:00:00Z"), facts: facts(null) }]), null);
  });

  it("derives confidence from the source and the quote, and never keeps approx", () => {
    const official = { source: source("own", "official", "2026-01-01T00:00:00Z"), facts: stated(2000, "2000 VĐV") };
    const news = { source: source("news", "reference", "2026-02-01T00:00:00Z"), facts: stated(2200, "hơn 2.200 người") };
    const farNews = { source: source("far", "reference", "2026-02-01T00:00:00Z"), facts: stated(9000, "9.000 người") };
    const bare = { source: source("bare", "seller", "2026-02-01T00:00:00Z"), facts: stated(2000, null) };
    assert.equal(pickParticipants([official])?.confidence, "high");
    assert.equal(pickParticipants([news])?.confidence, "medium");
    assert.equal(pickParticipants([bare])?.confidence, "low");
    assert.equal(pickParticipants([news, { ...farNews, source: source("far", "reference", "2026-01-01T00:00:00Z") }])?.confidence, "medium");
    assert.equal(pickParticipants([news, { ...official, source: source("own", "reference", "2026-01-01T00:00:00Z") }])?.confidence, "high");
    assert.ok(!("approx" in pickParticipants([news])!));
    // an agreeing source with no quote does not lift a quoted reference
    assert.equal(pickParticipants([news, bare])?.confidence, "medium");
  });

  it("upgrade drops approx and gives a stand-in confidence", () => {
    const up = upgradeRace({ participants: { count: 5, approx: true, sourceUrl: "https://a.example/x", quote: "5" }, courses: [], geo: null, edition: null }) as { participants: Record<string, unknown> };
    assert.deepEqual(up.participants, { count: 5, sourceUrl: "https://a.example/x", quote: "5", confidence: "medium" });
  });
});

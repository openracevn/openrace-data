import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeExtraction, type SourceFacts } from "../scripts/lib/extraction.ts";
import { pickParticipants } from "../scripts/lib/reconcile.ts";
import { ParticipantsSchema, type RaceSource } from "../scripts/lib/schema.ts";

const source = (site: string, role: RaceSource["role"], lastCheckedAt: string): RaceSource => ({
  site,
  role,
  url: `https://${site}.example/race`,
  lastCheckedAt,
  lastChangedAt: lastCheckedAt,
  extracted: {},
});
const facts = (participants: SourceFacts["participants"]) => ({ participants }) as SourceFacts;

describe("participants", () => {
  it("rejects a count with no link, or a zero count", () => {
    assert.equal(ParticipantsSchema.safeParse({ count: 2000, approx: true }).success, false);
    assert.equal(ParticipantsSchema.safeParse({ count: 0, approx: false, sourceUrl: "https://a.example/x" }).success, false);
    assert.equal(ParticipantsSchema.safeParse({ count: 2000, approx: true, sourceUrl: "https://a.example/x", quote: "~2000" }).success, true);
  });

  it("reads a stated count, dropping zero and non-integers", () => {
    const read = (participants: unknown) => {
      const r = normalizeExtraction({ facts: { name: "X", date: "2024-05-01", participants } });
      assert.ok(r.ok);
      return r.facts.participants;
    };
    assert.deepEqual(read({ count: 2000, approx: true, quote: "~2000" }), { count: 2000, approx: true, sourceUrl: null, quote: "~2000" });
    assert.equal(read({ count: 0, approx: false }), null);
    assert.equal(read({ count: 12.5, approx: false }), null);
    assert.equal(read(undefined), null);
  });

  it("prefers official, then precise, then recent", () => {
    const official = { source: source("own", "official", "2026-01-01T00:00:00Z"), facts: facts({ count: 2000, approx: true, sourceUrl: "https://own.example/recap", quote: null }) };
    const seller = { source: source("shop", "seller", "2026-02-01T00:00:00Z"), facts: facts({ count: 2317, approx: false, sourceUrl: null, quote: null }) };
    assert.equal(pickParticipants([seller, official])?.count, 2000);
    const precise = { source: source("own2", "official", "2026-01-01T00:00:00Z"), facts: facts({ count: 2317, approx: false, sourceUrl: null, quote: null }) };
    assert.deepEqual(pickParticipants([official, precise]), { count: 2317, approx: false, sourceUrl: "https://own2.example/race" });
    assert.equal(pickParticipants([{ source: source("s", "seller", "2026-01-01T00:00:00Z"), facts: facts(null) }]), null);
  });
});

// Plan 026, step 5: the Monday data digest's rules (lib/digest.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DISCORD_LIMIT, buildDigest, freshnessShare, needsYou, pendingPages, type DigestInput } from "../scripts/lib/digest.ts";
import type { FreshnessEntry } from "../scripts/lib/freshness.ts";
import { RaceSchema, type IndexEntry, type Race } from "../scripts/lib/schema.ts";
import { parseSites } from "../scripts/lib/sites.ts";
import type { Checks } from "../scripts/lib/state.ts";

const config = parseSites(`
monthlyCredits: 900
scheduledMonthlyCredits: 600
sites:
  - { key: actiup, name: ActiUp, kind: seller, url: "https://actiup.net/vi/events/sports", recipe: actiup, check: weekly, trusted: true }
  - { key: halong-marathon, name: Hạ Long Marathon, kind: race-site, url: "https://halongmarathon.com/", recipe: default, check: quarterly }
`);

const now = new Date("2026-10-13T03:00:00Z"); // 10:00 in Vietnam, 2026-10-13
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const entry = (n: number, e: Partial<IndexEntry>): IndexEntry => ({
  id: ID(n),
  slug: `race-${n}`,
  name: `Race ${n}`,
  date: "2026-12-01",
  endDate: null,
  mainDate: null,
  lastModified: "2026-10-01T00:00:00.000Z",
  file: `race-${n}-2026.json`,
  seriesId: null,
  sourceUrls: [`https://actiup.net/vi/event/race-${n}`],
  linkUrls: [],
  ...e,
});

const fresh = (f: Partial<FreshnessEntry>): FreshnessEntry => ({ lastCheckedAt: "2026-10-12T00:00:00.000Z", lastChangedAt: "2026-10-01T00:00:00.000Z", cadence: "weekly", dueAt: "2026-10-19", final: false, ...f });

/** A valid race file with the given fields on top of a complete one. */
function race(n: number, r: Partial<Race> = {}): Race {
  return RaceSchema.parse({
    id: ID(n),
    slug: `race-${n}`,
    name: `Race ${n}`,
    types: ["road_run"],
    date: "2026-12-01",
    endDate: null,
    mainDate: null,
    seriesId: "some-series",
    organizerId: "org",
    organizer: "Org",
    edition: 3,
    courses: [{ label: "10km", meters: 10_000, type: "road_run", elevationGain: null }],
    location: { venue: "Somewhere", city: "Hà Nội" },
    geo: null,
    prices: [{ distance: "10km", tier: "Regular", kind: "regular", audience: null, price: 500_000, from: null, to: null, inferred: [], site: "actiup" }],
    currency: "VND",
    registrationStatus: "open",
    registrations: [{ site: "actiup", url: `https://actiup.net/vi/event/race-${n}` }],
    links: [],
    participants: null,
    flags: [],
    overrides: {},
    sources: [{ site: "actiup", role: "seller", url: `https://actiup.net/vi/event/race-${n}`, lastCheckedAt: "2026-10-12T00:00:00.000Z", lastChangedAt: "2026-10-01T00:00:00.000Z", extracted: { facts: { name: `Race ${n}`, date: "2026-12-01" } } }],
    confidence: "single-sourced",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...r,
  });
}

const base = (over: Partial<DigestInput> = {}): DigestInput => ({ index: [], races: new Map(), freshness: {}, checks: {}, config, credits: { "2026-10": 150 }, now, ...over });

describe("data digest", () => {
  it("recomputes final from the index's dates, so a race that took place since the last commit isn't counted", () => {
    const index = [entry(1, { date: "2026-10-12" }), entry(2, {})];
    const freshness = { [ID(1)]: fresh({ lastCheckedAt: "2026-09-01T00:00:00.000Z" }), [ID(2)]: fresh({}) };
    assert.deepEqual(freshnessShare(index, freshness, now), { fresh: 1, due: 0, stale: 0, final: 0, unscheduled: 0, total: 1 });
    assert.deepEqual(needsYou(base({ index, freshness })), []);
  });

  it("splits pending pages by trusted site, and counts a page no race has yet", () => {
    const index = [entry(1, {}), entry(2, { sourceUrls: ["https://halongmarathon.com/"] }), entry(3, { date: "2026-10-01" })];
    const checks: Checks = {
      "https://actiup.net/vi/event/race-1": { lastCheckedAt: "2026-10-13T00:00:00.000Z", status: "ok", fingerprint: "a", pending: "b" },
      "https://halongmarathon.com/": { lastCheckedAt: "2026-10-13T00:00:00.000Z", status: "ok", fingerprint: "a", pending: "b" },
      "https://actiup.net/vi/event/race-3": { lastCheckedAt: "2026-10-13T00:00:00.000Z", status: "facts" }, // final race: not counted
      "https://ticket.irace.vn/new-race": { lastCheckedAt: "2026-10-13T00:00:00.000Z", status: "facts" }, // no race yet: counted
      "https://actiup.net/vi/event/read": { lastCheckedAt: "2026-10-13T00:00:00.000Z", status: "ok", fingerprint: "a" },
    };
    const pages = pendingPages(index, checks, config, now);
    assert.deepEqual(
      pages.map((p) => [p.name, p.trusted]),
      [
        ["Race 1", true],
        ["Race 2", false],
        ["https://ticket.irace.vn/new-race", false],
      ],
    );
    const text = buildDigest(base({ index, checks }));
    assert.match(text, /Pending a paid read: 3 pages, about 30 credits \(Tuesday's run takes 1; 2 wait for a check by hand: Race 2 on halongmarathon.com, https:\/\/ticket.irace.vn\/new-race on ticket.irace.vn\)/);
  });

  it("lists stale races first (oldest check first), then gaps by race day, and not a race with only a series gap", () => {
    const index = [entry(1, { date: "2026-11-01" }), entry(2, { date: "2026-12-01" }), entry(3, { date: "2026-11-15" }), entry(4, { date: "2026-10-20" }), entry(5, {})];
    const freshness = {
      [ID(1)]: fresh({}),
      [ID(2)]: fresh({ lastCheckedAt: "2026-09-20T00:00:00.000Z" }), // stale
      [ID(3)]: fresh({ lastCheckedAt: "2026-09-10T00:00:00.000Z" }), // staler
      [ID(4)]: fresh({}),
      [ID(5)]: fresh({}),
    };
    const races = new Map([
      [ID(1), race(1, { prices: [], seriesId: null })],
      [ID(2), race(2)],
      [ID(3), race(3, { prices: [] })],
      [ID(4), race(4, { location: { venue: null, city: null } })],
      [ID(5), race(5, { seriesId: null, edition: null })], // a one-off: not listed
    ]);
    assert.deepEqual(
      needsYou(base({ index, freshness, races })).map((r) => [r.name, r.reasons]),
      [
        ["Race 3", ["stale since 2026-09-10", "no prices"]],
        ["Race 2", ["stale since 2026-09-20"]],
        ["Race 4", ["no venue"]],
        ["Race 1", ["no prices", "no series"]],
      ],
    );
  });

  it("doesn't ask a person for prices, courses or types while Tuesday's run has the page pending", () => {
    const index = [entry(1, {}), entry(2, { sourceUrls: ["https://halongmarathon.com/"] })];
    const races = new Map([
      [ID(1), race(1, { prices: [], courses: [] })],
      [ID(2), race(2, { prices: [] })],
    ]);
    const checks: Checks = {
      "https://actiup.net/vi/event/race-1": { lastCheckedAt: "2026-10-13T00:00:00.000Z", status: "facts" },
      "https://halongmarathon.com/": { lastCheckedAt: "2026-10-13T00:00:00.000Z", status: "ok", fingerprint: "a", pending: "b" },
    };
    const freshness = { [ID(1)]: fresh({}), [ID(2)]: fresh({}) };
    // Race 1: ActiUp (trusted) reads it on Tuesday. Race 2: an untrusted site, so a person must check it.
    assert.deepEqual(
      needsYou(base({ index, races, checks, freshness })).map((r) => [r.name, r.reasons]),
      [["Race 2", ["no prices"]]],
    );
  });

  it("names the distances without a price when a race has some prices", () => {
    const index = [entry(1, {})];
    const base1 = race(1, {});
    const races = new Map([[ID(1), race(1, { courses: [...base1.courses, { label: "2km", meters: 2000, type: "road_run", elevationGain: null }] })]]);
    assert.deepEqual(
      needsYou(base({ index, races, freshness: { [ID(1)]: fresh({}) } })).map((r) => r.reasons),
      [["no price for 2km"]],
    );
  });

  it("stays under Discord's limit with many races and says how many were left out", () => {
    const index = Array.from({ length: 40 }, (_, i) => entry(i + 1, { name: `A race with a fairly long Vietnamese name number ${i + 1} – Giải chạy ${i + 1}` }));
    const races = new Map(index.map((e, i) => [e.id, race(i + 1, { prices: [], location: { venue: null, city: null } })]));
    const freshness = Object.fromEntries(index.map((e) => [e.id, fresh({})]));
    const text = buildDigest(base({ index, races, freshness }));
    assert.ok(text.length <= DISCORD_LIMIT, `${text.length} chars`);
    assert.match(text, /Needs you: 40 races/);
    assert.match(text, /…and \d+ more/);
    assert.match(text, /Credits this month: 150 of 600 scheduled \(900 cap\)$/);
  });
});

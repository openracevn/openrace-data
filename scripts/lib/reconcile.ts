import { guessCityFromText } from "./geo.ts";
import { canonicalSourceUrl } from "./slug.ts";
import { vndRate } from "./fx.ts";
import { normalizeExtraction, type SourceExtraction, type SourceFacts } from "./extraction.ts";
import { MIN_PRICE, type CanonicalRace, type Link, type Overrides, type PriceTier, type Race, type RaceSource, type Registration, type SourceRole } from "./schema.ts";
import { classifyLink, type SitesConfig } from "./sites.ts";

/**
 * Hints a recipe or the site config attaches to a source: the series and organizer
 * its races belong to (e.g. hcmcmarathon.com → series hcmc-marathon, Pulse Active).
 */
export type EntityRef = { id: string; name: string; website?: string };
export type SourceHints = { series?: EntityRef; organizer?: EntityRef };
export type StoredExtraction = SourceExtraction & SourceHints;

/**
 * A usable series/organizer: a slug id and a name of at most 200 characters. Sites
 * sometimes put a whole sentence in the organizer field ("Đơn vị chỉ đạo: ... –
 * Đơn vị tổ chức: ..."); that stays the race's organizer text, not an entity.
 */
export function isEntityRef(h: unknown): h is EntityRef {
  const r = h as EntityRef | undefined;
  return typeof r?.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.id) && r.id.length <= 120 && typeof r.name === "string" && r.name.length > 0 && r.name.length <= 200;
}

export type Reconciled = { fields: CanonicalRace; confidence: Race["confidence"]; flags: string[] };

// Facts that should be the same everywhere come from the race's own site first.
const ROLE_RANK: Record<SourceRole, number> = { official: 0, seller: 1, reference: 2 };

// Within the same role, some sellers give more specific facts than others:
// ticket.irace.vn's own event page beats irace.vn's blog-style write-up, and both
// beat ActiUp, whose venue/organizer fields are frequently left "TBU" by organizers.
// Sites not listed here keep their original (insertion) order, between irace and ActiUp.
function siteRank(source: RaceSource): number {
  if (source.site === "irace") return source.url.includes("ticket.irace.vn") ? 0 : 1;
  if (source.site === "actiup") return 3;
  return 2;
}

/**
 * Derive a race's fields from all its sources.
 * - name, date, courses, location, ...: the first source that states them, official sites first.
 * - prices: every source's tiers, each labeled with its site (sellers can differ).
 * - registrations: every seller page, and seller links found on the pages.
 * - links: every outbound link found on the pages, classified.
 * confidence: single-sourced (one usable source), multi-sourced (several, agreeing on
 * race day), conflicting (they disagree on race day; see flags).
 */
export function reconcile(sources: readonly RaceSource[], config: SitesConfig): Reconciled | { error: string } {
  const ranked = [...sources].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || siteRank(a) - siteRank(b));
  const usable: { source: RaceSource; facts: SourceFacts }[] = [];
  const reasons: string[] = [];
  for (const source of ranked) {
    const result = normalizeExtraction(source.extracted);
    if (result.ok) usable.push({ source, facts: result.facts });
    else reasons.push(`${source.site}: ${result.reason}`);
  }
  const primary = usable[0];
  if (!primary) return { error: reasons.join("; ") || "no sources" };

  const first = <T>(read: (f: SourceFacts) => T | null, empty: (v: T) => boolean = () => false): T | null => {
    for (const { facts } of usable) {
      const v = read(facts);
      if (v !== null && !empty(v)) return v;
    }
    return null;
  };
  const withLocation = usable.find(({ facts }) => facts.venue !== null || facts.city !== null)?.facts;
  // No source states a city: last resort, look for a current province's name in the
  // race's own name (a title that drops the city a page states elsewhere still won't
  // catch it here; that needs the recipe to know where the site puts it).
  const guessedCity = !withLocation ? guessCityFromText(primary.facts.name) : null;
  const hints = (key: keyof SourceHints) => ranked.map((s) => (s.extracted as StoredExtraction)[key]).find(isEntityRef) ?? null;
  const courseSource = usable.find(({ facts }) => facts.courses.length > 0);
  const courses = (courseSource?.facts.courses ?? []).map((course) => ({
    ...course,
    type:
      course.type ??
      usable
        .filter(({ source }) => source !== courseSource?.source)
        .flatMap(({ facts }) => facts.courses)
        .find((other) => other.label === course.label && other.type !== null)?.type ??
      null,
    elevationGain:
      course.elevationGain ??
      usable
        .filter(({ source }) => source !== courseSource?.source)
        .flatMap(({ facts }) => facts.courses)
        .find((other) => other.label === course.label && other.elevationGain !== null)?.elevationGain ??
      null,
  }));
  const fxFlags: string[] = [];
  const rawPrices: PriceTier[] = usable.flatMap(({ source, facts }) => convertTiers(source, facts, primary.facts.date, fxFlags));
  const { registrations, links } = relatedUrls(ranked, config);

  const fields: CanonicalRace = {
    name: primary.facts.name,
    types: first((f) => f.types, (t) => t.join() === "other") ?? primary.facts.types,
    date: primary.facts.date,
    endDate: primary.facts.endDate,
    // Only a stated main day inside the primary's own days; never copied from `date`.
    mainDate:
      primary.facts.endDate === null
        ? null
        : first((f) => (f.mainDate !== null && f.mainDate >= primary.facts.date && f.mainDate <= primary.facts.endDate! ? f.mainDate : null)),
    seriesId: hints("series")?.id ?? null,
    organizerId: hints("organizer")?.id ?? null,
    // An organizer named in the site list beats the model's reading of a page.
    organizer: hints("organizer")?.name ?? first((f) => f.organizer),
    edition: first((f) => f.edition),
    courses,
    location: { venue: withLocation?.venue ?? null, city: withLocation?.city ?? guessedCity },
    geo: null,
    prices: fillTierWindows(rawPrices, primary.facts.date),
    // One currency for every race; a source's own currency is preserved per tier
    // in priceOriginal/fxRate when it wasn't VND (see convertTiers).
    currency: "VND",
    // Sellers know best whether tickets are left.
    registrationStatus:
      usable.find(({ source, facts }) => source.role === "seller" && facts.registrationStatus !== null)?.facts.registrationStatus ??
      first((f) => f.registrationStatus),
    registrations,
    links,
    participants: pickParticipants(usable),
  };

  const flags: string[] = [...fxFlags];
  for (const tier of fields.prices) {
    if (tier.price > 0 && tier.price < MIN_PRICE && !tier.priceOriginal) {
      flags.push(`${tier.site}: ${tier.distance ?? "price"} price ${tier.price} VND is below the plausible floor (${MIN_PRICE}) — check the source`);
    }
  }
  if (guessedCity) flags.push(`location: no source states a city; guessed "${guessedCity}" from the race's name`);
  const dates = new Map(usable.map(({ source, facts }) => [source.site, facts.date]));
  // Sources give the first day or the main day of one event; they only disagree when
  // one's day is outside the other's date..endDate.
  const agree = usable.every((a) => usable.every((b) => sameRaceDay(a.facts, b.facts)));
  if (!agree) {
    flags.push(`sources disagree on race day: ${usable.map(({ source, facts }) => `${source.site} ${facts.date}${facts.endDate ? `..${facts.endDate}` : ""}`).join(", ")}`);
  }
  const official = usable.find(({ source }) => source.role === "official");
  for (const { source, facts } of usable) {
    const labels = facts.courses.map((course) => course.label);
    const officialLabels = official?.facts.courses.map((course) => course.label) ?? [];
    if (!official || source === official.source || labels.length === 0 || officialLabels.length === 0) continue;
    if (labels.join() !== officialLabels.join()) {
      flags.push(`${source.site} lists courses ${labels.join(", ")}; the official site ${officialLabels.join(", ")}`);
    }
  }

  const stated = usable.flatMap(({ facts }) => (facts.participants ? [facts.participants.count] : []));
  if (stated.length > 1 && Math.max(...stated) > Math.min(...stated) * (1 + PARTICIPANTS_CONFLICT)) {
    flags.push(`participants-conflict: sources state ${[...new Set(stated)].join(", ")} participants`);
  }

  const confidence: Race["confidence"] = usable.length === 1 ? "single-sourced" : dates.size > 0 && agree ? "multi-sourced" : "conflicting";
  return { fields, confidence, flags };
}

/** Two sources agree on the race day when one's first day falls inside the other's days. */
function sameRaceDay(a: SourceFacts, b: SourceFacts): boolean {
  const within = (x: SourceFacts, y: SourceFacts) => x.date >= y.date && x.date <= (y.endDate ?? y.date);
  return within(a, b) || within(b, a);
}

// Sources whose stated counts differ by more than this share get a flag.
const PARTICIPANTS_CONFLICT = 0.25;

/**
 * The stated participant count to serve: official source first, then the most recent
 * source read. A source that states a count without a link is linked to its own page.
 * Never a guess: no source states one, no count. `confidence` is derived here:
 * high = a quote from an official source, or two quoted sources within 25%;
 * medium = a quote from a reference or seller; low = no quote (a search summary).
 */
export function pickParticipants(usable: readonly { source: RaceSource; facts: SourceFacts }[]): CanonicalRace["participants"] {
  const stated = usable.flatMap(({ source, facts }) => (facts.participants ? [{ source, p: facts.participants }] : []));
  stated.sort(
    (a, b) =>
      Number(a.source.role !== "official") - Number(b.source.role !== "official") ||
      b.source.lastCheckedAt.localeCompare(a.source.lastCheckedAt),
  );
  const best = stated[0];
  if (!best) return null;
  const agreed = stated.some(
    (other) => other !== best && other.p.quote && Math.max(other.p.count, best.p.count) <= Math.min(other.p.count, best.p.count) * (1 + PARTICIPANTS_CONFLICT),
  );
  const confidence = !best.p.quote ? "low" : best.source.role === "official" || agreed ? "high" : "medium";
  return {
    count: best.p.count,
    sourceUrl: best.p.sourceUrl ?? best.source.url,
    ...(best.p.quote ? { quote: best.p.quote } : {}),
    confidence,
  };
}

/**
 * A source's tiers, converted to VND at each tier's own sale-window rate (its `from`,
 * falling back to the race date) when the source's currency isn't VND. A tier whose
 * date has no cached rate is dropped (never guessed) and flagged instead — run
 * `npm run fx:ref` to refresh the cache.
 */
function convertTiers(source: RaceSource, facts: SourceFacts, raceDate: string, flags: string[]): PriceTier[] {
  const out: PriceTier[] = [];
  for (const tier of facts.prices) {
    if (facts.currency === "VND") {
      out.push({ ...tier, site: source.site, inferred: [] });
      continue;
    }
    const fx = vndRate(facts.currency, tier.from ?? raceDate);
    if (!fx) {
      flags.push(`${source.site}: prices stated in ${facts.currency}, no VND rate cached for ${tier.from ?? raceDate} — needs scripts/fx-ref.ts run`);
      continue;
    }
    out.push({
      ...tier,
      site: source.site,
      inferred: [],
      price: Math.round(tier.price * fx.rate),
      priceOriginal: { currency: facts.currency, amount: tier.price },
      fxRate: fx,
    });
  }
  return out;
}

const LADDER_RANK: Record<PriceTier["kind"], number> = {
  super_early: 0,
  early: 1,
  regular: 2,
  late: 3,
  group: -1,
  other: -1,
};

export function fillTierWindows(prices: readonly PriceTier[], raceDate: string): PriceTier[] {
  const out = prices.map((tier) => ({ ...tier, inferred: [...(tier.inferred ?? [])] }));
  const ladders = new Map<string, number[]>();
  for (const [index, tier] of out.entries()) {
    if (tier.kind === "group" || tier.kind === "other") continue;
    const key = JSON.stringify([tier.site, tier.distance, tier.audience]);
    const ladder = ladders.get(key) ?? [];
    ladder.push(index);
    ladders.set(key, ladder);
  }
  const touched = new Set<number>();
  for (const indexes of ladders.values()) {
    const ordered = [...indexes].sort((a, b) => {
      const left = out[a]!;
      const right = out[b]!;
      return (
        LADDER_RANK[left.kind] - LADDER_RANK[right.kind] ||
        compareNullable(left.from, right.from, true) ||
        compareNullable(left.to, right.to, false)
      );
    });
    for (const [position, index] of ordered.entries()) {
      const tier = out[index]!;
      if (tier.from === null) {
        const previous = position > 0 ? out[ordered[position - 1]!]! : null;
        const candidate = previous?.to ? shiftDate(previous.to, 1) : null;
        if (candidate !== null && candidate <= raceDate && (tier.to === null || candidate <= tier.to)) {
          tier.from = candidate;
          markInferred(tier, "from");
          touched.add(index);
        }
      }
      if (tier.to === null) {
        const next = position + 1 < ordered.length ? out[ordered[position + 1]!]! : null;
        const candidate = next ? (next.from === null ? null : shiftDate(next.from, -1)) : shiftDate(raceDate, 0);
        if (candidate !== null && (tier.from === null || tier.from <= candidate)) {
          tier.to = candidate;
          markInferred(tier, "to");
          touched.add(index);
        }
      }
    }
  }
  for (const index of touched) {
    const tier = out[index]!;
    tier.inferred = (["from", "to"] as const).filter((field) => tier.inferred.includes(field));
  }
  return out;
}

function compareNullable(left: string | null, right: string | null, nullFirst: boolean): number {
  if (left === right) return 0;
  if (left === null) return nullFirst ? -1 : 1;
  if (right === null) return nullFirst ? 1 : -1;
  return left.localeCompare(right);
}

function shiftDate(date: string, days: number): string | null {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + days * 86_400_000);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function markInferred(tier: PriceTier, field: "from" | "to"): void {
  if (!tier.inferred.includes(field)) tier.inferred.push(field);
}

/** Registrations and classified links from the sources' pages, deduped by URL. */
function relatedUrls(sources: readonly RaceSource[], config: SitesConfig): { registrations: Registration[]; links: Link[] } {
  const registrations = new Map<string, Registration>();
  const links = new Map<string, Link>();
  for (const source of sources) {
    if (source.role === "seller") registrations.set(source.url, { site: source.site, url: source.url });
  }
  for (const source of sources) {
    const foundOn = new URL(source.url).hostname.replace(/^www\./, "");
    for (const raw of (source.extracted as StoredExtraction).links ?? []) {
      let url: string;
      try {
        url = canonicalSourceUrl(raw.url);
      } catch {
        continue;
      }
      if (url === source.url || links.has(url)) continue;
      const { kind, site } = classifyLink(config, url, raw.text);
      // A page linking to its own site (menus, other pages) says nothing about the race.
      if (site?.key === source.site) continue;
      links.set(url, { url, kind, foundOn });
      if (kind === "seller" && site && !registrations.has(url)) registrations.set(url, { site: site.key, url });
    }
  }
  return {
    registrations: [...registrations.values()],
    links: [...links.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.url.localeCompare(b.url)),
  };
}

// Longer than any real multi-day event; sellers sometimes give the registration close as the end.
const MAX_EVENT_DAYS = 7;

/**
 * Flags on the served fields (after overrides), so fixing the value by hand clears them.
 * A long date range is usually a seller's registration period, and it would keep the race
 * listed as upcoming long after race day.
 */
export function fieldFlags(fields: CanonicalRace): string[] {
  if (!fields.endDate) return [];
  const days = (Date.parse(fields.endDate) - Date.parse(fields.date)) / 86_400_000;
  if (days > MAX_EVENT_DAYS) return [`race spans ${days} days (${fields.date} to ${fields.endDate}); endDate may be the registration close`];
  return [];
}

/** The race's served fields: derived from the sources, then OpenRace overrides on top. */
export function applyOverrides(fields: CanonicalRace, overrides: Overrides): CanonicalRace {
  const out: CanonicalRace = { ...fields };
  for (const [field, override] of Object.entries(overrides)) {
    if (override) (out as Record<string, unknown>)[field] = override.value;
  }
  return out;
}

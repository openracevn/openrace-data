import { canonicalSourceUrl } from "./slug.ts";
import { normalizeExtraction, type SourceExtraction, type SourceFacts } from "./extraction.ts";
import type { CanonicalRace, Link, Overrides, PriceTier, Race, RaceSource, Registration, SourceRole } from "./schema.ts";
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

/**
 * Derive a race's fields from all its sources.
 * - name, date, distances, location, ...: the first source that states them, official sites first.
 * - prices: every source's tiers, each labeled with its site (sellers can differ).
 * - registrations: every seller page, and seller links found on the pages.
 * - links: every outbound link found on the pages, classified.
 * confidence: single-sourced (one usable source), multi-sourced (several, agreeing on
 * race day), conflicting (they disagree on race day; see flags).
 */
export function reconcile(sources: readonly RaceSource[], config: SitesConfig): Reconciled | { error: string } {
  const ranked = [...sources].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role]);
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
  const hints = (key: keyof SourceHints) => ranked.map((s) => (s.extracted as StoredExtraction)[key]).find(isEntityRef) ?? null;

  const prices: PriceTier[] = usable.flatMap(({ source, facts }) => facts.prices.map((t) => ({ ...t, site: source.site })));
  const { registrations, links } = relatedUrls(ranked, config);

  const fields: CanonicalRace = {
    name: primary.facts.name,
    types: first((f) => f.types, (t) => t.join() === "other") ?? primary.facts.types,
    date: primary.facts.date,
    endDate: primary.facts.endDate,
    seriesId: hints("series")?.id ?? null,
    organizerId: hints("organizer")?.id ?? null,
    // An organizer named in the site list beats the model's reading of a page.
    organizer: hints("organizer")?.name ?? first((f) => f.organizer),
    distances: first((f) => f.distances, (d) => d.length === 0) ?? [],
    location: { venue: withLocation?.venue ?? null, city: withLocation?.city ?? null },
    prices,
    currency: primary.facts.currency,
    // Sellers know best whether tickets are left.
    registrationStatus:
      usable.find(({ source, facts }) => source.role === "seller" && facts.registrationStatus !== null)?.facts.registrationStatus ??
      first((f) => f.registrationStatus),
    registrations,
    links,
  };

  const flags: string[] = [];
  const dates = new Map(usable.map(({ source, facts }) => [source.site, facts.date]));
  if (new Set(dates.values()).size > 1) {
    flags.push(`sources disagree on race day: ${[...dates].map(([site, d]) => `${site} ${d}`).join(", ")}`);
  }
  const official = usable.find(({ source }) => source.role === "official");
  for (const { source, facts } of usable) {
    if (!official || source === official.source || facts.distances.length === 0 || official.facts.distances.length === 0) continue;
    if (facts.distances.join() !== official.facts.distances.join()) {
      flags.push(`${source.site} lists distances ${facts.distances.join(", ")}; the official site ${official.facts.distances.join(", ")}`);
    }
  }

  const confidence: Race["confidence"] = usable.length === 1 ? "single-sourced" : dates.size > 0 && new Set(dates.values()).size === 1 ? "multi-sourced" : "conflicting";
  return { fields, confidence, flags };
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

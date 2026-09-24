/**
 * Posts a summary of a push to Discord: races added/updated/removed and which
 * fields changed. Derived from the git diff (not the commit message), so it is
 * accurate for checker commits, manual edits and merges alike.
 *
 * Env: DISCORD_WEBHOOK_URL, BEFORE_SHA, AFTER_SHA, GITHUB_REPOSITORY, GITHUB_SERVER_URL.
 */
import { EMPTY_TREE, git, raceDiff, splitMessages } from "./lib/changes.ts";
import { env } from "./lib/env.ts";
import { reconcile, type StoredExtraction } from "./lib/reconcile.ts";
import { deepEqual, type CanonicalField, type Race } from "./lib/schema.ts";
import { loadSites } from "./lib/sites.ts";

const DISCORD_LIMIT = 2000;
const MAX_LISTED = 15;
const SHOW_VALUES: CanonicalField[] = ["types", "date", "endDate", "seriesId", "organizerId", "courses", "registrationStatus"];
const config = loadSites();

const webhook = env("DISCORD_WEBHOOK_URL");
if (!webhook) {
  console.log("DISCORD_WEBHOOK_URL not set; skipping Discord notification.");
  process.exit(0);
}

const diff = raceDiff(env("BEFORE_SHA"), env("AFTER_SHA"));
const { before, after } = diff;
const repo = env("GITHUB_REPOSITORY") ?? "openracevn/openrace-data";
const server = env("GITHUB_SERVER_URL") ?? "https://github.com";

const lines: string[] = [];
const commits = git("log", "--format=%h %s", before === EMPTY_TREE ? after : `${before}..${after}`).split("\n").filter(Boolean);
const link = before === EMPTY_TREE ? `${server}/${repo}/commit/${after}` : `${server}/${repo}/compare/${before.slice(0, 12)}...${after.slice(0, 12)}`;
lines.push(`**${repo}** · ${commits.length} commit(s) pushed · <${link}>`);

const added = diff.added.map(
  ({ id, path, race: r }) =>
    `➕ **${r?.name ?? id}** (${[r?.date, r?.location.city ?? r?.location.venue, r && priceSummary(r)].filter(Boolean).join(", ")}) \`${r?.slug ?? id}\`${flagNotes(null, r)}${links(r, path, after)}`,
);
const removed = diff.removed.map(({ id, path, race: r }) => `➖ ${r ? `**${r.name}** \`${r.slug}\`` : `\`${id}\``}${links(r, path, before)}`);
const updated = diff.updated.map(({ id, path, before: a, after: b, fields }) => {
  if (!a || !b) return `✏️ \`${b?.slug ?? id}\` (unparseable)${links(b, path, after)}`;
  const setNow = (f: CanonicalField) => b.overrides?.[f] && a.overrides?.[f]?.at !== b.overrides[f]!.at;
  const removedNow = (f: CanonicalField) => a.overrides?.[f] && !b.overrides?.[f];
  const detail = fields.map((f) =>
    setNow(f)
      ? `✋ ${f} → ${fmt(b[f], f)} (OpenRace: ${b.overrides[f]!.reason})`
      : removedNow(f)
        ? `${f} override removed → ${fmt(b[f], f)}`
        : SHOW_VALUES.includes(f)
          ? `${f} ${fmt(a[f], f)} → ${fmt(b[f], f)}`
          : f === "prices"
            ? `prices ${priceSummary(a)} → ${priceSummary(b)}`
            : f,
  );
  if (a.slug !== b.slug) detail.unshift(`slug ${a.slug} → ${b.slug}`);
  for (const s of b.sources) if (!a.sources.some((x) => x.url === s.url)) detail.unshift(`+${s.site}`);
  if (a.confidence !== b.confidence) detail.push(`confidence ${a.confidence} → ${b.confidence}`);
  detail.push(...overrideNotes(a, b));
  const cleared = a.flags.filter((f) => !b.flags.includes(f));
  if (cleared.length > 0) detail.push(`✅ cleared: ${cleared.join("; ")}`);
  const flagged = b.flags.some((f) => !a.flags.includes(f));
  const summary = detail.join(", ") || (flagged ? "flagged for a look" : "sources/metadata only");
  return `✏️ **${b.name}** \`${b.slug}\`: ${summary}${flagNotes(a, b)}${links(b, path, after)}`;
});

if (added.length + updated.length + removed.length === 0) {
  lines.push("No race data changes.", ...commits.slice(0, 5).map((c) => `• ${c}`));
} else {
  // A big batch (a backfill) gets a sample, not hundreds of messages.
  const cap = (list: string[], label: string) =>
    list.length > MAX_LISTED ? [...list.slice(0, MAX_LISTED), `…and ${list.length - MAX_LISTED} more ${label} (see the commit)`] : list;
  lines.push(
    `Races: ${added.length} added, ${updated.length} updated, ${removed.length} removed`,
    ...cap(added, "added"),
    ...cap(updated, "updated"),
    ...cap(removed, "removed"),
  );
}

for (const content of splitMessages(lines, DISCORD_LIMIT)) {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "OpenRace Data", content, allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) {
    console.error(`Discord webhook failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(content);
}

/**
 * Override changes that don't show up as a field change, and overridden fields whose
 * source value changed underneath (the override was kept, but someone may want to drop it).
 */
function overrideNotes(a: Race, b: Race): string[] {
  const notes: string[] = [];
  const before = a.overrides ?? {};
  const after = b.overrides ?? {};
  // Overrides set or removed without changing the value (e.g. pinning the current value).
  for (const [field, o] of Object.entries(after)) {
    const f = field as CanonicalField;
    if (o && before[f]?.at !== o.at && deepEqual(a[f], b[f])) notes.push(`✋ ${field} pinned (OpenRace: ${o.reason})`);
  }
  for (const field of Object.keys(before) as CanonicalField[]) {
    if (!after[field] && deepEqual(a[field], b[field])) notes.push(`${field} override removed`);
  }
  const derivedBefore = reconcile(a.sources, config);
  const derivedAfter = reconcile(b.sources, config);
  if (!("error" in derivedBefore) && !("error" in derivedAfter)) {
    for (const field of Object.keys(after) as CanonicalField[]) {
      if (!deepEqual(derivedBefore.fields[field], derivedAfter.fields[field])) {
        notes.push(`⚠️ ${field}: sources now say ${fmt(derivedAfter.fields[field], field)} (override kept)`);
      }
    }
  }
  return notes;
}

/** Flags raised by this change (see Race.flags). */
function flagNotes(a: Race | null, b: Race | null): string {
  const fresh = (b?.flags ?? []).filter((f) => !(a?.flags ?? []).includes(f));
  return fresh.map((f) => `\n  ⚠️ ${f}`).join("");
}

/** "3 tiers, 459,000–799,000 VND", or "no prices". */
function priceSummary(r: Race): string {
  if (r.prices.length === 0) return "no prices";
  const values = r.prices.map((p) => p.price);
  const [min, max] = [Math.min(...values), Math.max(...values)];
  return `${r.prices.length} price(s), ${min.toLocaleString("en-US")}${max > min ? `–${max.toLocaleString("en-US")}` : ""} ${r.currency}`;
}

/**
 * Links to check a race by hand: each source page, and the race file at this
 * commit. <…> keeps Discord from expanding them into preview cards.
 */
function links(r: Race | null, path: string, rev: string): string {
  const out = (r?.sources ?? []).map((s) => `[${s.site}](<${s.url}>)`);
  // The price images that were OCR'd, so a price can be checked against its picture.
  const images = (r?.sources ?? []).flatMap((s) => ((s.extracted as StoredExtraction).images ?? []).map((i) => i.url));
  out.push(...images.slice(0, 3).map((url, i) => `[price image${images.length > 1 ? ` ${i + 1}` : ""}](<${url}>)`));
  out.push(`[json](<${server}/${repo}/blob/${rev}/${path}>)`);
  return `\n  ↳ ${out.join(" · ")}`;
}

function fmt(v: unknown, field?: CanonicalField): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (field === "courses" && Array.isArray(v)) {
    return v
      .map((course) => (typeof course === "object" && course !== null && "label" in course ? course.label : null))
      .filter((label): label is string => typeof label === "string")
      .join(", ");
  }
  return typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : String(v);
}

/**
 * Posts a summary of a push to Discord: races added/updated/removed and which
 * fields changed. Derived from the git diff (not the commit message), so it is
 * accurate for checker commits, manual edits and merges alike.
 *
 * Env: DISCORD_WEBHOOK_URL, BEFORE_SHA, AFTER_SHA, GITHUB_REPOSITORY, GITHUB_SERVER_URL.
 */
import { EMPTY_TREE, git, raceDiff, splitMessages } from "./lib/changes.ts";
import { env } from "./lib/env.ts";
import { reconcile } from "./lib/reconcile.ts";
import { deepEqual, type CanonicalField, type Race } from "./lib/schema.ts";

const DISCORD_LIMIT = 2000;
const SHOW_VALUES: CanonicalField[] = ["types", "date", "priceMin", "priceMax", "groupPriceMin", "registrationStatus", "foreignerEligible"];

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
  ({ id, path, race: r }) => `➕ **${r?.name ?? id}** (${[r?.date, r?.location.city].filter(Boolean).join(", ")}) \`${r?.slug ?? id}\`${conflict(r)}${links(r, path, after)}`,
);
const removed = diff.removed.map(({ id, path, race: r }) => `➖ ${r ? `**${r.name}** \`${r.slug}\`` : `\`${id}\``}${links(r, path, before)}`);
const updated = diff.updated.map(({ id, path, before: a, after: b, fields }) => {
  if (!a || !b) return `✏️ \`${b?.slug ?? id}\` (unparseable)${links(b, path, after)}`;
  const setNow = (f: CanonicalField) => b.overrides?.[f] && a.overrides?.[f]?.at !== b.overrides[f]!.at;
  const removedNow = (f: CanonicalField) => a.overrides?.[f] && !b.overrides?.[f];
  const detail = fields.map((f) =>
    setNow(f)
      ? `✋ ${f} → ${fmt(b[f])} (OpenRace: ${b.overrides[f]!.reason})`
      : removedNow(f)
        ? `${f} override removed → ${fmt(b[f])}`
        : SHOW_VALUES.includes(f)
          ? `${f} ${fmt(a[f])} → ${fmt(b[f])}`
          : f,
  );
  if (a.slug !== b.slug) detail.unshift(`slug ${a.slug} → ${b.slug}`);
  for (const s of b.sources) if (!a.sources.some((x) => x.url === s.url)) detail.unshift(`+${s.name}`);
  if (a.confidence !== b.confidence) detail.push(`confidence ${a.confidence} → ${b.confidence}`);
  detail.push(...overrideNotes(a, b));
  return `✏️ **${b.name}** \`${b.slug}\`: ${detail.join(", ") || "sources/metadata only"}${conflict(b)}${links(b, path, after)}`;
});

if (added.length + updated.length + removed.length === 0) {
  lines.push("No race data changes.", ...commits.slice(0, 5).map((c) => `• ${c}`));
} else {
  lines.push(`Races: ${added.length} added, ${updated.length} updated, ${removed.length} removed`, ...added, ...updated, ...removed);
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
  const derivedBefore = reconcile(a.sources);
  const derivedAfter = reconcile(b.sources);
  if (!("error" in derivedBefore) && !("error" in derivedAfter)) {
    for (const field of Object.keys(after) as CanonicalField[]) {
      if (!deepEqual(derivedBefore.fields[field], derivedAfter.fields[field])) {
        notes.push(`⚠️ ${field}: sources now say ${fmt(derivedAfter.fields[field])} (override kept)`);
      }
    }
  }
  return notes;
}

function conflict(r: Race | null): string {
  return r?.confidence === "conflicting" ? " ⚠️ sources disagree on race day" : "";
}

/**
 * Links to check a race by hand: each source page, and the race file at this
 * commit. <…> keeps Discord from expanding them into preview cards.
 */
function links(r: Race | null, path: string, rev: string): string {
  const out = (r?.sources ?? []).map((s) => `[${s.name}](<${s.url}>)`);
  out.push(`[json](<${server}/${repo}/blob/${rev}/${path}>)`);
  return `\n  ↳ ${out.join(" · ")}`;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "number") return v.toLocaleString("en-US");
  return typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : String(v);
}

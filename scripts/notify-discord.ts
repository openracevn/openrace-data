/**
 * Posts a summary of a push to Discord: races added/updated/removed and which
 * fields changed. Derived from the git diff (not the commit message), so it is
 * accurate for checker commits, manual edits and merges alike.
 *
 * Env: DISCORD_WEBHOOK_URL, BEFORE_SHA, AFTER_SHA, GITHUB_REPOSITORY, GITHUB_SERVER_URL.
 */
import { EMPTY_TREE, git, raceDiff, splitMessages } from "./lib/changes.ts";
import { env } from "./lib/env.ts";
import { RACES_DIR, type CanonicalField, type Race } from "./lib/schema.ts";

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
  ({ id, race: r }) => `➕ **${r?.name ?? id}** (${[r?.date, r?.location.city].filter(Boolean).join(", ")}) \`${r?.slug ?? id}\`${conflict(r)}${links(r, id, after)}`,
);
const removed = diff.removed.map(({ id, race: r }) => `➖ ${r ? `**${r.name}** \`${r.slug}\`` : `\`${id}\``}${links(r, id, before)}`);
const updated = diff.updated.map(({ id, before: a, after: b, fields }) => {
  if (!a || !b) return `✏️ \`${b?.slug ?? id}\` (unparseable)${links(b, id, after)}`;
  const detail = fields.map((f) => (SHOW_VALUES.includes(f) ? `${f} ${fmt(a[f])} → ${fmt(b[f])}` : f));
  if (a.slug !== b.slug) detail.unshift(`slug ${a.slug} → ${b.slug}`);
  for (const s of b.sources) if (!a.sources.some((x) => x.url === s.url)) detail.unshift(`+${s.name}`);
  if (a.confidence !== b.confidence) detail.push(`confidence ${a.confidence} → ${b.confidence}`);
  return `✏️ **${b.name}** \`${b.slug}\`: ${detail.join(", ") || "sources/metadata only"}${conflict(b)}${links(b, id, after)}`;
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

function conflict(r: Race | null): string {
  return r?.confidence === "conflicting" ? " ⚠️ sources disagree on race day" : "";
}

/**
 * Links to check a race by hand: each source page, and the race file at this
 * commit. <…> keeps Discord from expanding them into preview cards.
 */
function links(r: Race | null, id: string, rev: string): string {
  const out = (r?.sources ?? []).map((s) => `[${s.name}](<${s.url}>)`);
  out.push(`[json](<${server}/${repo}/blob/${rev}/${RACES_DIR}/${id}.json>)`);
  return `\n  ↳ ${out.join(" · ")}`;
}

function fmt(v: unknown): string {
  return v === null || v === undefined ? "∅" : typeof v === "number" ? v.toLocaleString("en-US") : String(v);
}

/**
 * Posts a summary of a push to Discord: races added/updated/removed and which
 * fields changed. Derived from the git diff (not the commit message), so it is
 * accurate for checker commits, manual edits and merges alike.
 *
 * Env: DISCORD_WEBHOOK_URL, BEFORE_SHA, AFTER_SHA, GITHUB_REPOSITORY, GITHUB_SERVER_URL.
 */
import { execFileSync } from "node:child_process";
import { changedFields } from "./lib/diff.ts";
import { env } from "./lib/env.ts";
import { RACES_DIR, type CanonicalField, type Race } from "./lib/schema.ts";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const DISCORD_LIMIT = 2000;
const SHOW_VALUES: CanonicalField[] = ["types", "date", "priceMin", "priceMax", "groupPriceMin", "registrationStatus", "foreignerEligible"];

const webhook = env("DISCORD_WEBHOOK_URL");
if (!webhook) {
  console.log("DISCORD_WEBHOOK_URL not set; skipping Discord notification.");
  process.exit(0);
}

const after = env("AFTER_SHA") ?? git("rev-parse", "HEAD");
const before = resolveBase(env("BEFORE_SHA"), after);
const repo = env("GITHUB_REPOSITORY") ?? "openracevn/openrace-data";
const server = env("GITHUB_SERVER_URL") ?? "https://github.com";

const lines: string[] = [];
const commits = git("log", "--format=%h %s", before === EMPTY_TREE ? after : `${before}..${after}`).split("\n").filter(Boolean);
const link = before === EMPTY_TREE ? `${server}/${repo}/commit/${after}` : `${server}/${repo}/compare/${before.slice(0, 12)}...${after.slice(0, 12)}`;
lines.push(`**${repo}** · ${commits.length} commit(s) pushed · <${link}>`);

const diff = git("diff", "--no-renames", "--name-status", before, after, "--", RACES_DIR)
  .split("\n")
  .filter((l) => l.endsWith(".json"));

const added: string[] = [];
const updated: string[] = [];
const removed: string[] = [];
for (const line of diff) {
  const [status, path] = line.split("\t") as [string, string];
  const id = path.slice(RACES_DIR.length + 1, -".json".length);
  if (status === "A") {
    const r = readRace(after, path);
    added.push(`➕ **${r?.name ?? id}** (${[r?.date, r?.location.city].filter(Boolean).join(", ")}) \`${r?.slug ?? id}\`${sourceNote(r)}`);
  } else if (status === "D") {
    const r = readRace(before, path);
    removed.push(`➖ ${r ? `**${r.name}** \`${r.slug}\`` : `\`${id}\``}`);
  } else {
    const a = readRace(before, path);
    const b = readRace(after, path);
    if (!a || !b) {
      updated.push(`✏️ \`${b?.slug ?? id}\` (unparseable)`);
      continue;
    }
    const detail = changedFields(a, b).map((f) => (SHOW_VALUES.includes(f) ? `${f} ${fmt(a[f])} → ${fmt(b[f])}` : f));
    if (a.slug !== b.slug) detail.unshift(`slug ${a.slug} → ${b.slug}`);
    for (const s of b.sources) if (!a.sources.some((x) => x.url === s.url)) detail.unshift(`+${s.name}`);
    if (a.confidence !== b.confidence) detail.push(`confidence ${a.confidence} → ${b.confidence}`);
    updated.push(`✏️ **${b.name}** \`${b.slug}\`: ${detail.join(", ") || "sources/metadata only"}${b.confidence === "conflicting" ? " ⚠️ sources disagree on race day" : ""}`);
  }
}

if (diff.length === 0) {
  lines.push("No race data changes.", ...commits.slice(0, 5).map((c) => `• ${c}`));
} else {
  lines.push(`Races: ${added.length} added, ${updated.length} updated, ${removed.length} removed`, ...added, ...updated, ...removed);
}

let content = lines.join("\n");
if (content.length > DISCORD_LIMIT) content = content.slice(0, DISCORD_LIMIT - 20).replace(/\n[^\n]*$/, "") + "\n…(truncated)";

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

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

/** github.event.before is all zeros for a new branch, and may be missing after a force push. */
function resolveBase(sha: string | undefined, head: string): string {
  if (sha && !/^0+$/.test(sha)) {
    try {
      git("cat-file", "-e", `${sha}^{commit}`);
      return sha;
    } catch {
      // fall through
    }
  }
  try {
    return git("rev-parse", `${head}^`);
  } catch {
    return EMPTY_TREE;
  }
}

function sourceNote(r: Race | null): string {
  if (!r) return "";
  const names = r.sources.map((s) => s.name).join(" + ");
  return ` [${names}]${r.confidence === "conflicting" ? " ⚠️ sources disagree on race day" : ""}`;
}

function readRace(rev: string, path: string): Race | null {
  try {
    return JSON.parse(git("show", `${rev}:${path}`)) as Race;
  } catch {
    return null;
  }
}

function fmt(v: unknown): string {
  return v === null || v === undefined ? "∅" : typeof v === "number" ? v.toLocaleString("en-US") : String(v);
}

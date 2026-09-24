/**
 * The weekly stale line (plan 004 stage B): upcoming races whose freshness is
 * stale, oldest check first, so someone reads them before the data is too old to
 * trust. Run by .github/workflows/stale.yml (Mondays, 08:00 in Vietnam) or by hand.
 *
 *   npm run notify:stale -- --dry-run   # print the message instead of posting
 *
 * Env: DISCORD_WEBHOOK_URL (not needed with --dry-run). Reads the committed
 * data/index.json and state/freshness.json as checked out.
 */
import { readFileSync } from "node:fs";
import { env } from "./lib/env.ts";
import { FRESHNESS_PATH, FreshnessSchema, freshnessStatus, type FreshnessEntry } from "./lib/freshness.ts";
import { INDEX_PATH, IndexSchema, type IndexEntry } from "./lib/schema.ts";

const DISCORD_LIMIT = 2000;
const MAX_LISTED = 15;
const dryRun = process.argv.includes("--dry-run");
const now = new Date();

const index = IndexSchema.parse(JSON.parse(readFileSync(INDEX_PATH, "utf8")));
const fresh = FreshnessSchema.parse(JSON.parse(readFileSync(FRESHNESS_PATH, "utf8")));

const stale: { entry: IndexEntry; f: FreshnessEntry }[] = [];
for (const entry of index) {
  const f = fresh[entry.id];
  if (f && freshnessStatus(f, now) === "stale") stale.push({ entry, f });
}
stale.sort((a, b) => (a.f.lastCheckedAt ?? "").localeCompare(b.f.lastCheckedAt ?? ""));

if (stale.length === 0) {
  console.log("No stale upcoming races.");
  process.exit(0);
}

// At most 15 names, then "and N more", and never longer than one message allows.
const rows = stale.slice(0, MAX_LISTED).map(({ entry, f }) => `• ${entry.name} · last checked ${f.lastCheckedAt ? f.lastCheckedAt.slice(0, 10) : "never"}`);
let content = `**${stale.length} upcoming race(s) are stale**: not checked in time\n`;
let shown = 0;
for (; shown < rows.length; shown++) {
  if (content.length + rows[shown]!.length + 40 > DISCORD_LIMIT) break;
  content += `${rows[shown]}\n`;
}
if (stale.length - shown > 0) content = `${content}…and ${stale.length - shown} more`;

if (dryRun) {
  console.log(content.trimEnd());
  process.exit(0);
}

const webhook = env("DISCORD_WEBHOOK_URL");
if (!webhook) {
  console.log("DISCORD_WEBHOOK_URL not set; skipping Discord notification.");
  process.exit(0);
}
const res = await fetch(webhook, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "OpenRace Data", content: content.trimEnd(), allowed_mentions: { parse: [] } }),
});
if (!res.ok) {
  console.error(`Discord webhook failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(content.trimEnd());
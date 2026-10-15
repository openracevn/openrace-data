/**
 * The Monday data digest (plans 026, 027): what needs attention, as one Discord
 * message. Freshness share of the upcoming races, the to-do list Schedule 2 reads
 * and the pages it couldn't read, races that need a Claude `update-race` session
 * with the reason, and the week's and month's Firecrawl credits. Run by
 * .github/workflows/digest.yml (Mondays, 09:00 in Vietnam) or by hand, any day:
 *
 *   npm run notify:stale -- --dry-run   # print the message instead of posting
 *
 * Env: DISCORD_WEBHOOK_URL (not needed with --dry-run). Reads the committed
 * data/index.json, data/races/*.json, state/*.json and config/sites.yaml as checked
 * out; the rules are in lib/digest.ts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { buildDigest } from "./lib/digest.ts";
import { env } from "./lib/env.ts";
import { FRESHNESS_PATH, FreshnessSchema } from "./lib/freshness.ts";
import { INDEX_PATH, IndexSchema, RACES_DIR, RaceSchema, upgradeRace, type Race } from "./lib/schema.ts";
import { loadSites } from "./lib/sites.ts";
import { CREDITS_PATH, parseCredits } from "./lib/state.ts";
import { TODO_PATH, parseTodo } from "./lib/todo.ts";

const dryRun = process.argv.includes("--dry-run");

const read = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

const index = IndexSchema.parse(JSON.parse(read(INDEX_PATH) ?? "[]"));
const freshness = FreshnessSchema.parse(JSON.parse(read(FRESHNESS_PATH) ?? "{}"));
const races = new Map<string, Race>();
for (const file of readdirSync(RACES_DIR).filter((f) => f.endsWith(".json"))) {
  const parsed = RaceSchema.safeParse(upgradeRace(JSON.parse(readFileSync(`${RACES_DIR}/${file}`, "utf8"))));
  if (parsed.success) races.set(parsed.data.id, parsed.data);
}

const content = buildDigest({ index, races, freshness, todo: parseTodo(read(TODO_PATH)), config: loadSites(), credits: parseCredits(read(CREDITS_PATH)), now: new Date() });

if (dryRun) {
  console.log(content);
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
  body: JSON.stringify({ username: "OpenRace Data", content, allowed_mentions: { parse: [] } }),
});
if (!res.ok) {
  console.error(`Discord webhook failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(content);

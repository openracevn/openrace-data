/**
 * Every Monday: what OpenRace measures (plan 025, step 5), as one Discord message.
 * MCP tool calls, caller keys and client families for the last 7 days against the 7
 * before, and the completeness score against a week before. The numbers come from
 * openrace-mcp's public /weekly.json (the `mcp_openrace` dataset plus openrace-api's
 * completeness snapshot); this script only formats them. Not page views: there is no
 * website (roadmap, "Who we serve").
 *
 *   npm run notify:weekly                 # post to Discord
 *   npm run notify:weekly -- --dry-run    # print the message instead
 *
 * Env: DISCORD_WEBHOOK_URL (not needed with --dry-run),
 *      E2E_MCP_URL (default https://openrace-mcp.bmp.workers.dev).
 */
import { readFileSync } from "node:fs";
import { formatCredits, formatFreshnessShare, freshnessShare } from "./lib/digest.ts";
import { env } from "./lib/env.ts";
import { FRESHNESS_PATH, FreshnessSchema } from "./lib/freshness.ts";
import { INDEX_PATH, IndexSchema } from "./lib/schema.ts";
import { loadSites } from "./lib/sites.ts";
import { CREDITS_PATH, parseCredits } from "./lib/state.ts";

const MCP_URL = (env("E2E_MCP_URL") ?? "https://openrace-mcp.bmp.workers.dev").replace(/\/$/, "");
const dryRun = process.argv.includes("--dry-run");

type Usage = { weeksAgo: number; calls: number; callerKeys: number; clients: number };
type Report = {
  usage: Usage[] | { error: string };
  clientsLast7Days: { client: string; calls: number }[] | { error: string };
  completeness:
    | { day: string; score: number; editionCoverage: number; races: number; openIssues: number; weekAgo: { day: string; score: number; editionCoverage: number } | null }
    | { error: string };
};

const res = await fetch(`${MCP_URL}/weekly.json`);
if (!res.ok) {
  console.error(`${MCP_URL}/weekly.json answered ${res.status}`);
  process.exit(1);
}
const report = (await res.json()) as Report;

const delta = (now: number, before: number | undefined) => {
  if (before === undefined) return "";
  const d = now - before;
  return d === 0 ? " (=)" : ` (${d > 0 ? "+" : ""}${d})`;
};

const lines = ["**OpenRace this week**"];
if ("error" in report.usage) {
  lines.push(`MCP usage: unavailable (${report.usage.error})`);
} else {
  const [now, before] = report.usage;
  if (now) {
    lines.push(
      `MCP tool calls: **${now.calls}**${delta(now.calls, before?.calls)}, caller keys ${now.callerKeys}${delta(now.callerKeys, before?.callerKeys)}, ` +
        `client families ${now.clients}${delta(now.clients, before?.clients)}`,
    );
  }
  const trend = report.usage.slice(0, 8).reverse().map((u) => u.calls).join(" → ");
  lines.push(`Calls per week, oldest first: ${trend}`);
}
if (!("error" in report.clientsLast7Days) && report.clientsLast7Days.length > 0) {
  lines.push(`By client: ${report.clientsLast7Days.map((c) => `${c.client} ${c.calls}`).join(", ")}`);
}
if ("error" in report.completeness) {
  lines.push(`Completeness: unavailable (${report.completeness.error})`);
} else {
  const c = report.completeness;
  lines.push(
    `Completeness on ${c.day}: depth **${c.score}**${delta(c.score, c.weekAgo?.score)}, edition coverage **${c.editionCoverage}**${delta(c.editionCoverage, c.weekAgo?.editionCoverage)}, ` +
      `${c.races} races, ${c.openIssues} open issues`,
  );
}
// Freshness is one of the four numbers OpenRace is measured by (roadmap, "Measure"),
// read from this checkout like the Monday digest does (plan 026).
lines.push(localFreshnessLine());
lines.push(`-# Caller keys rotate daily, so they count caller-days, not people. Our own checks (npm run e2e) count too. ${MCP_URL}/dash`);
const content = lines.join("\n");

if (dryRun) {
  console.log(content);
  process.exit(0);
}
const webhook = env("DISCORD_WEBHOOK_URL");
if (!webhook) {
  console.log("DISCORD_WEBHOOK_URL not set; skipping Discord notification.");
  process.exit(0);
}
const post = await fetch(webhook, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "OpenRace Data", content, allowed_mentions: { parse: [] } }),
});
if (!post.ok) {
  console.error(`Discord webhook failed: ${post.status} ${await post.text()}`);
  process.exit(1);
}
console.log(content);

function localFreshnessLine(): string {
  try {
    const now = new Date();
    const index = IndexSchema.parse(JSON.parse(readFileSync(INDEX_PATH, "utf8")));
    const freshness = FreshnessSchema.parse(JSON.parse(readFileSync(FRESHNESS_PATH, "utf8")));
    const config = loadSites();
    let credits = {};
    try {
      credits = parseCredits(readFileSync(CREDITS_PATH, "utf8"));
    } catch {
      // no credits spent yet
    }
    return `Freshness: ${formatFreshnessShare(freshnessShare(index, freshness, now))} · Firecrawl ${formatCredits(credits, config, now).replace(/^Credits/, "credits")}`;
  } catch (err) {
    return `Freshness: unavailable (${(err as Error).message})`;
  }
}

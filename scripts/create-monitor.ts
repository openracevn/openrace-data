/**
 * One-off setup: creates the Firecrawl Monitor that watches ActiUp and posts to
 * the ingestion Worker. Prints the request body and exits unless --create is given.
 *
 *   npm run monitor:create                 # dry run
 *   npm run monitor:create -- --create     # create it
 *
 * Env: FIRECRAWL_API_KEY, INGEST_WEBHOOK_URL (the deployed Worker's /webhooks/firecrawl URL).
 * Optional: ACTIUP_START_URL, MONITOR_SCHEDULE (natural-language, e.g. "every 6 hours").
 */
import { env, requireEnv } from "./lib/env.ts";
import { EXTRACTION_PROMPT, EXTRACTION_SCHEMA } from "./lib/extraction.ts";

const create = process.argv.includes("--create");

const body = {
  name: "OpenRace: ActiUp running events",
  schedule: { text: env("MONITOR_SCHEDULE") ?? "every 6 hours", timezone: "Asia/Ho_Chi_Minh" },
  targets: [
    {
      type: "crawl",
      // Event listing pages are client-rendered and event URLs are not in
      // ActiUp's sitemap, so crawl from the sports listing and keep event pages.
      url: env("ACTIUP_START_URL") ?? "https://actiup.net/en/events/sports",
      crawlOptions: { includePaths: ["^/en/event/.+"], limit: 500 },
      scrapeOptions: {
        formats: [{ type: "changeTracking", modes: ["json"], schema: EXTRACTION_SCHEMA, prompt: EXTRACTION_PROMPT }],
      },
    },
  ],
  webhook: {
    url: create ? requireEnv("INGEST_WEBHOOK_URL") : (env("INGEST_WEBHOOK_URL") ?? "<INGEST_WEBHOOK_URL>"),
    events: ["monitor.check.completed"],
  },
};

if (!create) {
  console.log(JSON.stringify(body, null, 2));
  console.log("\nDry run: re-run with --create to create the monitor.");
  process.exit(0);
}

const res = await fetch("https://api.firecrawl.dev/v2/monitor", {
  method: "POST",
  headers: { Authorization: `Bearer ${requireEnv("FIRECRAWL_API_KEY")}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Firecrawl ${res.status}: ${text}`);
  process.exit(1);
}
console.log(text);

/**
 * Run the diff/commit pipeline by hand, e.g. for a backfill read by an agent
 * instead of Firecrawl, or to replay extractions without waiting for the next check.
 *
 *   npm run sync -- inputs.json            # dry run: print the plan
 *   npm run sync -- inputs.json --commit   # commit to GitHub
 *
 * inputs.json: [{ "url", "site", "role", "extracted": { facts?, pages?, images?, links?, series?, organizer? },
 *                 "checkedAt"?, "slugHint"? }]
 * `site` is a key from config/sites.yaml, or a slug of the source's own host if none matches; `role` is official | seller | reference;
 * `checkedAt` defaults to now. See lib/extraction.ts (SourceExtraction) for `extracted`.
 */
import { readFileSync } from "node:fs";
import { requireEnv, env } from "./lib/env.ts";
import { loadSites } from "./lib/sites.ts";
import { formatCommitMessage, syncToGitHub, type SyncInput } from "./sync.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const commit = args.includes("--commit");
if (!file) {
  console.error("usage: npm run sync -- <inputs.json> [--commit]");
  process.exit(1);
}

const now = new Date().toISOString();
const config = loadSites();
const raw = JSON.parse(readFileSync(file, "utf8")) as Array<Partial<SyncInput>>;
const inputs: SyncInput[] = raw.map((r) => ({
  url: String(r.url),
  site: String(r.site),
  role: r.role ?? "seller",
  extracted: r.extracted ?? {},
  checkedAt: r.checkedAt ?? now,
  ...(r.slugHint && { slugHint: r.slugHint }),
}));

const result = await syncToGitHub(
  {
    token: requireEnv("GITHUB_TOKEN"),
    owner: env("GITHUB_OWNER") ?? "openracevn",
    repo: env("GITHUB_REPO") ?? "openrace-data",
    branch: env("GITHUB_BRANCH") ?? "main",
  },
  inputs,
  config,
  { dryRun: !commit, context: "Manual sync via scripts/sync-cli.ts", now, config },
);

if (result.changes.length === 0) console.log("No changes.");
else console.log(formatCommitMessage(result));
for (const s of result.skipped) console.log(`skipped ${s.url}: ${s.reason}`);
if (result.commitSha) console.log(`\nCommitted ${result.commitSha}`);
else if (result.changes.length > 0) console.log("\nDry run: re-run with --commit to write.");

/**
 * Run the diff/commit pipeline by hand, e.g. for a backfill or to replay a
 * Firecrawl extraction without waiting for the monitor.
 *
 *   npm run sync -- inputs.json            # dry run: print the plan
 *   npm run sync -- inputs.json --commit   # commit to GitHub
 *
 * inputs.json: [{ "url": "...", "extracted": { ... }, "checkedAt": "ISO" }]
 * (`checkedAt` defaults to now.)
 */
import { readFileSync } from "node:fs";
import { requireEnv, env } from "./lib/env.ts";
import { formatCommitMessage, syncToGitHub, type SyncInput } from "./sync.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const commit = args.includes("--commit");
if (!file) {
  console.error("usage: npm run sync -- <inputs.json> [--commit]");
  process.exit(1);
}

const now = new Date().toISOString();
const raw = JSON.parse(readFileSync(file, "utf8")) as Array<Partial<SyncInput>>;
const inputs: SyncInput[] = raw.map((r) => ({ url: String(r.url), extracted: r.extracted ?? {}, checkedAt: r.checkedAt ?? now }));

const result = await syncToGitHub(
  {
    token: requireEnv("GITHUB_TOKEN"),
    owner: env("GITHUB_OWNER") ?? "openracevn",
    repo: env("GITHUB_REPO") ?? "data",
    branch: env("GITHUB_BRANCH") ?? "main",
  },
  inputs,
  { dryRun: !commit, context: "Manual sync via scripts/sync-cli.ts", now },
);

if (result.changes.length === 0) console.log("No changes.");
else console.log(formatCommitMessage(result));
for (const s of result.skipped) console.log(`skipped ${s.url}: ${s.reason}`);
if (result.commitSha) console.log(`\nCommitted ${result.commitSha}`);
else if (result.changes.length > 0) console.log("\nDry run: re-run with --commit to write.");

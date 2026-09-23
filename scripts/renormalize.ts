/**
 * Re-derive every race's canonical fields from its stored `rawExtracted`, after a
 * change to normalization or reconciliation. No scraping, no Firecrawl credits.
 *
 *   npm run renormalize              # dry run: print what would change
 *   npm run renormalize -- --commit  # commit to GitHub (one commit)
 */
import { readFileSync } from "node:fs";
import { env, requireEnv } from "./lib/env.ts";
import { INDEX_PATH, IndexSchema, RaceSchema, racePath } from "./lib/schema.ts";
import { formatCommitMessage, planSync, syncToGitHub, type RaceStore, type SyncInput } from "./sync.ts";

const commit = process.argv.includes("--commit");
const local: RaceStore = {
  read: async (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
};

// Replaying each source's own extraction at its own check time: only
// normalization output can differ, so only normalization changes show up.
const inputs: SyncInput[] = [];
for (const entry of IndexSchema.parse(JSON.parse((await local.read(INDEX_PATH)) ?? "[]"))) {
  const race = RaceSchema.parse(JSON.parse((await local.read(racePath(entry.id)))!));
  for (const s of race.sources) inputs.push({ url: s.url, extracted: s.rawExtracted, checkedAt: s.lastCheckedAt });
}

const context = "Re-derived from stored extractions by scripts/renormalize.ts (no scraping).";
const result = commit
  ? await syncToGitHub(
      {
        token: requireEnv("GITHUB_TOKEN"),
        owner: env("GITHUB_OWNER") ?? "openracevn",
        repo: env("GITHUB_REPO") ?? "openrace-data",
        branch: env("GITHUB_BRANCH") ?? "main",
      },
      inputs,
      { context },
    )
  : { ...(await planSync(local, inputs)), commitSha: null };

console.log(result.changes.length ? formatCommitMessage(result) : "No changes.");
for (const s of result.skipped) console.log(`skipped ${s.url}: ${s.reason}`);
if (result.commitSha) console.log(`\nCommitted ${result.commitSha}`);
else if (result.changes.length && !commit) console.log("\nDry run: re-run with --commit to write.");

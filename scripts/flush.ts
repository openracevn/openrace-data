/**
 * Commit everything the update-race workers staged, as ONE commit (plan 019).
 *
 *   npm run flush -- --dry-run         plan and validate every bundle in .staging/, commit nothing
 *   npm run flush                      the same, then commit once (GITHUB_TOKEN=$(gh auth token))
 *   npm run flush -- --unit <unit> …   only these bundles
 *   npm run flush -- --also <path> …   also commit this locally edited file (e.g. data/series.json,
 *                                      a new series the staged races point at) in the same commit
 *
 * Each bundle is applied on top of the ones accepted before it and validated (npm run
 * validate) in a temporary tree. A bundle that fails is rejected and left out; the rest
 * still commit. Afterwards every unit's bundle and working folder move to
 * .agent-read-archive/<date>-<unit>/ (nothing is deleted) and its claims are released.
 * Run it from a checkout that is up to date with main: validation reads the local tree.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { env, requireEnv } from "./lib/env.ts";
import { batchContext, planBatch, treeValidator } from "./lib/flush.ts";
import { loadSites } from "./lib/sites.ts";
import { archiveUnit, readStaged, type Bundle } from "./lib/staging.ts";
import { defaultWorkspace } from "./lib/workspace.ts";
import { commitToGitHub, formatCommitMessage, type RaceStore } from "./sync.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = args.flatMap((a, i) => (a === "--unit" && args[i + 1] ? [args[i + 1]!] : []));
const also: Record<string, string> = Object.fromEntries(
  args.flatMap((a, i) => (a === "--also" && args[i + 1] ? [[args[i + 1]!, readFileSync(args[i + 1]!, "utf8")] as const] : [])),
);
const ws = defaultWorkspace();
const config = loadSites();
const now = new Date().toISOString();

const staged = readStaged(ws, only.length ? only : undefined);
if (staged.length === 0) {
  console.log(`Nothing staged in ${ws.stagingDir}.`);
  process.exit(0);
}
const unreadable = staged.flatMap((s) => ("error" in s ? [{ unit: s.unit, reason: s.error }] : []));
const bundles: Bundle[] = staged.flatMap((s) => ("bundle" in s ? [s.bundle] : []));

warnIfBehind();
const local: RaceStore = {
  read: async (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
};
const validateTree = treeValidator(process.cwd());
const result = await planBatch(local, bundles, config, now, (files) => validateTree({ ...also, ...files }));
result.rejected.unshift(...unreadable);

for (const a of result.accepted) console.log(`✓ ${a.unit}: ${a.summary} → ${a.changes.map((c) => `${c.kind === "added" ? "+" : "~"}${c.slug}`).join(", ")}`);
for (const u of result.unchanged) console.log(`= ${u}: nothing new (already in the data)`);
for (const r of result.rejected) console.log(`✗ ${r.unit}: REJECTED, left out of the commit\n    ${r.reason.replace(/\n/g, "\n    ")}`);

if (dryRun) {
  console.log(`\nDry run: ${result.accepted.length} accepted, ${result.unchanged.length} unchanged, ${result.rejected.length} rejected. Nothing committed or archived.`);
  process.exit(result.rejected.length ? 1 : 0);
}

let commitSha: string | null = null;
if (result.accepted.length > 0) {
  const acceptedUnits = new Set(result.accepted.map((a) => a.unit));
  const acceptedBundles = bundles.filter((b) => acceptedUnits.has(b.unit));
  const context = `update-race batch (${result.accepted.length} unit(s)):\n${batchContext(result)}`;
  const committed = await commitToGitHub(
    {
      token: requireEnv("GITHUB_TOKEN"),
      owner: env("GITHUB_OWNER") ?? "openracevn",
      repo: env("GITHUB_REPO") ?? "openrace-data",
      branch: env("GITHUB_BRANCH") ?? "main",
    },
    // Re-planned on the branch head on a retry; validation already ran on the same bundles.
    async (store) => (await planBatch(store, acceptedBundles, config, now, null)).plan,
    { config, now, context, extraFiles: async () => also },
  );
  commitSha = committed.commitSha;
  console.log(`\n${formatCommitMessage(committed, context)}`);
  console.log(commitSha ? `\nCommitted ${commitSha}` : "\nNothing committed.");
}

const archiveNote = (label: string) => `${label}${commitSha ? ` (commit ${commitSha})` : ""}`;
for (const a of result.accepted) console.log(`archived ${archiveUnit(ws, a.unit, "committed", archiveNote("committed"))}`);
for (const u of result.unchanged) console.log(`archived ${archiveUnit(ws, u, "nothing-new", "every fact was already in the data")}`);
for (const r of result.rejected) console.log(`archived ${archiveUnit(ws, r.unit, "rejected", r.reason)}`);

function warnIfBehind(): void {
  try {
    execFileSync("git", ["fetch", "-q", "origin", "main"], { stdio: "ignore" });
    const behind = Number(execFileSync("git", ["rev-list", "--count", "HEAD..origin/main"], { encoding: "utf8" }).trim());
    if (behind > 0) console.warn(`warning: this checkout is ${behind} commit(s) behind origin/main; validation ran on stale data. git pull first.\n`);
  } catch {
    // Offline or no remote: validation still runs on the local tree.
  }
}

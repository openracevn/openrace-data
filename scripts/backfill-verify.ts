/**
 * Check candidate participant counts before anything is stored (plan 017, Stage C).
 *
 *   npx tsx scripts/backfill-verify.ts <candidates.json> [--apply]
 *
 * <candidates.json> is [{"race": "<slug|id>", "url": "<page>", "count": 15000, "quote": "<verbatim, optional>"}].
 * Every candidate's page is fetched (free) and checked by scripts/lib/backfill-verify.ts.
 * Accepted ones are printed; with --apply each is stored as a `reference` source through
 * `npm run edit -- add` (a real commit to GitHub: needs GITHUB_TOKEN=$(gh auth token)).
 * Exit code 1 when any candidate was rejected.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { INDEX_PATH, IndexSchema } from "./lib/schema.ts";
import { fetchPage, verifyCandidate, type Candidate } from "./lib/backfill-verify.ts";

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error("usage: npx tsx scripts/backfill-verify.ts <candidates.json> [--apply]");
  process.exit(2);
}
const apply = rest.includes("--apply");
const candidates: Candidate[] = JSON.parse(readFileSync(file, "utf8"));
const index = IndexSchema.parse(JSON.parse(readFileSync(INDEX_PATH, "utf8")));

let accepted = 0;
let rejected = 0;
for (const c of candidates) {
  const entry = index.find((e) => e.id === c.race || e.slug === c.race);
  if (!entry) {
    console.log(`✗ ${c.race}: no such race`);
    rejected++;
    continue;
  }
  const verdict = verifyCandidate(c, entry.date.slice(0, 4), await fetchPage(c.url));
  if (!verdict.ok) {
    console.log(`✗ ${entry.slug}: ${verdict.reason} (${c.url})`);
    rejected++;
    continue;
  }
  accepted++;
  console.log(`✓ ${entry.slug}: ${c.count} ${verdict.quote ? `"${verdict.quote}"` : "(no quote: low confidence)"}`);
  if (!apply) continue;
  const participants = { count: c.count, sourceUrl: c.url, ...(verdict.quote ? { quote: verdict.quote } : {}) };
  const run = spawnSync(
    "npm",
    ["run", "--silent", "edit", "--", "add", "--url", `${entry.id}@${c.url}`, "--json", JSON.stringify({ name: entry.name, date: entry.date, participants }), "--reason", `Participant count stated by the page (backfill, plan 017)`],
    { stdio: "inherit" },
  );
  if (run.status !== 0) console.log(`  ✗ could not store ${entry.slug}`);
}
console.log(`\n${accepted} accepted, ${rejected} rejected${apply ? "" : " (dry: nothing stored; add --apply)"}`);
process.exitCode = rejected > 0 ? 1 : 0;

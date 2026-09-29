/**
 * Claim races or series before working on them, so two sessions never edit the same one
 * (plan 019). Exits 1 if any id is held by another unit; take only what was granted.
 *
 *   npm run claim -- <unit> <race-or-series-id> [...]   claim (refreshes the unit's own)
 *   npm run claim -- --release <unit>                   release everything the unit holds
 *   npm run claim -- --list
 */
import { CLAIM_TTL_MS, claimAll, listClaims, releaseUnit } from "./lib/claims.ts";
import { defaultWorkspace } from "./lib/workspace.ts";

const { claimsDir } = defaultWorkspace();
const args = process.argv.slice(2);

if (args[0] === "--list") {
  const claims = listClaims(claimsDir);
  for (const c of claims) console.log(`${c.id}  held by ${c.unit} since ${c.at}${c.stale ? "  (stale, will be taken over)" : ""}`);
  console.log(`${claims.length} claim(s); a claim expires after ${CLAIM_TTL_MS / 60000} minutes.`);
} else if (args[0] === "--release") {
  if (!args[1]) fail("usage: npm run claim -- --release <unit>");
  console.log(`released: ${releaseUnit(claimsDir, args[1]).join(", ") || "nothing"}`);
} else {
  const [unit, ...ids] = args;
  if (!unit || ids.length === 0) fail("usage: npm run claim -- <unit> <race-or-series-id> [...]");
  const results = claimAll(claimsDir, unit, ids);
  for (const r of results) console.log(r.ok ? `claimed ${r.id}` : `REFUSED ${r.id}: held by ${r.heldBy} since ${r.since}`);
  if (results.some((r) => !r.ok)) process.exit(1);
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

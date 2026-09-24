/**
 * Hand edits by OpenRace, committed like any other change (one commit, validated,
 * announced on Discord).
 *
 *   npm run edit -- set <race> <field> <value> --reason "<why>"
 *       Override a field; it wins over every source and survives re-checks.
 *       <value> is JSON ([{"label":"21km","meters":21097,"type":"road_run","elevationGain":null}], 5, null, {"venue":…,"city":…}, [{"distance":"21km","tier":"Early Bird",…}]);
 *       Use courses for the full array and edition for the stated number. Anything that
 *       isn't JSON is taken as a string.
 *   npm run edit -- unset <race> <field>
 *       Remove the override; the field goes back to what the sources say.
 *   npm run edit -- add --url <reference> --json '<fields>' --reason "<why>"
 *       A race no site lists (source "openrace"). <reference> is where the info comes
 *       from (organizer page, Facebook post). <fields> are extraction-shaped:
 *       {"name","date","endDate","types","distances","venue","city","organizer",
 *        "registrationStatus","prices":[{"distance","tier","from","to","price"}]};
 *       name and date required.
 *       Re-running add with the same --url updates that race.
 *   npm run edit -- slug <race> <new-slug> [--reason "<why>"]
 *       Change a race's slug. Its file is renamed to data/races/<new-slug>.json and
 *       the index follows; the id stays, so the API updates the same race.
 *
 * <race> is a race id or slug. Add --dry-run to see the result without committing
 * (reads the local checkout). Committing needs GITHUB_TOKEN (e.g. $(gh auth token)).
 */
import { readFileSync } from "node:fs";
import { env, requireEnv } from "./lib/env.ts";
import { CANONICAL_FIELDS, type CanonicalField } from "./lib/schema.ts";
import { loadSites, siteForUrl } from "./lib/sites.ts";
import { canonicalSourceUrl } from "./lib/slug.ts";
import { commitToGitHub, formatCommitMessage, planEdit, planRename, planSync, type RaceStore, type SyncPlan } from "./sync.ts";

const EDITABLE_FIELDS: readonly string[] = CANONICAL_FIELDS.filter((field) => field !== "geo");
const VALUE_FLAGS = new Set(["--reason", "--url", "--json"]);
const flags = new Map<string, string>();
const positional: string[] = [];
let dryRun = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--dry-run") dryRun = true;
  else if (VALUE_FLAGS.has(a)) flags.set(a.slice(2), args[++i] ?? "");
  else positional.push(a);
}
const flag = (name: string) => flags.get(name);
const [command, race, field, rawValue] = positional;
const reason = flag("reason");
const now = new Date().toISOString();
const config = loadSites();

let planAt: (store: RaceStore) => Promise<SyncPlan>;
let message: string;

if (command === "set" || command === "unset") {
  if (!race || !field) fail(`usage: npm run edit -- ${command} <race> <field>${command === "set" ? " <value> --reason <why>" : ""}`);
  if (!EDITABLE_FIELDS.includes(field as CanonicalField)) fail(`field must be one of: ${EDITABLE_FIELDS.join(", ")}`);
  if (command === "set") {
    if (rawValue === undefined) fail("set needs a value");
    if (!reason) fail("set needs --reason: say why OpenRace overrides the sources");
    const value = parseValue(rawValue!);
    planAt = (store) => planEdit(store, race!, [{ kind: "set", field: field as CanonicalField, value, reason: reason! }], config, now);
    message = `edit: ${race}: set ${field} = ${JSON.stringify(value)}\n\nOpenRace override: ${reason}`;
  } else {
    planAt = (store) => planEdit(store, race!, [{ kind: "unset", field: field as CanonicalField }], config, now);
    message = `edit: ${race}: remove the ${field} override (back to the source value)${reason ? `\n\n${reason}` : ""}`;
  }
} else if (command === "slug") {
  const newSlug = field;
  if (!race || !newSlug) fail("usage: npm run edit -- slug <race> <new-slug> [--reason <why>]");
  planAt = (store) => planRename(store, race!, newSlug!, now);
  message = `edit: ${race}: slug → ${newSlug}${reason ? `\n\n${reason}` : ""}`;
} else if (command === "add") {
  const url = flag("url");
  const json = flag("json");
  if (!url || !json) fail("usage: npm run edit -- add --url <reference> --json '<fields>' --reason <why>");
  if (!reason) fail("add needs --reason: where does this race come from?");
  let reference: string;
  try {
    reference = canonicalSourceUrl(url!);
  } catch {
    fail(`--url is not a URL: ${url}`);
  }
  const site = siteForUrl(config, reference!);
  if (site && site.recipe !== "none") fail(`${reference!} is on ${site.key}, which is read automatically; use npm run check -- --race <url>`);
  const fields = parseValue(json!);
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) fail("--json must be an object");
  const extracted = { facts: { ...(fields as Record<string, unknown>), note: reason } };
  planAt = (store) => planSync(store, [{ url: reference!, site: "openrace", role: "reference", extracted, checkedAt: now }], config, now);
  message = ""; // generated from the plan below
} else {
  fail("usage: npm run edit -- set|unset|add|slug … (see scripts/edit.ts)");
}

const local: RaceStore = {
  read: async (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
};

try {
  await run();
} catch (err) {
  fail((err as Error).message);
}

async function run(): Promise<void> {
  if (dryRun) {
    report(await planAt!(local), null);
    return;
  }
  const result = await commitToGitHub(
    {
      token: requireEnv("GITHUB_TOKEN"),
      owner: env("GITHUB_OWNER") ?? "openracevn",
      repo: env("GITHUB_REPO") ?? "openrace-data",
      branch: env("GITHUB_BRANCH") ?? "main",
    },
    planAt!,
    command === "add" ? { context: `Entered by hand (openrace): ${reason}` } : { message: message! },
  );
  report(result, result.commitSha);
}

function report(plan: SyncPlan, commitSha: string | null): void {
  for (const s of plan.skipped) console.error(`✗ ${s.url}: ${s.reason}`);
  if (plan.skipped.length) process.exitCode = 1;
  if (plan.changes.length === 0) {
    console.log("No changes.");
    return;
  }
  console.log(command === "add" ? formatCommitMessage(plan) : message);
  for (const [path, content] of Object.entries(plan.files)) if (path.includes("/races/")) console.log(`\n${path}\n${content ?? "(deleted)"}`);
  console.log(commitSha ? `Committed ${commitSha}` : "Dry run: nothing committed.");
}

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

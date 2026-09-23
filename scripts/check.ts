/**
 * Race checker, run by .github/workflows/check.yml (daily, or by hand).
 *
 *   npm run check -- --mode daily               # discover + refresh (the scheduled run)
 *   npm run check -- --mode discover            # only look for races we don't have yet
 *   npm run check -- --mode refresh             # only re-check known races that are due
 *   npm run check -- --mode race --race <id|slug|url>  # re-check one race now, whatever its schedule
 *
 * Options: --max-scrapes N (default 40; each extraction costs 5 Firecrawl credits), --dry-run,
 * --preview <dir> (with --dry-run: also write the planned files under <dir> to inspect).
 *
 * Discovery scrapes the listing for links (1 credit), then extracts only URLs we
 * don't know yet. Refresh
 * re-extracts known races every REFRESH_DAYS until race day (see lib/checks.ts).
 * Everything lands in one commit: race files + index + state/checks.json.
 *
 * Selection reads the local checkout; the commit re-plans against the branch head.
 * Env: FIRECRAWL_API_KEY; GITHUB_TOKEN (PAT) + GITHUB_OWNER/REPO/BRANCH unless --dry-run.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CHECKS_PATH,
  byStaleness,
  isCandidate,
  isRefreshDue,
  parseChecks,
  serializeChecks,
  vietnamDate,
  type Check,
} from "./lib/checks.ts";
import { env, requireEnv } from "./lib/env.ts";
import { normalizeExtracted } from "./lib/extraction.ts";
import { Firecrawl } from "./lib/firecrawl.ts";
import { INDEX_PATH, IndexSchema, RaceSchema, racePath } from "./lib/schema.ts";
import { canonicalSourceUrl } from "./lib/slug.ts";
import { SOURCES, sourceForUrl } from "./lib/sources.ts";
import { formatCommitMessage, planSync, syncToGitHub, type RaceStore, type SyncInput, type SyncPlan } from "./sync.ts";

const MODES = ["daily", "discover", "refresh", "race"] as const;
type Mode = (typeof MODES)[number];

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const mode = (arg("mode") ?? "daily") as Mode;
const raceArg = arg("race")?.trim();
const maxScrapes = Number(arg("max-scrapes") ?? 40);
const dryRun = args.includes("--dry-run");
const previewDir = arg("preview");
if (!MODES.includes(mode)) fail(`--mode must be one of ${MODES.join(", ")}`);
if (mode === "race" && !raceArg) fail("--mode race needs --race <race id, slug or URL>");
if (!Number.isInteger(maxScrapes) || maxScrapes < 1) fail("--max-scrapes must be a positive integer");
if (previewDir && !dryRun) fail("--preview only works with --dry-run");

const now = new Date();
const today = vietnamDate(now);
const local: RaceStore = {
  read: async (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
};

const index = IndexSchema.parse(JSON.parse((await local.read(INDEX_PATH)) ?? "[]"));
const checks = parseChecks(await local.read(CHECKS_PATH));
const knownUrls = new Set(index.flatMap((e) => e.sourceUrls));
const discovering = mode === "daily" || mode === "discover";

const firecrawl = new Firecrawl(requireEnv("FIRECRAWL_API_KEY"));
const runChecks = new Map<string, Check>(); // this run's check log entries
const inputs: SyncInput[] = [];
const queue: string[] = [];
const queued = new Set<string>();
const report: string[] = [];
let scrapes = 0;
let deferred = 0;
let failures = 0;

/** Event pages among a page's links, canonicalized, that discovery should extract. */
function newEventUrls(links: readonly string[]): string[] {
  const out: string[] = [];
  for (const link of links) {
    let url: string;
    try {
      url = canonicalSourceUrl(link);
    } catch {
      continue;
    }
    if (sourceForUrl(url) && !knownUrls.has(url) && isCandidate(checks[url], now)) out.push(url);
  }
  return out;
}

function enqueue(urls: readonly string[]): void {
  for (const url of urls) {
    if (queued.has(url)) continue;
    queued.add(url);
    queue.push(url);
  }
}

async function extract(url: string): Promise<void> {
  if (scrapes >= maxScrapes) {
    deferred++;
    return;
  }
  scrapes++;
  const result = await firecrawl.extract(url);
  const checkedAt = new Date().toISOString();
  if (!result.ok || !result.json) {
    const reason = result.ok ? "no extraction returned" : result.error;
    runChecks.set(url, { lastCheckedAt: checkedAt, status: "error", reason });
    report.push(`✗ ${url}: ${reason}`);
    failures++;
    return;
  }
  inputs.push({ url, extracted: result.json, checkedAt });
  const normalized = normalizeExtracted(result.json);
  if (normalized.ok) {
    runChecks.set(url, { lastCheckedAt: checkedAt, status: "ok" });
  } else {
    // "Not a sports event" sticks; transient rejections (flaky render, no date yet) are retried.
    const permanent = !knownUrls.has(url) && result.json.pageKind === "non_sport";
    runChecks.set(url, { lastCheckedAt: checkedAt, status: "rejected", reason: normalized.reason, ...(permanent && { permanent }) });
    report.push(`· ${url}: ${normalized.reason}${permanent ? " (won't re-check)" : ""}`);
  }
}

// 1. Work out what to scrape.
if (mode === "race") {
  const byId = index.find((e) => e.id === raceArg || e.slug === raceArg);
  let urls = byId?.sourceUrls ?? [];
  if (!byId) {
    try {
      urls = [canonicalSourceUrl(raceArg!)];
    } catch {
      fail(`"${raceArg}" is neither a race id or slug in ${INDEX_PATH} nor a URL`);
    }
    if (!sourceForUrl(urls[0]!)) fail(`${urls[0]} is not an event page from a known source`);
  }
  enqueue(urls);
}

if (discovering) {
  for (const source of Object.values(SOURCES)) {
    for (const listing of source.listings) {
      // The listing renders client-side and occasionally comes back before its events
      // load. A listing with no event links is a failed render, not "no new races".
      let events: string[] = [];
      let error = "no event links (page rendered without events)";
      for (let attempt = 1; attempt <= 3 && events.length === 0; attempt++) {
        const result = await firecrawl.links(listing);
        if (!result.ok) {
          error = result.error;
          continue;
        }
        events = result.links.filter((link) => {
          try {
            return sourceForUrl(canonicalSourceUrl(link)) !== null;
          } catch {
            return false;
          }
        });
      }
      if (events.length === 0) {
        report.push(`✗ listing ${listing}: ${error}`);
        failures++;
        continue;
      }
      const fresh = newEventUrls(events);
      report.push(`listing ${listing}: ${new Set(events.map((e) => canonicalSourceUrl(e))).size} events, ${fresh.length} new`);
      enqueue(fresh);
    }
  }
}

if (mode === "daily" || mode === "refresh") {
  const due: string[] = [];
  for (const entry of index) {
    const text = await local.read(racePath(entry.id));
    if (text === null) continue;
    const race = RaceSchema.parse(JSON.parse(text));
    for (const url of entry.sourceUrls) {
      // No log entry (e.g. the race came in via sync-cli): fall back to the source's own last check.
      const lastCheckedAt = race.sources.find((src) => src.url === url)?.lastCheckedAt;
      const check = checks[url] ?? (lastCheckedAt ? { lastCheckedAt, status: "ok" as const } : undefined);
      if (isRefreshDue(race.date, check, today, now)) due.push(url);
    }
  }
  enqueue(due.sort(byStaleness(checks)));
}

// 2. Scrape.
for (let i = 0; i < queue.length; i++) await extract(queue[i]!);

// 3. Commit races + index + check log as one commit.
const finishedAt = new Date().toISOString();
const context = `Checked by scripts/check.ts (mode: ${mode}${raceArg ? `, race: ${raceArg}` : ""}).`;
let plan: SyncPlan;
let commitSha: string | null = null;
if (dryRun) {
  plan = await planSync(local, inputs, finishedAt);
  if (previewDir) {
    for (const [path, content] of Object.entries(plan.files)) {
      mkdirSync(dirname(join(previewDir, path)), { recursive: true });
      writeFileSync(join(previewDir, path), content);
    }
  }
} else {
  const result = await syncToGitHub(
    {
      token: requireEnv("GITHUB_TOKEN"),
      owner: env("GITHUB_OWNER") ?? "openracevn",
      repo: env("GITHUB_REPO") ?? "openrace-data",
      branch: env("GITHUB_BRANCH") ?? "main",
    },
    inputs,
    {
      now: finishedAt,
      context,
      bookkeepingMessage: `state: checked ${runChecks.size} page(s), no race changes\n\n${context}`,
      extraFiles: async (store): Promise<Record<string, string>> => {
        if (runChecks.size === 0) return {};
        const merged = parseChecks(await store.read(CHECKS_PATH));
        for (const [url, check] of runChecks) merged[url] = check;
        return { [CHECKS_PATH]: serializeChecks(merged) };
      },
    },
  );
  plan = result;
  commitSha = result.commitSha;
}

// 4. Report.
const summary = [
  `## Race check (${mode}${dryRun ? ", dry run" : ""})`,
  "",
  `- Pages extracted: ${scrapes} of max ${maxScrapes}${deferred ? ` (${deferred} left for the next run)` : ""}`,
  `- Firecrawl credits: ${firecrawl.credits}`,
  `- Races: ${plan.changes.filter((c) => c.kind === "added").length} added, ${plan.changes.filter((c) => c.kind === "updated").length} updated`,
  `- Commit: ${commitSha ?? (dryRun ? "none (dry run)" : "none")}`,
  "",
  ...(plan.changes.length ? ["```", formatCommitMessage(plan), "```", ""] : []),
  ...report.map((line) => `- ${line}`),
].join("\n");
console.log(summary);
const summaryFile = env("GITHUB_STEP_SUMMARY");
if (summaryFile) appendFileSync(summaryFile, `${summary}\n`);

// Red run if nothing could be scraped at all (e.g. out of credits, bad key, listing never rendered).
if (failures > 0 && inputs.length === 0) process.exitCode = 1;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

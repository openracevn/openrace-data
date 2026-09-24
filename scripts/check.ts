/**
 * The race checker (design v2), run by .github/workflows/check.yml or by hand.
 *
 *   npm run check                               # every site that is due (the scheduled run)
 *   npm run check -- --site <key>               # one site now, whatever its schedule
 *   npm run check -- --race <url|id|slug>       # one race now
 *
 * Options:
 *   --past            also races that already took place (backfill)
 *   --limit N         at most N races per site (tests, small batches)
 *   --max-credits N   Firecrawl credits this run may spend (default 250; the month's cap in config/sites.yaml also applies)
 *   --free            no paid reads: only what's cached; reports what would be read
 *   --facts-only      no reads at all: create or update races from the site's free data only
 *                     (ActiUp's API: name, dates, place, organizer, sale status). Prices,
 *                     courses and types come with a later normal run, which still reads
 *                     these races. A race already read in full is left alone.
 *   --dry-run         plan against the local checkout and don't commit (still reads, unless --free;
 *                     what it paid for is kept in the local state/reads.json)
 *   --preview <dir>   with --dry-run: write the planned files under <dir>
 *
 * For each site: the recipe lists its races and takes a snapshot of each (free);
 * a snapshot whose fingerprint didn't change since the last read is skipped;
 * otherwise its pages (and, if they give no prices, its price images) are read
 * with Firecrawl, cached by content. Everything lands in one commit: race files,
 * index, series, organizers and state/.
 *
 * Env: FIRECRAWL_API_KEY (unless --free); GITHUB_TOKEN (PAT) + GITHUB_OWNER/REPO/BRANCH
 * unless --dry-run; DISCORD_WEBHOOK_URL for health alerts (optional).
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { env, requireEnv } from "./lib/env.ts";
import { CREDITS_PER_READ, FirecrawlReader, type Reader } from "./lib/firecrawl.ts";
import { normalizeExtraction } from "./lib/extraction.ts";
import { enrichGeo, geoTargetFromExtraction, geoTargetFromRace, type GeoTarget } from "./lib/geocode.ts";
import { GEO_PATH, parseGeoCache, type GeoCache, type GeoCacheEntry } from "./lib/geo.ts";
import { GitHubRepo, type GitHubTarget } from "./lib/github.ts";
import { createHttp } from "./lib/http.ts";
import { READS_PATH, parseReadCache, pruneReadCache, readSnapshot, snapshotFingerprint, type ReadCache } from "./lib/read.ts";
import { recipeFor } from "./lib/recipes/index.ts";
import type { RaceRef, Recipe, RecipeContext } from "./lib/recipes/types.ts";
import { INDEX_PATH, IndexSchema, RaceSchema, racePath, upgradeRace } from "./lib/schema.ts";
import { loadSites, roleOf, siteForUrl, type Site } from "./lib/sites.ts";
import { canonicalSourceUrl } from "./lib/slug.ts";
import {
  CHECKS_PATH,
  CREDITS_PATH,
  SITES_STATE_PATH,
  isSiteDue,
  monthKey,
  parseChecks,
  parseCredits,
  parseSitesState,
  serializeSorted,
  vietnamDate,
  type Check,
  type SiteState,
} from "./lib/state.ts";
import { formatCommitMessage, planSync, syncToGitHub, type RaceStore, type SyncInput, type SyncPlan } from "./sync.ts";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const siteArg = arg("site");
const raceArg = arg("race")?.trim();
const includePast = args.includes("--past");
const limit = arg("limit") ? Number(arg("limit")) : Number.POSITIVE_INFINITY;
const maxCredits = Number(arg("max-credits") ?? 250);
const factsOnly = args.includes("--facts-only");
const free = args.includes("--free") || factsOnly;
const dryRun = args.includes("--dry-run");
const previewDir = arg("preview");
if (siteArg && raceArg) fail("use --site or --race, not both");
if (!(limit > 0)) fail("--limit must be a positive number");
if (!Number.isInteger(maxCredits) || maxCredits < 0) fail("--max-credits must be a whole number");
if (previewDir && !dryRun) fail("--preview only works with --dry-run");

const config = loadSites();
const now = new Date();
const today = vietnamDate(now);
const month = monthKey(now);
const http = createHttp();

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
const target: GitHubTarget | null = dryRun
  ? null
  : {
      token: requireEnv("GITHUB_TOKEN"),
      owner: env("GITHUB_OWNER") ?? "openracevn",
      repo: env("GITHUB_REPO") ?? "openrace-data",
      branch: env("GITHUB_BRANCH") ?? "main",
    };
// What to check is decided from the data it will commit on top of; the commit
// itself re-plans against the head at commit time.
let current: RaceStore = local;
if (target) {
  const repo = new GitHubRepo(target);
  current = repo.storeAt(await repo.headSha());
}

const index = IndexSchema.parse(JSON.parse((await current.read(INDEX_PATH)) ?? "[]"));
const checks = parseChecks(await current.read(CHECKS_PATH));
const sitesState = parseSitesState(await current.read(SITES_STATE_PATH));
const spentThisMonth = parseCredits(await current.read(CREDITS_PATH))[month] ?? 0;
const readCache: ReadCache = parseReadCache(await current.read(READS_PATH));

const budget = Math.max(0, Math.min(maxCredits, config.monthlyCredits - spentThisMonth));
const reader: Reader = free
  ? {
      credits: 0,
      readHtml: async () => ({ ok: false, error: "free run: not read", credits: 0, capped: true }),
      readImage: async () => ({ ok: false, error: "free run: not read", credits: 0, capped: true }),
    }
  : new FirecrawlReader(requireEnv("FIRECRAWL_API_KEY"), budget);

const runChecks = new Map<string, Check>();
const runSites = new Map<string, SiteState>();
const inputs: SyncInput[] = [];
const report: string[] = [];
const alerts: string[] = [];
const counts = { sites: 0, races: 0, unchanged: 0, read: 0, paidReads: 0, cachedReads: 0, deferred: 0, failed: 0, wouldSpend: 0 };

// 1. What to check.
type Job = { site: Site; recipe: Recipe; refs?: RaceRef[] };
const jobs: Job[] = [];
if (raceArg) {
  const entry = index.find((e) => e.id === raceArg || e.slug === raceArg);
  let urls = entry?.sourceUrls ?? [];
  if (!entry) {
    try {
      urls = [canonicalSourceUrl(raceArg)];
    } catch {
      fail(`"${raceArg}" is neither a race id or slug in ${INDEX_PATH} nor a URL`);
    }
  }
  for (const url of urls) {
    const site = siteForUrl(config, url);
    const recipe = site && recipeFor(site);
    if (!site || !recipe) {
      if (!entry) fail(`${url} isn't on a site with a recipe (config/sites.yaml)`);
      continue; // e.g. a hand-entered reference
    }
    const slugHint = site.recipe === "actiup" ? new URL(url).pathname.split("/")[3] : undefined;
    jobs.push({ site, recipe, refs: [{ url, slugHint }] });
  }
  if (jobs.length === 0) fail(`${raceArg} has no source on a site with a recipe`);
} else {
  const sites = siteArg ? config.sites.filter((s) => s.key === siteArg) : config.sites.filter((s) => isSiteDue(s, sitesState[s.key], now));
  if (siteArg && sites.length === 0) fail(`no site "${siteArg}" in config/sites.yaml`);
  for (const site of sites) {
    const recipe = recipeFor(site);
    if (recipe) jobs.push({ site, recipe });
    else if (siteArg) fail(`site ${site.key} has recipe: none`);
  }
}

// 2. Discover, snapshot, read.
for (const job of jobs) {
  const { site, recipe } = job;
  const ctx: RecipeContext = { site, config, http, today, includePast: includePast || !!raceArg };
  counts.sites++;
  let refs: RaceRef[];
  try {
    refs = job.refs ?? (await recipe.discover(ctx));
  } catch (err) {
    const failures = (sitesState[site.key]?.failures ?? 0) + 1;
    runSites.set(site.key, { lastCheckedAt: now.toISOString(), status: "error", reason: (err as Error).message, failures });
    report.push(`✗ site ${site.key}: ${(err as Error).message}`);
    if (failures >= 2) alerts.push(`🚨 ${site.name} (${site.key}) failed ${failures} runs in a row: ${(err as Error).message}`);
    continue;
  }
  refs = refs.filter((r) => !checks[r.url]?.permanent || !!raceArg).slice(0, limit);
  let siteRead = 0;
  for (const ref of refs) {
    counts.races++;
    const checkedAt = new Date().toISOString();
    let snap;
    try {
      snap = await recipe.snapshot(ref, ctx);
    } catch (err) {
      runChecks.set(ref.url, { ...checks[ref.url], lastCheckedAt: checkedAt, status: "error", reason: (err as Error).message });
      report.push(`✗ ${ref.url}: ${(err as Error).message}`);
      counts.failed++;
      continue;
    }
    const fp = snapshotFingerprint(snap);
    const prev = checks[ref.url];
    if (factsOnly) {
      // Never replace a full read with facts alone.
      if (prev?.fingerprint) {
        counts.unchanged++;
        continue;
      }
      const extracted = {
        ...(snap.facts && { facts: snap.facts }),
        links: snap.links,
        ...(snap.hints?.series && { series: snap.hints.series }),
        ...(snap.hints?.organizer && { organizer: snap.hints.organizer }),
      };
      inputs.push({ url: ref.url, site: site.key, role: roleOf(site), extracted, checkedAt, slugHint: snap.slugHint });
      runChecks.set(ref.url, { lastCheckedAt: checkedAt, status: "facts" });
      counts.read++;
      siteRead++;
      continue;
    }
    if (!raceArg && prev?.fingerprint === fp && prev.status !== "error") {
      counts.unchanged++;
      runChecks.set(ref.url, { ...prev, lastCheckedAt: checkedAt });
      continue;
    }
    const outcome = await readSnapshot(snap, reader, http, readCache, now);
    if (!outcome.ok) {
      if (outcome.capped) {
        counts.deferred++;
        // Upper bound: every page, and up to 4 images if the pages give no prices.
        const images = Math.min(snap.priceImages.length, 4);
        const estimate = (snap.pages.length + images) * CREDITS_PER_READ;
        counts.wouldSpend += estimate;
        report.push(
          free
            ? `… ${ref.url}: would read ${snap.pages.length} page(s)${images ? ` + up to ${images} price image(s)` : ""}, ≤${estimate} credits`
            : `… ${ref.url}: ${outcome.reason} (left for the next run)`,
        );
      } else {
        counts.failed++;
        runChecks.set(ref.url, { ...prev, lastCheckedAt: checkedAt, status: "error", reason: outcome.reason });
        report.push(`✗ ${ref.url}: ${outcome.reason}`);
      }
      continue;
    }
    counts.read++;
    siteRead++;
    counts.paidReads += outcome.paidReads;
    counts.cachedReads += outcome.cachedReads;
    for (const note of outcome.notes) report.push(`· ${ref.url}: ${note}`);
    inputs.push({ url: ref.url, site: site.key, role: roleOf(site), extracted: outcome.extraction, checkedAt, slugHint: snap.slugHint });
    runChecks.set(ref.url, { lastCheckedAt: checkedAt, status: "ok", fingerprint: fp });
    console.log(`read ${ref.url} (${outcome.paidReads} paid, ${outcome.cachedReads} cached)`);
  }
  // Facts alone don't count as a check: the next scheduled run should still read the site.
  if (!factsOnly) runSites.set(site.key, { lastCheckedAt: now.toISOString(), status: "ok", failures: 0 });
  report.push(`site ${site.key}: ${refs.length} race page(s), ${siteRead} read`);
}

const geoTargets: GeoTarget[] = [];
for (const input of inputs) {
  const normalized = normalizeExtraction(input.extracted);
  if (normalized.ok) {
    const maps = geoTargetFromExtraction(input.extracted);
    geoTargets.push({
      id: input.url,
      name: normalized.facts.name,
      types: normalized.facts.types,
      location: { venue: normalized.facts.venue, city: normalized.facts.city },
      mapsUrls: maps?.mapsUrls ?? [],
    });
  }
  const entry = index.find((candidate) => candidate.sourceUrls.includes(input.url));
  if (!entry) continue;
  const text = await current.read(racePath(entry));
  if (text) geoTargets.push(geoTargetFromRace(RaceSchema.parse(upgradeRace(JSON.parse(text)))));
}
let geoCache: GeoCache = parseGeoCache(await current.read(GEO_PATH));
const filledGeo = new Map<string, GeoCacheEntry>();
await enrichGeo(geoTargets, geoCache, {
  onEntry: (next, key) => {
    geoCache = next;
    filledGeo.set(key, next[key]!);
  },
  onError: (target, error) => {
    const message = `geo lookup failed for ${target.name}: ${error.message}`;
    report.push(message);
    console.error(message);
  },
});

// 3. Plan and commit: races + index + series/organizers + state, one commit.
const finishedAt = new Date().toISOString();
const credits = reader.credits;
const context = `Checked by scripts/check.ts (${raceArg ? `race ${raceArg}` : siteArg ? `site ${siteArg}` : "due sites"}${includePast ? ", with past races" : ""}).`;

async function stateFiles(store: RaceStore): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (filledGeo.size > 0) {
    const merged = parseGeoCache(await store.read(GEO_PATH));
    for (const [key, entry] of filledGeo) merged[key] = entry;
    out[GEO_PATH] = serializeSorted(merged);
  }
  if (runChecks.size > 0) {
    const merged = parseChecks(await store.read(CHECKS_PATH));
    for (const [url, check] of runChecks) merged[url] = check;
    out[CHECKS_PATH] = serializeSorted(merged);
  }
  if (runSites.size > 0) {
    const merged = parseSitesState(await store.read(SITES_STATE_PATH));
    for (const [key, s] of runSites) merged[key] = s;
    out[SITES_STATE_PATH] = serializeSorted(merged);
  }
  if (credits > 0) {
    const merged = parseCredits(await store.read(CREDITS_PATH));
    merged[month] = (merged[month] ?? 0) + credits;
    out[CREDITS_PATH] = serializeSorted(merged);
  }
  if (counts.paidReads + counts.cachedReads > 0) {
    const merged = { ...parseReadCache(await store.read(READS_PATH)), ...readCache };
    out[READS_PATH] = serializeSorted(pruneReadCache(merged, now));
  }
  return out;
}

let plan: SyncPlan;
let commitSha: string | null = null;
if (dryRun) {
  plan = await planSync(local, inputs, config, finishedAt, undefined, geoCache);
  // Keep what was paid for: the next run (dry or not, once committed) reads it from the cache.
  if (counts.paidReads > 0) writeFileSync(READS_PATH, (await stateFiles(local))[READS_PATH]!);
  if (previewDir) {
    for (const [path, content] of Object.entries({ ...plan.files, ...(await stateFiles(local)) })) {
      if (content === null) continue;
      mkdirSync(dirname(join(previewDir, path)), { recursive: true });
      writeFileSync(join(previewDir, path), content);
    }
  }
} else {
  const result = await syncToGitHub(target!, inputs, config, {
    now: finishedAt,
    context,
    bookkeepingMessage: `state: checked ${runChecks.size} page(s), no race changes\n\n${context}`,
    extraFiles: stateFiles,
    geoCache,
  });
  plan = result;
  commitSha = result.commitSha;
}

// 4. Report, and alert on Discord when something needs a person.
if (counts.deferred > 0 && !free) alerts.push(`💳 Credit cap reached: ${counts.deferred} race(s) left for the next run (month ${month}: ${spentThisMonth + credits} of ${config.monthlyCredits}).`);
for (const s of plan.skipped) report.push(`· skipped ${s.url}: ${s.reason}`);

const summary = [
  `## Race check${dryRun ? " (dry run)" : ""}${factsOnly ? " (facts only: no reads)" : free ? " (free: cached reads only)" : ""}`,
  "",
  `- Sites: ${counts.sites} · race pages: ${counts.races} (${counts.unchanged} unchanged, ${counts.read} read, ${counts.deferred} ${free ? "to read" : "deferred"}, ${counts.failed} failed)`,
  `- Reads: ${counts.paidReads} paid, ${counts.cachedReads} from cache · Firecrawl credits: ${credits} (month: ${spentThisMonth + credits} of ${config.monthlyCredits})`,
  ...(free && counts.deferred > 0 ? [`- A paid run would read ${counts.deferred} race(s) for at most ${counts.wouldSpend} credits`] : []),
  `- Races: ${plan.changes.filter((c) => c.kind === "added").length} added, ${plan.changes.filter((c) => c.kind === "updated").length} updated`,
  `- Commit: ${commitSha ?? (dryRun ? "none (dry run)" : "none")}`,
  "",
  ...(plan.changes.length ? ["```", formatCommitMessage(plan), "```", ""] : []),
  ...report.map((line) => `- ${line}`),
].join("\n");
console.log(summary);
const summaryFile = env("GITHUB_STEP_SUMMARY");
if (summaryFile) appendFileSync(summaryFile, `${summary}\n`);

const webhook = env("DISCORD_WEBHOOK_URL");
if (alerts.length > 0 && webhook && !dryRun) {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "OpenRace Data", content: `**Race check needs a look**\n${alerts.join("\n")}`.slice(0, 2000), allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) console.error(`Discord alert failed: ${res.status}`);
}

// Red run if nothing could be read at all (bad key, every site down, ...).
if (counts.failed > 0 && counts.read === 0 && counts.unchanged === 0) process.exitCode = 1;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

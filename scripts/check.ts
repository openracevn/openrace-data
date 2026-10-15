/**
 * The race checker (design v2), run by the two daily schedules (plan 027), by
 * .github/workflows/check.yml's button, or by hand.
 *
 *   npm run check -- --discover                 # Schedule 1 (free): list the sites, fill the to-do list
 *   npm run check -- --todo                     # Schedule 2 (paid): read every page on the to-do list
 *   npm run check -- --site <key>               # one site now
 *   npm run check -- --race <url|id|slug>       # one race now
 *   npm run check                               # every site with a recipe now
 *
 * Options:
 *   --past            also races that already took place (backfill)
 *   --limit N         at most N races per site (tests, small batches)
 *   --max-credits N   Firecrawl credits this run may spend (default 250, none with --todo; the
 *                     month's cap in config/sites.yaml also applies)
 *   --free            no paid reads: only what's cached; reports what would be read
 *   --discover        Schedule 1 (plan 027): --free on the sites due today (lib/todo.ts
 *                     discoverySites: sellers daily, hubs and race sites on Monday of even ISO
 *                     weeks), or on --site. New and changed pages go on state/todo.json; on Monday
 *                     every source page of every upcoming race does too. 0 credits. Without
 *                     --site it runs once a day (--force runs it again). --refresh is the old
 *                     name, kept while trial.yml uses it.
 *   --todo            Schedule 2 (plan 027): read every page on state/todo.json (past races are
 *                     dropped), even an unchanged one (a cached read costs nothing). A page leaves
 *                     the list once read; a failure counts against it. The month's cap is
 *                     scheduledMonthlyCredits. Runs once a day after Schedule 1 (--force again).
 *   --facts-only      no reads at all: create or update races from the site's free data only
 *                     (ActiUp's API: name, dates, place, organizer, sale status). Prices,
 *                     courses and types come with a later normal run, which still reads
 *                     these races. A race already read in full is left alone.
 *   --dry-run         plan against the local checkout and don't commit (still reads, unless --free;
 *                     what it paid for is kept in the local state/reads.json)
 *   --preview <dir>   with --dry-run: write the planned files under <dir>
 *
 * For each site: the recipe lists its races and takes a snapshot of each (free).
 * Pages never read in full come first, then the soonest race day, so a credit cap
 * starves the races that matter least.
 *
 * What a run does to a page (plans 026, 027):
 *   - unchanged fingerprint: the check is recorded (the source said the same), 0 credits
 *     (--race and --todo read it anyway);
 *   - changed, and every page and image is in the read cache: read for free, recorded ok;
 *   - changed, and a paid read is possible (budget, not --free): read with Firecrawl,
 *     cached by content, recorded ok, and off the to-do list;
 *   - changed, but no paid read now: the stored read is kept and the site's free facts
 *     (name, dates, venue, sale status, "from" price...) and links replace the old ones;
 *     the page goes on the to-do list (`changed`) for Schedule 2;
 *   - never read in full, and no paid read now: a race from the free facts alone, as
 *     --facts-only does (status `facts`, no fingerprint), and on the to-do list (`new`).
 * Everything lands in one commit: race files, index, series, organizers and state/.
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
import type { RaceRef, Recipe, RecipeContext, Snapshot } from "./lib/recipes/types.ts";
import type { StoredExtraction } from "./lib/reconcile.ts";
import { INDEX_PATH, IndexSchema, RaceSchema, racePath, upgradeRace } from "./lib/schema.ts";
import { loadSites, roleOf, siteForUrl, type Site } from "./lib/sites.ts";
import { canonicalSourceUrl } from "./lib/slug.ts";
import {
  CHECKS_PATH,
  CREDITS_PATH,
  SITES_STATE_PATH,
  addCredits,
  monthKey,
  parseChecks,
  parseCredits,
  parseSitesState,
  serializeSorted,
  sortByUrgency,
  vietnamDate,
  type Check,
  type SiteState,
} from "./lib/state.ts";
import { TODO_PATH, addTodo, discoverySites, failTodo, isMonday, isPast, parseTodo, readDoneToday, removeTodo, serializeTodo, weeklyPages, type Todo } from "./lib/todo.ts";
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
const todoMode = args.includes("--todo");
const maxCredits = arg("max-credits") !== undefined ? Number(arg("max-credits")) : todoMode ? Number.MAX_SAFE_INTEGER : 250;
const factsOnly = args.includes("--facts-only");
const discover = args.includes("--discover") || args.includes("--refresh");
const force = args.includes("--force");
const free = args.includes("--free") || factsOnly || discover;
const dryRun = args.includes("--dry-run");
const previewDir = arg("preview");
if (siteArg && raceArg) fail("use --site or --race, not both");
if (discover && todoMode) fail("use --discover or --todo, not both");
if (todoMode && (siteArg || raceArg)) fail("--todo reads the to-do list: no --site or --race");
if (discover && raceArg) fail("--discover lists sites: no --race");
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
const todo: Todo = parseTodo(await current.read(TODO_PATH));
// What this run does to the to-do list, replayed on the list at commit time.
const todoOps: ((t: Todo) => void)[] = [];
const onTodo = (op: (t: Todo) => void) => {
  op(todo);
  todoOps.push(op);
};

// Once a day each (plan 027): a retried cron or a late fallback does nothing.
if (!force && discover && !siteArg && todo.discoveredAt && vietnamDate(new Date(todo.discoveredAt)) === today) {
  console.log(`Schedule 1 already ran today (${todo.discoveredAt}); nothing to do (--force runs it again).`);
  process.exit(0);
}
if (!force && todoMode && readDoneToday(todo, today, (iso) => vietnamDate(new Date(iso)))) {
  console.log(`Schedule 2 already read the list today (${todo.readAt}); nothing to do (--force runs it again).`);
  process.exit(0);
}

const scheduled = discover || todoMode;
const monthlyCap = scheduled ? (config.scheduledMonthlyCredits ?? config.monthlyCredits) : config.monthlyCredits;
const budget = Math.max(0, Math.min(maxCredits, monthlyCap - spentThisMonth));
const freeReader: Reader = {
  credits: 0,
  readHtml: async () => ({ ok: false, error: "free run: not read", credits: 0, capped: true }),
  readImage: async () => ({ ok: false, error: "free run: not read", credits: 0, capped: true }),
};
const reader: Reader = free ? freeReader : new FirecrawlReader(requireEnv("FIRECRAWL_API_KEY"), budget);

const runChecks = new Map<string, Check>();
const runSites = new Map<string, SiteState>();
const inputs: SyncInput[] = [];
const report: string[] = [];
const alerts: string[] = [];
const counts = { sites: 0, races: 0, unchanged: 0, read: 0, paidReads: 0, cachedReads: 0, deferred: 0, refreshed: 0, failed: 0, wouldSpend: 0, queued: 0, dropped: 0 };

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
} else if (todoMode) {
  // Schedule 2: the to-do list, grouped by site. Past races are never checked.
  const bySite = new Map<string, Job>();
  for (const entry of [...todo.entries]) {
    const race = index.find((e) => e.id === entry.raceId || e.sourceUrls.includes(entry.url));
    if ((race && isPast(race, today)) || checks[entry.url]?.permanent) {
      onTodo((t) => removeTodo(t, entry.url));
      counts.dropped++;
      continue;
    }
    const site = siteForUrl(config, entry.url);
    const recipe = site && recipeFor(site);
    if (!site || !recipe) {
      onTodo((t) => failTodo(t, entry.url, "not on a site with a recipe"));
      report.push(`✗ ${entry.url}: not on a site with a recipe`);
      counts.failed++;
      continue;
    }
    const slugHint = site.recipe === "actiup" ? new URL(entry.url).pathname.split("/")[3] : undefined;
    const job = bySite.get(site.key) ?? { site, recipe, refs: [] };
    job.refs!.push({ url: entry.url, slugHint });
    bySite.set(site.key, job);
  }
  jobs.push(...bySite.values());
} else {
  const sites = siteArg
    ? config.sites.filter((s) => s.key === siteArg)
    : discover
      ? discoverySites(config, today)
      : config.sites.filter((s) => s.recipe !== "none");
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
  const ctx: RecipeContext = { site, config, http, today, includePast: includePast || !!raceArg || todoMode };
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
  refs = sortRefs(refs.filter((r) => !checks[r.url]?.permanent || !!raceArg)).slice(0, limit);
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
      if (todoMode) onTodo((t) => failTodo(t, ref.url, (err as Error).message));
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
      inputs.push({ url: ref.url, site: site.key, role: roleOf(site), extracted: factsExtraction(snap), checkedAt, slugHint: snap.slugHint });
      runChecks.set(ref.url, { lastCheckedAt: checkedAt, status: "facts" });
      counts.read++;
      siteRead++;
      continue;
    }
    if (!raceArg && !todoMode && prev?.fingerprint === fp && prev.status !== "error") {
      counts.unchanged++;
      runChecks.set(ref.url, { ...prev, lastCheckedAt: checkedAt });
      // The page is back to what was read last: no read needed for the change.
      if (todo.entries.some((e) => e.url === ref.url && e.reason === "changed")) onTodo((t) => removeTodo(t, ref.url));
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
        const what = `${snap.pages.length} page(s)${images ? ` + up to ${images} price image(s)` : ""}, ≤${estimate} credits`;
        // No paid read now: keep what was read before and refresh the free parts (plan 026),
        // and put the page on the to-do list for Schedule 2 (plan 027).
        const raceId = index.find((e) => e.sourceUrls.includes(ref.url))?.id;
        if (!todo.entries.some((e) => e.url === ref.url)) counts.queued++;
        onTodo((t) => addTodo(t, { url: ref.url, ...(raceId && { raceId }), reason: prev?.fingerprint ? "changed" : "new", addedAt: checkedAt }));
        const stored = prev?.fingerprint ? await storedExtraction(ref.url) : null;
        if (stored) {
          inputs.push({ url: ref.url, site: site.key, role: roleOf(site), extracted: { ...stored, ...factsExtraction(snap) }, checkedAt, slugHint: snap.slugHint });
          runChecks.set(ref.url, { ...prev!, lastCheckedAt: checkedAt });
          counts.refreshed++;
          report.push(`~ ${ref.url}: changed; facts refreshed, on the to-do list (${what})`);
        } else {
          // Never read in full: a race from the free facts alone, when they name one.
          const facts = factsExtraction(snap);
          if (normalizeExtraction(facts).ok) inputs.push({ url: ref.url, site: site.key, role: roleOf(site), extracted: facts, checkedAt, slugHint: snap.slugHint });
          runChecks.set(ref.url, { lastCheckedAt: checkedAt, status: "facts" });
          counts.refreshed++;
          report.push(`+ ${ref.url}: not read yet${normalizeExtraction(facts).ok ? "; race from free facts" : ""}, on the to-do list (${what})`);
        }
      } else {
        counts.failed++;
        runChecks.set(ref.url, { ...prev, lastCheckedAt: checkedAt, status: "error", reason: outcome.reason });
        report.push(`✗ ${ref.url}: ${outcome.reason}`);
        if (todoMode) onTodo((t) => failTodo(t, ref.url, outcome.reason));
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
    if (todo.entries.some((e) => e.url === ref.url)) onTodo((t) => removeTodo(t, ref.url));
    console.log(`read ${ref.url} (${outcome.paidReads} paid, ${outcome.cachedReads} cached)`);
  }
  // A free run (facts, refresh) doesn't count as a site check: the next paid run is still due.
  if (!free) runSites.set(site.key, { lastCheckedAt: now.toISOString(), status: "ok", failures: 0 });
  report.push(`site ${site.key}: ${refs.length} race page(s), ${siteRead} read`);
}

// Schedule 1's Monday pass: every upcoming race gets a read this week (plan 027).
if (discover && !siteArg) {
  if (isMonday(today)) {
    const before = todo.entries.length;
    const stamp = now.toISOString();
    for (const page of weeklyPages(index, config, today)) onTodo((t) => addTodo(t, { ...page, reason: "weekly", addedAt: stamp }));
    counts.queued += todo.entries.length - before;
    report.push(`Monday: every upcoming race's pages on the to-do list (${todo.entries.length - before} added)`);
  }
  onTodo((t) => (t.discoveredAt = now.toISOString()));
}
if (todoMode) onTodo((t) => (t.readAt = new Date().toISOString()));

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
const scope = raceArg ? `race ${raceArg}` : todoMode ? "the to-do list, Schedule 2" : siteArg ? `site ${siteArg}` : discover ? "discovery, Schedule 1" : "every site with a recipe";
const context = `Checked by scripts/check.ts (${scope}${includePast ? ", with past races" : ""}).`;

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
  if (credits > 0) out[CREDITS_PATH] = serializeSorted(addCredits(parseCredits(await store.read(CREDITS_PATH)), credits, now));
  if (todoOps.length > 0) {
    const merged = parseTodo(await store.read(TODO_PATH));
    for (const op of todoOps) op(merged);
    out[TODO_PATH] = serializeTodo(merged);
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
    bookkeepingMessage: `state: checked ${runChecks.size} page(s), to-do list ${todo.entries.length}, no race changes\n\n${context}`,
    extraFiles: stateFiles,
    config,
    geoCache,
  });
  plan = result;
  commitSha = result.commitSha;
}

// 4. Report, and alert on Discord when something needs a person.
if (counts.deferred > 0 && !free && budget < CREDITS_PER_READ + credits) {
  alerts.push(`💳 Credit cap reached: ${counts.deferred} race(s) left on the to-do list for the next run (month ${month}: ${spentThisMonth + credits} of ${monthlyCap}${scheduled ? " scheduled" : ""}).`);
}
for (const s of plan.skipped) report.push(`· skipped ${s.url}: ${s.reason}`);

const summary = [
  `## Race check${dryRun ? " (dry run)" : ""}${discover ? " (Schedule 1: discovery, free)" : todoMode ? " (Schedule 2: the to-do list)" : factsOnly ? " (facts only: no reads)" : free ? " (free: cached reads only)" : ""}`,
  "",
  `- Sites: ${counts.sites} · race pages: ${counts.races} (${counts.unchanged} unchanged, ${counts.read} read, ${counts.refreshed} refreshed and waiting for a read, ${counts.failed} failed)`,
  `- Reads: ${counts.paidReads} paid, ${counts.cachedReads} from cache · Firecrawl credits: ${credits} (month: ${spentThisMonth + credits} of ${monthlyCap}${scheduled ? " scheduled" : ""})`,
  `- To-do list: ${todo.entries.length} page(s)${counts.queued ? `, ${counts.queued} added` : ""}${counts.dropped ? `, ${counts.dropped} past race(s) dropped` : ""}`,
  ...(counts.deferred > 0 ? [`- A paid run would read the ${counts.deferred} waiting race(s) for at most ${counts.wouldSpend} credits`] : []),
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
if (counts.failed > 0 && counts.read === 0 && counts.unchanged === 0 && counts.refreshed === 0) process.exitCode = 1;

/** A source's free parts: the site's own facts, the page's links and the site's hints. Same shape for --facts-only and a refresh. */
function factsExtraction(snap: Snapshot): StoredExtraction {
  return {
    ...(snap.facts && { facts: snap.facts }),
    links: snap.links,
    ...(snap.hints?.series && { series: snap.hints.series }),
    ...(snap.hints?.organizer && { organizer: snap.hints.organizer }),
  };
}

/** What this page's source said when it was last read in full (its stored `extracted`), from the race that has it; null if no race does. */
async function storedExtraction(url: string): Promise<StoredExtraction | null> {
  let canonical = url;
  try {
    canonical = canonicalSourceUrl(url);
  } catch {
    // keep the raw URL
  }
  const entry = index.find((e) => e.sourceUrls.includes(url) || e.sourceUrls.includes(canonical));
  if (!entry) return null;
  const text = await current.read(racePath(entry));
  if (!text) return null;
  const race = RaceSchema.parse(upgradeRace(JSON.parse(text)));
  const source = race.sources.find((s) => s.url === url || s.url === canonical);
  return source ? (source.extracted as StoredExtraction) : null;
}

/** Pages never read first, then the soonest race day (from the listing, else the race on file); see lib/state.ts sortByUrgency. */
function sortRefs(refs: RaceRef[]): RaceRef[] {
  return sortByUrgency(refs, checks, (r) => r.date ?? index.find((e) => e.sourceUrls.includes(r.url))?.date ?? "9999-12-31");
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

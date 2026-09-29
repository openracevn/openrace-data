/**
 * Reading races without Firecrawl: an agent (Claude Code, Antigravity, ...) reads the
 * pages and price images itself, for free. Same recipes, same extraction format, same
 * normalization and commit as scripts/check.ts. The skill that drives it:
 * .claude/skills/update-race/refs/agent-read/REFERENCE.md.
 *
 *   npm run agent-read -- prepare --race <url|id|slug> [--race <url|id|slug> ...] [--out <dir>]
 *       Repeat --race for a hand-picked batch (a curated list of slugs, not a whole site);
 *       each is numbered in order into the same <dir>, skipping ones with no recipe.
 *   npm run agent-read -- prepare --race <existing-race-id-or-slug>@<new-url> [--out <dir>]
 *       Attach a new source URL to a race you already know exists (found by hand),
 *       instead of letting `commit`'s matching decide by name/date. Use this once the
 *       matching's duplicate-race warning (a "+" line's "possible duplicate of ...")
 *       tells you the new page is the same race scoring under its threshold — steers
 *       the match itself rather than merging two files after the fact.
 *   npm run agent-read -- prepare --site <key> [--past] [--limit N] [--all] [--out <dir>]
 *       Free. Runs the recipe and saves, per race, what Firecrawl would be given:
 *       <dir>/<nn>-<slug>/page-<n>.html (the cleaned HTML), image-<n>.<ext> (price images),
 *       task.json (source, facts, links, fingerprint) and read.json (to fill in).
 *       <dir>/extraction.json holds the prompts and schemas Firecrawl is given.
 *       --site skips races already read (a fingerprint in state/checks.json) unless --all.
 *   npm run agent-read -- commit <dir> [--commit]
 *       Checks every read.json, prints the normalized prices of each race, and plans the
 *       sync (dry run). With --commit: commits the races, and records each snapshot's
 *       fingerprint in state/checks.json so scheduled runs don't pay to read it again.
 *
 * Default <dir>: .agent-read (gitignored). `prepare` only clears its own earlier output there,
 * never other folders; update-race workers use --out .agent-read/<unit>/prepared. Env for --commit: GITHUB_TOKEN.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env, requireEnv } from "./lib/env.ts";
import { enrichGeo, geoTargetFromExtraction, geoTargetFromRace, type GeoTarget } from "./lib/geocode.ts";
import { GEO_PATH, parseGeoCache, type GeoCache, type GeoCacheEntry } from "./lib/geo.ts";
import { IMAGE_EXTRACTION, PAGE_EXTRACTION, normalizeExtraction } from "./lib/extraction.ts";
import { createHttp } from "./lib/http.ts";
import { snapshotFingerprint } from "./lib/read.ts";
import { recipeFor } from "./lib/recipes/index.ts";
import type { RaceRef, Recipe, RecipeContext, Snapshot } from "./lib/recipes/types.ts";
import { INDEX_PATH, IndexSchema, RaceSchema, racePath, upgradeRace } from "./lib/schema.ts";
import { loadSites, roleOf, siteForUrl, type Site } from "./lib/sites.ts";
import { canonicalSourceUrl } from "./lib/slug.ts";
import { CHECKS_PATH, parseChecks, serializeSorted, vietnamDate } from "./lib/state.ts";
import { formatCommitMessage, planSync, syncToGitHub, type RaceStore, type SyncInput } from "./sync.ts";

/** Price images saved per race; recipes list the likeliest first (as read.ts). */
const MAX_IMAGES = 4;

type Task = {
  url: string;
  site: string;
  role: SyncInput["role"];
  fingerprint: string;
  slugHint?: string;
  matchId?: string;
  facts?: Record<string, unknown>;
  links: Snapshot["links"];
  hints?: Snapshot["hints"];
  priceImagesCertain: boolean;
  pages: { url: string; file: string }[];
  images: { url: string; file: string }[];
};
type Read = { pages: { url: string; json: Record<string, unknown> | null }[]; images: { url: string; json: Record<string, unknown> | null }[] };

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const argAll = (name: string) => {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const value = args[i] === `--${name}` ? args[i + 1] : undefined;
    if (value !== undefined) values.push(value);
  }
  return values;
};
const local: RaceStore = {
  read: async (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
};

const command = args[0];
if (command === "prepare") await prepare();
else if (command === "commit") await commit();
else fail("usage: npm run agent-read -- prepare (--race <url|id|slug> [--race ...] | --site <key>) [...] | commit <dir> [--commit]");

async function prepare() {
  const raceArgs = argAll("race")
    .map((s) => s.trim())
    .filter(Boolean);
  const siteArg = arg("site");
  const out = arg("out") ?? ".agent-read";
  const limit = arg("limit") ? Number(arg("limit")) : Number.POSITIVE_INFINITY;
  if ((raceArgs.length > 0) === !!siteArg) fail("use --race (repeatable) or --site");
  if (!(limit > 0)) fail("--limit must be a positive number");

  const config = loadSites();
  const http = createHttp();
  const today = vietnamDate(new Date());
  const checks = parseChecks(await local.read(CHECKS_PATH));
  const index = IndexSchema.parse(JSON.parse((await local.read(INDEX_PATH)) ?? "[]"));

  const jobs: { site: Site; recipe: Recipe; refs?: RaceRef[]; matchId?: string }[] = [];
  if (raceArgs.length > 0) {
    for (const raceArg of raceArgs) {
      const at = raceArg.indexOf("@");
      const attachTo = at > 0 ? raceArg.slice(0, at) : undefined;
      const arg = attachTo ? raceArg.slice(at + 1) : raceArg;
      let matchId: string | undefined;
      if (attachTo) {
        const target = index.find((e) => e.id === attachTo || e.slug === attachTo);
        if (!target) {
          console.log(`✗ "${attachTo}@..." has no race with id or slug "${attachTo}" in ${INDEX_PATH}`);
          continue;
        }
        matchId = target.id;
      }
      const entry = !attachTo ? index.find((e) => e.id === arg || e.slug === arg) : undefined;
      let urls = entry?.sourceUrls ?? [];
      if (!entry) {
        try {
          urls = [canonicalSourceUrl(arg)];
        } catch {
          console.log(`✗ "${arg}" is neither a race id or slug in ${INDEX_PATH} nor a URL`);
          continue;
        }
      }
      let added = 0;
      for (const url of urls) {
        const site = siteForUrl(config, url);
        const recipe = site && recipeFor(site);
        if (!site || !recipe) continue; // e.g. a hand-entered reference
        const slugHint = site.recipe === "actiup" ? new URL(url).pathname.split("/")[3] : undefined;
        jobs.push({ site, recipe, refs: [{ url, slugHint }], matchId });
        added++;
      }
      if (added === 0) console.log(`✗ ${raceArg} has no source on a site with a recipe`);
    }
    if (jobs.length === 0) fail("no race resolved to a source with a recipe");
  } else {
    const site = config.sites.find((s) => s.key === siteArg);
    const recipe = site && recipeFor(site);
    if (!site || !recipe) fail(`no site "${siteArg}" with a recipe in config/sites.yaml`);
    jobs.push({ site, recipe });
  }

  clearPrepared(out);
  mkdirSync(out, { recursive: true });
  // The instructions Firecrawl is given; the agent follows the same ones.
  writeFileSync(join(out, "extraction.json"), `${JSON.stringify({ page: PAGE_EXTRACTION, image: IMAGE_EXTRACTION }, null, 2)}\n`);

  let n = 0;
  let skipped = 0;
  for (const { site, recipe, refs: given, matchId } of jobs) {
    const ctx: RecipeContext = { site, config, http, today, includePast: args.includes("--past") || raceArgs.length > 0 };
    let refs = given ?? (await recipe.discover(ctx));
    if (raceArgs.length === 0) {
      const before = refs.length;
      refs = refs.filter((r) => !checks[r.url]?.permanent && (args.includes("--all") || !checks[r.url]?.fingerprint));
      skipped += before - refs.length;
    }
    for (const ref of refs.slice(0, limit)) {
      let snap: Snapshot;
      try {
        snap = await recipe.snapshot(ref, ctx);
      } catch (err) {
        console.log(`✗ ${ref.url}: ${(err as Error).message}`);
        continue;
      }
      n++;
      const name = `${String(n).padStart(2, "0")}-${(snap.slugHint ?? new URL(ref.url).pathname.split("/").filter(Boolean).pop() ?? "race").slice(0, 60)}`;
      const dir = join(out, name);
      mkdirSync(dir, { recursive: true });
      const pages = snap.pages.map((p, i) => {
        const file = `page-${i + 1}.html`;
        writeFileSync(join(dir, file), p.html);
        return { url: p.url, file };
      });
      const images: Task["images"] = [];
      for (const url of snap.priceImages.slice(0, MAX_IMAGES)) {
        try {
          const { bytes, contentType } = await http.bytes(url);
          const file = `image-${images.length + 1}.${imageExtension(bytes, contentType, url)}`;
          writeFileSync(join(dir, file), bytes);
          images.push({ url, file });
        } catch (err) {
          console.log(`  · ${url}: ${(err as Error).message}`);
        }
      }
      const task: Task = {
        url: ref.url,
        site: site.key,
        role: roleOf(site),
        fingerprint: snapshotFingerprint(snap),
        ...(snap.slugHint && { slugHint: snap.slugHint }),
        ...(matchId && { matchId }),
        ...(snap.facts && { facts: snap.facts }),
        links: snap.links,
        ...(snap.hints && { hints: snap.hints }),
        priceImagesCertain: !!snap.priceImagesCertain,
        pages,
        images,
      };
      const read: Read = {
        pages: pages.map((p, i) => ({ url: p.url, json: i === 0 && snap.pricesDraft?.length ? { prices: snap.pricesDraft } : null })),
        images: images.map((i) => ({ url: i.url, json: null })),
      };
      writeFileSync(join(dir, "task.json"), `${JSON.stringify(task, null, 2)}\n`);
      writeFileSync(join(dir, "read.json"), `${JSON.stringify(read, null, 2)}\n`);
      console.log(`${name}: ${pages.length} page(s), ${images.length} image(s) · ${ref.url}`);
    }
  }
  console.log(`\n${n} race(s) prepared in ${out}${skipped ? ` (${skipped} already read, skipped; --all to include them)` : ""}. Fill in each read.json, then: npm run agent-read -- commit ${out}`);
}

/**
 * Clears what an earlier `prepare` left in <dir> (extraction.json and the <nn>-<slug>/ folders
 * holding a task.json) and nothing else. It used to wipe <dir> whole, which destroyed other
 * update-race workers' saved pages and search logs in the shared .agent-read (plan 019).
 * Workers should still prepare into their own folder: --out .agent-read/<unit>/prepared.
 */
function clearPrepared(out: string): void {
  if (!existsSync(out)) return;
  for (const name of readdirSync(out)) {
    const path = join(out, name);
    if (name === "extraction.json" || existsSync(join(path, "task.json"))) rmSync(path, { recursive: true, force: true });
  }
}

async function commit() {
  const out = args[1] && !args[1].startsWith("--") ? args[1] : ".agent-read";
  const doCommit = args.includes("--commit");
  const config = loadSites();
  const checkedAt = new Date().toISOString();
  const inputs: SyncInput[] = [];
  const fingerprints = new Map<string, string>();
  const problems: string[] = [];

  for (const name of readdirSync(out).sort()) {
    const dir = join(out, name);
    if (!existsSync(join(dir, "task.json"))) continue;
    const task = JSON.parse(readFileSync(join(dir, "task.json"), "utf8")) as Task;
    const read = JSON.parse(readFileSync(join(dir, "read.json"), "utf8")) as Read;
    const unread = read.pages.filter((p) => !isObject(p.json)).map((p) => p.url);
    if (unread.length > 0) {
      problems.push(`${name}: page not read: ${unread.join(", ")}`);
      continue;
    }
    // An image left null is one the agent looked at and found no prices in.
    const images = read.images.filter((i) => isObject(i.json)) as { url: string; json: Record<string, unknown> }[];
    const extracted = {
      ...(task.facts && { facts: task.facts }),
      pages: read.pages as { url: string; json: Record<string, unknown> }[],
      ...(images.length > 0 && { images }),
      links: task.links,
      ...(task.hints?.series && { series: task.hints.series }),
      ...(task.hints?.organizer && { organizer: task.hints.organizer }),
      readBy: "agent",
    };
    const normalized = normalizeExtraction(extracted);
    if (!normalized.ok) {
      problems.push(`${name}: ${normalized.reason}`);
      continue;
    }
    const f = normalized.facts;
    console.log(`\n## ${name}: ${f.name}, ${f.date}${f.endDate ? ` to ${f.endDate}` : ""} · ${f.types.join(", ")} · ${f.courses.map((course) => course.label).join(", ") || "no courses"}`);
    if (f.prices.length === 0) console.log("   no prices");
    for (const t of f.prices) {
      console.log(`   ${t.distance ?? "-"} · ${t.tier} (${t.kind}${t.audience ? `, ${t.audience}` : ""}) · ${t.price.toLocaleString("en")} · ${t.from ?? "?"} → ${t.to ?? "?"}`);
    }
    inputs.push({ url: task.url, site: task.site, role: task.role, extracted, checkedAt, slugHint: task.slugHint, matchId: task.matchId });
    fingerprints.set(task.url, task.fingerprint);
  }
  for (const p of problems) console.log(`\n✗ ${p}`);
  if (inputs.length === 0) fail("\nnothing to commit");

  const index = IndexSchema.parse(JSON.parse((await local.read(INDEX_PATH)) ?? "[]"));
  const geoTargets: GeoTarget[] = [];
  for (const input of inputs) {
    const normalized = normalizeExtraction(input.extracted);
    if (normalized.ok) {
      geoTargets.push({
        id: input.url,
        name: normalized.facts.name,
        types: normalized.facts.types,
        location: { venue: normalized.facts.venue, city: normalized.facts.city },
        mapsUrls: geoTargetFromExtraction(input.extracted)?.mapsUrls ?? [],
      });
    }
    const entry = index.find((candidate) => candidate.sourceUrls.includes(input.url));
    if (!entry) continue;
    const text = await local.read(racePath(entry));
    if (text) geoTargets.push(geoTargetFromRace(RaceSchema.parse(upgradeRace(JSON.parse(text)))));
  }
  let geoCache: GeoCache = parseGeoCache(await local.read(GEO_PATH));
  const filledGeo = new Map<string, GeoCacheEntry>();
  await enrichGeo(geoTargets, geoCache, {
    onEntry: (next, key) => {
      geoCache = next;
      filledGeo.set(key, next[key]!);
    },
    onError: (target, error) => console.error(`geo lookup failed for ${target.name}: ${error.message}`),
  });

  const context = `Read by an agent (scripts/agent-read.ts), not Firecrawl: ${inputs.length} race page(s).`;
  const checksFile = async (store: RaceStore) => {
    const checks = parseChecks(await store.read(CHECKS_PATH));
    for (const [url, fingerprint] of fingerprints) checks[url] = { lastCheckedAt: checkedAt, status: "ok", fingerprint };
    const files: Record<string, string> = { [CHECKS_PATH]: serializeSorted(checks) };
    if (filledGeo.size > 0) {
      const geo = parseGeoCache(await store.read(GEO_PATH));
      for (const [key, entry] of filledGeo) geo[key] = entry;
      files[GEO_PATH] = serializeSorted(geo);
    }
    return files;
  };
  if (!doCommit) {
    const plan = await planSync(local, inputs, config, checkedAt, undefined, geoCache);
    console.log(`\n${plan.changes.length ? formatCommitMessage(plan) : "No race changes."}`);
    for (const s of plan.skipped) console.log(`skipped ${s.url}: ${s.reason}`);
    console.log("\nDry run: re-run with --commit to write (GITHUB_TOKEN=$(gh auth token)).");
    return;
  }
  const result = await syncToGitHub(
    {
      token: requireEnv("GITHUB_TOKEN"),
      owner: env("GITHUB_OWNER") ?? "openracevn",
      repo: env("GITHUB_REPO") ?? "openrace-data",
      branch: env("GITHUB_BRANCH") ?? "main",
    },
    inputs,
    config,
    { now: checkedAt, context, extraFiles: checksFile, bookkeepingMessage: `state: agent read ${inputs.length} page(s), no race changes\n\n${context}`, config, geoCache },
  );
  console.log(`\n${result.changes.length ? formatCommitMessage(result) : "No race changes."}`);
  for (const s of result.skipped) console.log(`skipped ${s.url}: ${s.reason}`);
  console.log(result.commitSha ? `\nCommitted ${result.commitSha}` : "\nNothing committed.");
}

function imageExtension(bytes: Uint8Array, contentType: string, url: string): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "webp"; // RIFF....WEBP
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "gif";
  return contentType.split("/")[1]?.split(";")[0] ?? new URL(url).pathname.split(".").pop() ?? "img";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

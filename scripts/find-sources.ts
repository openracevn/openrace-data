/**
 * Run the fixed six-tier source-and-Wayback search (plan 013) for one race's
 * missing field(s), instead of an agent hand-rolling the same curl/CDX sequence
 * every time and stopping at the first empty fetch.
 *
 *   npm run find-sources -- <race url|slug|id>
 *   npm run find-sources -- <race url|slug|id> --field prices
 *
 * Tiers, in order, each tried live then (if empty/missing the field) via its
 * newest Wayback snapshot before moving on:
 *   1. irace (ticket.irace.vn / irace.vn/su-kien) — free HTML text, no OCR
 *   2. irace, Wayback
 *   3. the race's own/organizer site (main site) — including one same-site subpage
 *   4. main site, Wayback
 *   5. ActiUp — price is usually an image; only price_type/e.place/organizer are
 *      read for free here, an image found is saved but not "read" by this script
 *   6. ActiUp, Wayback
 * Tier 7 (web search) is not scriptable here (WebSearch isn't callable from
 * scripts/) and stays a manual step for the calling skill.
 *
 * A tier is skipped (no folder, no attempt) when the race has no known URL for
 * it — this script never guesses a slug or searches for one; that's tier 7's job.
 * Every fetch is saved under .agent-read-archive/<date>-<slug>-source-check/, and
 * an existing archived copy (any date, same tier+url) is read instead of
 * re-fetched. Only reads: no commit, no write to data/.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePriceTable } from "./lib/recipes/irace.ts";
import { parseHtml } from "./lib/html.ts";
import { createHttp } from "./lib/http.ts";
import { INDEX_PATH, IndexSchema, RaceSchema, racePath, upgradeRace, type IndexEntry } from "./lib/schema.ts";
import { hostOf, loadSites, siteForUrl } from "./lib/sites.ts";

type Field = "prices" | "venue" | "city" | "organizer";
const ALL_FIELDS: Field[] = ["prices", "venue", "city", "organizer"];

const args = process.argv.slice(2);
const raceArg = args.find((a) => !a.startsWith("--"));
const fieldIndex = args.indexOf("--field");
const fieldArg = fieldIndex >= 0 ? (args[fieldIndex + 1] as Field | undefined) : undefined;
if (!raceArg) fail("usage: npm run find-sources -- <race url|slug|id> [--field prices|venue|city|organizer]");
if (fieldArg && !ALL_FIELDS.includes(fieldArg)) fail(`--field must be one of ${ALL_FIELDS.join(", ")}`);

const config = loadSites();
const http = createHttp();
const index = IndexSchema.parse(JSON.parse(readFileSync(INDEX_PATH, "utf8")));
const entry = resolveRace(raceArg);
if (!entry) fail(`"${raceArg}" is not a known race id, slug, source URL or link URL (${INDEX_PATH})`);

const race = RaceSchema.parse(upgradeRace(JSON.parse(readFileSync(racePath(entry), "utf8"))));
const targets: Field[] = fieldArg
  ? [fieldArg]
  : ALL_FIELDS.filter((f) => {
      if (f === "prices") return race.prices.length === 0;
      if (f === "venue") return !race.location.venue;
      if (f === "city") return !race.location.city;
      return !race.organizer;
    });

if (targets.length === 0) {
  console.log(`${entry.slug}: already has prices, venue, city and organizer — nothing to find.`);
  process.exit(0);
}
console.log(`${entry.slug}: looking for ${targets.join(", ")}`);

const today = new Date().toISOString().slice(0, 10);
const sessionDir = `.agent-read-archive/${today}-${entry.slug}-source-check`;

type Attempt = { step: string; action: string; result: string };
const attempts: Attempt[] = [];
const iraceUrls = entry.sourceUrls.filter((u) => siteForUrl(config, u)?.key === "irace");
const actiupUrls = entry.sourceUrls.filter((u) => siteForUrl(config, u)?.key === "actiup");
const mainUrls = entry.sourceUrls.filter((u) => !iraceUrls.includes(u) && !actiupUrls.includes(u));

// --- tiers ---------------------------------------------------------------

type Found = { found: Field[]; facts: Record<string, string> };
type Reader = (url: string, dir: string, n: number, archived?: string) => Promise<Found>;

async function runTier(name: string, urls: string[], read: Reader, opts: { subpages?: boolean } = {}): Promise<string | null> {
  if (urls.length === 0) {
    attempts.push({ step: name, action: "(no known URL for this race)", result: "skipped" });
    return null;
  }
  const dir = join(sessionDir, name);
  const live = await tryUrls(name, urls, dir, read, opts);
  if (live) return live;

  const waybackDir = join(sessionDir, `${name}-wayback`);
  const snapshots = (await Promise.all(urls.map(waybackSnapshotUrl))).filter((u): u is string => !!u);
  if (snapshots.length === 0) {
    attempts.push({ step: `${name}-wayback`, action: "CDX lookup", result: "no snapshot found" });
    return null;
  }
  return tryUrls(`${name}-wayback`, snapshots, waybackDir, read, opts);
}

async function tryUrls(step: string, urls: string[], dir: string, read: Reader, opts: { subpages?: boolean }): Promise<string | null> {
  let n = 0;
  const foundAll = new Set<Field>();
  for (const url of urls) {
    n++;
    try {
      const { found, facts } = await cachedOrFetch(step, url, dir, n, read);
      for (const f of found) foundAll.add(f);
      attempts.push({
        step,
        action: `fetch ${url}`,
        result: found.length > 0 ? `found ${found.join(", ")}${Object.keys(facts).length ? ` (${JSON.stringify(facts)})` : ""}` : "fetched, none of the target fields found",
      });
      if (opts.subpages && n === 1) {
        const sub = await findSubpage(url, dir);
        if (sub) {
          n++;
          const subResult = await cachedOrFetch(step, sub, dir, n, read);
          for (const f of subResult.found) foundAll.add(f);
          attempts.push({ step, action: `fetch subpage ${sub}`, result: subResult.found.length > 0 ? `found ${subResult.found.join(", ")}` : "fetched, nothing new" });
        }
      }
      if (targets.every((t) => foundAll.has(t))) return step;
    } catch (err) {
      attempts.push({ step, action: `fetch ${url}`, result: `error: ${(err as Error).message}` });
    }
  }
  return targets.some((t) => foundAll.has(t)) ? step : null;
}

/** Read a folder from a previous session's archive for this exact URL first; only fetch what isn't already saved. */
async function cachedOrFetch(step: string, url: string, dir: string, n: number, read: Reader): Promise<Found> {
  const cached = findArchived(entry!.slug, step, url);
  if (cached) {
    console.log(`  (archived) ${step} <- ${cached}`);
    return read(url, dir, n, cached);
  }
  return read(url, dir, n);
}

/** Any earlier .agent-read-archive/<date>-<slug>-source-check/<step>/ folder whose meta.json names this URL. */
function findArchived(slug: string, step: string, url: string): string | null {
  const root = ".agent-read-archive";
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root).sort().reverse()) {
    if (!d.endsWith(`${slug}-source-check`)) continue;
    const stepDir = join(root, d, step);
    const meta = join(stepDir, "meta.json");
    if (!existsSync(meta)) continue;
    try {
      const urls: Record<string, string> = JSON.parse(readFileSync(meta, "utf8"));
      const file = Object.entries(urls).find(([, u]) => u === url)?.[0];
      if (file) return join(stepDir, file);
    } catch {
      continue;
    }
  }
  return null;
}

function saveMeta(dir: string, file: string, url: string): void {
  mkdirSync(dir, { recursive: true });
  const metaPath = join(dir, "meta.json");
  const meta: Record<string, string> = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
  meta[file] = url;
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
}

// --- readers ---------------------------------------------------------------

async function readIraceLike(url: string, dir: string, n: number, archived?: string): Promise<Found> {
  const html = archived ? readFileSync(archived, "utf8") : await http.text(url);
  const file = `page-${n}.html`;
  if (!archived) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), html);
    saveMeta(dir, file, url);
  }
  const root = parseHtml(html);
  const table = root.querySelector("#personal") ?? root.querySelector("#bang-gia table") ?? root.querySelector(".eventon_desc_in table") ?? root.querySelector("table");
  const prices = table ? parsePriceTable(table) : [];
  return detectFields(html, prices.length > 0);
}

async function readActiup(url: string, dir: string, n: number, archived?: string): Promise<Found> {
  const slug = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  const api = `https://api.actiup.net/v2/content/events/slug/${encodeURIComponent(slug)}`;
  type Detail = { result?: { place?: string; merchant_public_name?: string; merchant?: { merchant_name?: string }; price_type?: string } };
  const json = archived
    ? (JSON.parse(readFileSync(archived, "utf8")) as Detail)
    : await http.json<Detail>(api, { "Accept-Language": "vi" });
  const file = `event-${n}.json`;
  if (!archived) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), JSON.stringify(json, null, 2));
    saveMeta(dir, file, url);
  }
  const e = json.result;
  const found: Field[] = [];
  const facts: Record<string, string> = {};
  if (e?.place) {
    found.push("venue", "city");
    facts.place = e.place;
  }
  const organizer = e?.merchant?.merchant_name ?? e?.merchant_public_name;
  if (organizer) {
    found.push("organizer");
    facts.organizer = organizer;
  }
  if (e?.price_type === "free") {
    found.push("prices");
    facts.price_type = "free";
  } else {
    facts.note = "ActiUp prices are usually an image; not read by this script (agent-read or the agent's own eyes reads it)";
  }
  return { found: [...new Set(found)], facts };
}

async function readGenericPage(url: string, dir: string, n: number, archived?: string): Promise<Found> {
  const html = archived ? readFileSync(archived, "utf8") : await http.text(url);
  const file = `page-${n}.html`;
  if (!archived) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), html);
    saveMeta(dir, file, url);
  }
  return detectFields(html);
}

// --- field detection (heuristic; the agent still reads and judges the saved files) ---

const LD_JSON = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const PRICE_AMOUNT = /\d[\d.,]{2,}\s*(?:đ|vnd)\b/gi;
const VENUE_WORDS = /địa điểm|venue|nơi (?:diễn ra|tổ chức)/i;
const ORGANIZER_WORDS = /ban tổ chức|đơn vị tổ chức|organizer|organised by|organized by/i;

function detectFields(html: string, hasPriceTable = false): Found {
  const found: Field[] = [];
  const facts: Record<string, string> = {};

  let venue: string | undefined;
  let organizer: string | undefined;
  for (const m of html.matchAll(LD_JSON)) {
    try {
      const data = JSON.parse(m[1]!);
      const loc = Array.isArray(data.location) ? data.location[0] : data.location;
      const org = Array.isArray(data.organizer) ? data.organizer[0] : data.organizer;
      venue ??= loc?.name;
      organizer ??= org?.name;
    } catch {
      continue;
    }
  }
  if (venue) {
    found.push("venue", "city");
    facts.venue = venue;
  } else if (VENUE_WORDS.test(html)) {
    found.push("venue", "city");
    facts.venueHint = "keyword found, not extracted";
  }
  if (organizer) {
    found.push("organizer");
    facts.organizer = organizer;
  } else if (ORGANIZER_WORDS.test(html)) {
    found.push("organizer");
    facts.organizerHint = "keyword found, not extracted";
  }
  const priceHits = [...html.matchAll(PRICE_AMOUNT)].length;
  if (hasPriceTable || priceHits >= 2) {
    found.push("prices");
    facts.priceHits = String(hasPriceTable ? "table" : priceHits);
  }
  return { found: [...new Set(found)], facts };
}

// --- subpage discovery -----------------------------------------------------

const SUBPAGE_HREF = /thong-tin|cuoc-dua|price|gia-ve|bang-gia|info/i;

async function findSubpage(url: string, dir: string): Promise<string | null> {
  try {
    const html = await http.text(url);
    const root = parseHtml(html);
    const host = hostOf(url);
    for (const a of root.querySelectorAll("a")) {
      const href = a.getAttribute("href");
      if (!href || !SUBPAGE_HREF.test(href)) continue;
      const abs = new URL(href, url).toString();
      if (hostOf(abs) !== host || abs === url) continue;
      return abs;
    }
  } catch {
    // best-effort only
  }
  return null;
}

// --- Wayback -----------------------------------------------------------

async function waybackSnapshotUrl(url: string): Promise<string | null> {
  try {
    type Cdx = [string, string, string, string, string, string, string][];
    const rows = await http.json<Cdx>(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&filter=statuscode:200&limit=5&collapse=timestamp:6`);
    const last = rows.slice(1).at(-1); // header row first; newest snapshot last
    if (!last) return null;
    const [, timestamp, original] = last;
    return `https://web.archive.org/web/${timestamp}/${original}`;
  } catch {
    return null;
  }
}

// --- race resolution -----------------------------------------------------

function resolveRace(q: string): IndexEntry | null {
  return index.find((e) => e.id === q || e.slug === q) ?? index.find((e) => e.sourceUrls.includes(q) || e.linkUrls.includes(q)) ?? null;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// --- run (after every declaration above, so tier readers can close over them) ---

let resolvedBy: string | null = null;
resolvedBy ??= await runTier("irace", iraceUrls, readIraceLike);
resolvedBy ??= await runTier("main-site", mainUrls, readGenericPage, { subpages: true });
resolvedBy ??= await runTier("actiup", actiupUrls, readActiup);

mkdirSync(sessionDir, { recursive: true });
writeFileSync(join(sessionDir, "attempts.json"), JSON.stringify(attempts, null, 2) + "\n");

console.log("");
for (const a of attempts) console.log(`- [${a.step}] ${a.action} -> ${a.result}`);
console.log("");
if (resolvedBy) {
  console.log(`Resolved by: ${resolvedBy}`);
} else {
  console.log(`None of 1-6 resolved ${targets.join(", ")} — try a web search (tier 7, by hand: WebSearch, varying phrasing, save hits into ${sessionDir}/web-search-hit-<n>/ and ${sessionDir}/search-log.md).`);
}
console.log(`\nSaved to ${sessionDir}/ (raw pages/images) and attempts.json.`);

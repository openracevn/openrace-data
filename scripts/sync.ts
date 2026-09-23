/**
 * Diff/commit core. Given freshly extracted race data, works out which race
 * files (and the index) must change, then commits all of it to GitHub as one
 * commit. Pure planning (`planSync`) is separated from I/O so it can be tested
 * and reused by the scheduled checker (`check.ts`) and the manual CLI.
 */
import { changedFields, deepEqual, stabilize } from "./lib/diff.ts";
import { GitHubRepo, isNotFastForward, type GitHubTarget } from "./lib/github.ts";
import { normalizeExtracted } from "./lib/extraction.ts";
import { foldVietnamese } from "./lib/places.ts";
import { SOURCE_PRIORITY, reconcile } from "./lib/reconcile.ts";
import {
  INDEX_PATH,
  IndexSchema,
  RaceSchema,
  racePath,
  serialize,
  type CanonicalField,
  type IndexEntry,
  type Race,
  type RaceSource,
  type SourceName,
} from "./lib/schema.ts";
import { canonicalSourceUrl } from "./lib/slug.ts";
import { SOURCES, sourceForUrl } from "./lib/sources.ts";

export type SyncInput = {
  /** Source page URL the data was extracted from. */
  url: string;
  /** Raw extraction as returned by Firecrawl; stored verbatim as `rawExtracted`. */
  extracted: Record<string, unknown>;
  /** When the source was checked (ISO 8601). */
  checkedAt: string;
};

export interface RaceStore {
  /** File contents at the snapshot being planned against, or null if absent. */
  read(path: string): Promise<string | null>;
}

export type RaceChange = {
  id: string;
  slug: string;
  kind: "added" | "updated";
  fields: CanonicalField[];
  /** A page from another source joined this race. */
  joined?: boolean;
};
export type Skipped = { url: string; reason: string };

export type SyncPlan = {
  /** Repo path -> full new file contents. Empty when nothing changed. */
  files: Record<string, string>;
  changes: RaceChange[];
  skipped: Skipped[];
};

type Item = { input: SyncInput; url: string; source: SourceName };
/** All inputs of one race in this run (e.g. its ActiUp and bibchung pages). */
type Group = { id: string; newSlug?: string; items: Item[] };
/** What matching needs to know about a race: known ones from the index, plus races created in this run. */
type Candidate = { id: string; name: string; date: string; sources: Set<SourceName> };

export async function planSync(
  store: RaceStore,
  inputs: readonly SyncInput[],
  now = new Date().toISOString(),
  newId: () => string = () => crypto.randomUUID(),
): Promise<SyncPlan> {
  const indexText = await store.read(INDEX_PATH);
  const index: IndexEntry[] = indexText ? IndexSchema.parse(JSON.parse(indexText)) : [];
  const indexById = new Map(index.map((e) => [e.id, e]));
  const idByUrl = new Map(index.flatMap((e) => e.sourceUrls.map((u) => [u, e.id] as const)));
  const takenSlugs = new Set(index.map((e) => e.slug));
  const candidates: Candidate[] = index.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    sources: new Set(e.sourceUrls.map((u) => sourceForUrl(u)).filter((x): x is SourceName => x !== null)),
  }));

  const skipped: Skipped[] = [];
  const groups = new Map<string, Group>();
  const addToGroup = (id: string, item: Item, newSlug?: string) => {
    const group = groups.get(id) ?? { id, newSlug, items: [] };
    group.items.push(item);
    groups.set(id, group);
  };

  // Primary source first, so an ActiUp page creates the race a bibchung page then joins.
  const ordered = dedupeByUrl(inputs, skipped)
    .map((input) => ({ input, url: input.url, source: sourceForUrl(input.url) }))
    .sort((a, b) => sourceRank(a.source) - sourceRank(b.source));

  for (const { input, url, source } of ordered) {
    if (!source) {
      skipped.push({ url, reason: "not an event page from a known source" });
      continue;
    }
    const known = idByUrl.get(url);
    if (known) {
      addToGroup(known, { input, url, source });
      continue;
    }
    const normalized = normalizeExtracted(input.extracted);
    if (!normalized.ok) {
      skipped.push({ url, reason: normalized.reason });
      continue;
    }
    // The same race listed on another source joins that race instead of creating a new one.
    const match = findMatch(candidates, source, normalized.race.name, normalized.race.date);
    if (match) {
      match.sources.add(source);
      idByUrl.set(url, match.id);
      addToGroup(match.id, { input, url, source });
      continue;
    }
    const newSlug = allocateSlug(SOURCES[source].slugOf(new URL(url)), takenSlugs);
    takenSlugs.add(newSlug);
    const id = newId();
    idByUrl.set(url, id);
    candidates.push({ id, name: normalized.race.name, date: normalized.race.date, sources: new Set([source]) });
    addToGroup(id, { input, url, source }, newSlug);
  }

  const planned = [...groups.values()];
  const existing = await Promise.all(
    planned.map(async ({ id }) => {
      if (!indexById.has(id)) return null;
      const text = await store.read(racePath(id));
      if (text === null) throw new Error(`${racePath(id)} is listed in ${INDEX_PATH} but missing`);
      return RaceSchema.parse(JSON.parse(text));
    }),
  );

  const files: Record<string, string> = {};
  const changes: RaceChange[] = [];
  const nextIndex = new Map(indexById);

  planned.forEach(({ id, newSlug, items }, i) => {
    const prev = existing[i] ?? null;
    const slug = prev?.slug ?? newSlug!;
    let sources = prev?.sources ?? [];
    const touched: RaceSource[] = [];
    for (const { input, url, source } of items) {
      const prevSource = sources.find((s) => s.name === source && s.url === url);
      const nextSource: RaceSource = {
        name: source,
        url,
        lastCheckedAt: input.checkedAt,
        lastChangedAt: prevSource?.lastChangedAt ?? input.checkedAt,
        rawExtracted: input.extracted,
      };
      if (!prevSource || !deepEqual(prevSource.rawExtracted, input.extracted)) touched.push(nextSource);
      sources = prevSource ? sources.map((s) => (s === prevSource ? nextSource : s)) : [...sources, nextSource];
    }

    const reconciled = reconcile(sources);
    if ("error" in reconciled) {
      for (const { url } of items) skipped.push({ url, reason: reconciled.error });
      return;
    }

    const canonical = prev ? stabilize(prev, reconciled.fields) : reconciled.fields;
    const fields = prev ? changedFields(prev, canonical) : [];
    const joined = prev ? sources.length !== prev.sources.length : false;
    if (prev && fields.length === 0 && !joined && prev.confidence === reconciled.confidence) return;
    for (const source of touched) source.lastChangedAt = source.lastCheckedAt;

    const record: Race = {
      id,
      slug,
      ...canonical,
      sources,
      confidence: reconciled.confidence,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    const valid = RaceSchema.safeParse(record);
    if (!valid.success) {
      const reason = `invalid record: ${valid.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`;
      for (const { url } of items) skipped.push({ url, reason });
      return;
    }

    files[racePath(id)] = serialize(record);
    changes.push({ id, slug, kind: prev ? "updated" : "added", fields, ...(joined && { joined: true }) });
    nextIndex.set(id, {
      id,
      slug,
      name: record.name,
      date: record.date,
      lastModified: now,
      sourceUrls: [...new Set(sources.map((s) => s.url))].sort(),
    });
  });

  if (changes.length > 0) {
    const sorted = [...nextIndex.values()].sort((a, b) => a.id.localeCompare(b.id));
    files[INDEX_PATH] = serialize(sorted);
  }
  return { files, changes, skipped };
}

function sourceRank(source: SourceName | null): number {
  return source ? SOURCE_PRIORITY.indexOf(source) : Number.POSITIVE_INFINITY;
}

/**
 * The race another source already has for this page: race day within a day
 * (multi-day events list different days), and a name that's mostly the same
 * ("Vũng Tàu City Trail 2026" vs "VungTau CityTrail 2026"). Best match wins.
 */
function findMatch(candidates: Candidate[], source: SourceName, name: string, date: string): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = MATCH_THRESHOLD;
  for (const c of candidates) {
    if (c.sources.has(source) || Math.abs(Date.parse(c.date) - Date.parse(date)) > 86_400_000) continue;
    const score = nameSimilarity(c.name, name);
    if (score >= bestScore) [best, bestScore] = [c, score];
  }
  return best;
}

const MATCH_THRESHOLD = 0.5;

/** Dice coefficient over character bigrams of the folded name, spaces removed. */
export function nameSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = foldVietnamese(s).replace(/\s+/g, "");
    const out = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  let total = 0;
  for (const n of ga.values()) total += n;
  for (const n of gb.values()) total += n;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return total === 0 ? 0 : (2 * shared) / total;
}

function dedupeByUrl(inputs: readonly SyncInput[], skipped: Skipped[]): SyncInput[] {
  const byUrl = new Map<string, SyncInput>();
  for (const input of inputs) {
    let url: string;
    try {
      url = canonicalSourceUrl(input.url);
    } catch {
      skipped.push({ url: input.url, reason: "invalid URL" });
      continue;
    }
    const seen = byUrl.get(url);
    if (!seen || seen.checkedAt <= input.checkedAt) byUrl.set(url, { ...input, url });
  }
  return [...byUrl.values()];
}

/** First free slug among base, base-2, base-3, ... */
function allocateSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function formatCommitMessage(plan: SyncPlan, context?: string): string {
  const added = plan.changes.filter((c) => c.kind === "added");
  const updated = plan.changes.filter((c) => c.kind === "updated");
  const counts = [added.length && `${added.length} added`, updated.length && `${updated.length} updated`].filter(Boolean);
  const lines = [
    `data: ${counts.join(", ")}`,
    "",
    ...added.map((c) => `+ ${c.slug} (${c.id})`),
    ...updated.map((c) => `~ ${c.slug}: ${[...(c.joined ? ["+source"] : []), ...c.fields].join(", ") || "confidence"}`),
  ];
  if (context) lines.push("", context);
  return lines.join("\n");
}

export type SyncResult = SyncPlan & { commitSha: string | null };

export type SyncOptions = {
  context?: string;
  dryRun?: boolean;
  now?: string;
  /**
   * Extra files for the same commit (e.g. the check log), computed against the
   * head being committed on so a retry merges with whatever landed meanwhile.
   */
  extraFiles?: (store: RaceStore) => Promise<Record<string, string>>;
  /** Commit message when only extra files changed. */
  bookkeepingMessage?: string;
};

/**
 * Plans against the branch head and commits every change as a single commit.
 * If the branch moves underneath us (a concurrent run), re-plans on the new
 * head and retries, so no update is lost and no empty commit is created.
 */
export async function syncToGitHub(target: GitHubTarget, inputs: readonly SyncInput[], opts: SyncOptions = {}): Promise<SyncResult> {
  const repo = new GitHubRepo(target);
  for (let attempt = 1; ; attempt++) {
    const head = await repo.headSha();
    const store = repo.storeAt(head);
    const plan = await planSync(store, inputs, opts.now);
    const extra = opts.extraFiles ? await opts.extraFiles(store) : {};
    const unchanged = plan.changes.length === 0 && Object.keys(extra).length === 0;
    if (unchanged || opts.dryRun) return { ...plan, commitSha: null };
    const message =
      plan.changes.length > 0 ? formatCommitMessage(plan, opts.context) : (opts.bookkeepingMessage ?? "state: update");
    try {
      const commitSha = await repo.commitFiles(head, { ...plan.files, ...extra }, message);
      return { ...plan, commitSha };
    } catch (err) {
      if (attempt >= 3 || !isNotFastForward(err)) throw err;
    }
  }
}

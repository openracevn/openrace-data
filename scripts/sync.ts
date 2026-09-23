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
import { SOURCE_PRIORITY, applyOverrides, reconcile } from "./lib/reconcile.ts";
import {
  INDEX_PATH,
  IndexSchema,
  RaceSchema,
  RACES_DIR,
  raceFileName,
  serialize,
  type CanonicalField,
  type IndexEntry,
  type Overrides,
  type Race,
  type RaceSource,
  type SourceName,
} from "./lib/schema.ts";
import { canonicalSourceUrl, slugFromName } from "./lib/slug.ts";
import { SOURCES, sourceForUrl } from "./lib/sources.ts";

export type SyncInput = {
  /** Source page URL the data was extracted from. */
  url: string;
  /** Raw extraction as returned by Firecrawl; stored verbatim as `rawExtracted`. */
  extracted: Record<string, unknown>;
  /** When the source was checked (ISO 8601). */
  checkedAt: string;
  /** Which source this is; defaults to the source the URL belongs to. openrace inputs may use any reference URL. */
  source?: SourceName;
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
  /** The slug (and file name) before a hand rename. */
  renamedFrom?: string;
  /** A page from another source joined this race. */
  joined?: boolean;
  /** Overridden fields whose source value changed (the override still wins). */
  shadowed?: CanonicalField[];
};
export type Skipped = { url: string; reason: string };

export type SyncPlan = {
  /** Repo path -> full new file contents, or null to delete it (a renamed race's old file). Empty when nothing changed. */
  files: Record<string, string | null>;
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
  const takenFiles = new Set(index.map((e) => e.file));
  const candidates: Candidate[] = index.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    sources: new Set<SourceName>(e.sourceUrls.map((u) => sourceForUrl(u)).filter((x) => x !== null)),
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
    .map((input) => ({ input, url: input.url, source: input.source ?? sourceForUrl(input.url) }))
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
    const base = source === "openrace" ? slugFromName(normalized.race.name) : SOURCES[source].slugOf(new URL(url));
    const newSlug = allocateSlug(base, normalized.race.date, takenSlugs, takenFiles);
    takenSlugs.add(newSlug);
    takenFiles.add(raceFileName(newSlug, normalized.race.date));
    const id = newId();
    idByUrl.set(url, id);
    candidates.push({ id, name: normalized.race.name, date: normalized.race.date, sources: new Set([source]) });
    addToGroup(id, { input, url, source }, newSlug);
  }

  const planned = [...groups.values()];
  const existing = await Promise.all(
    planned.map(async ({ id }) => {
      const entry = indexById.get(id);
      if (!entry) return null;
      return readRaceFile(store, entry);
    }),
  );

  const files: Record<string, string | null> = {};
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

    const composed = composeRace({ id, slug, prev, sources, overrides: prev?.overrides ?? {}, now, stabilizeAgainstPrev: true });
    if ("error" in composed) {
      for (const { url } of items) skipped.push({ url, reason: composed.error });
      return;
    }
    const { record, fields } = composed;
    const joined = prev ? sources.length !== prev.sources.length : false;
    const shadowed = prev ? shadowedChanges(prev, sources) : [];
    if (prev && fields.length === 0 && !joined && shadowed.length === 0 && prev.confidence === record.confidence) return;
    for (const source of touched) source.lastChangedAt = source.lastCheckedAt;

    const clash = writeRace(files, nextIndex, record);
    if (clash) {
      for (const { url } of items) skipped.push({ url, reason: clash });
      return;
    }
    changes.push({
      id,
      slug,
      kind: prev ? "updated" : "added",
      fields,
      ...(joined && { joined: true }),
      ...(shadowed.length > 0 && { shadowed }),
    });
  });

  if (changes.length > 0) files[INDEX_PATH] = serializeIndex(nextIndex);
  return { files, changes, skipped };
}

/**
 * Writes a race's file and index entry. The file name follows the slug and race
 * year, so a slug change or a move to another year renames it: the old file is
 * deleted in the same commit. Returns an error if another race has that file name.
 */
function writeRace(files: Record<string, string | null>, index: Map<string, IndexEntry>, record: Race): string | null {
  const entry = indexEntry(record);
  const owner = [...index.values()].find((e) => e.file === entry.file && e.id !== record.id);
  if (owner) return `file ${RACES_DIR}/${entry.file} is already used by ${owner.slug} (${owner.id})`;
  const prevFile = index.get(record.id)?.file;
  if (prevFile && prevFile !== entry.file) files[`${RACES_DIR}/${prevFile}`] = null;
  files[`${RACES_DIR}/${entry.file}`] = serialize(record);
  index.set(record.id, entry);
  return null;
}

function serializeIndex(index: Map<string, IndexEntry>): string {
  return serialize([...index.values()].sort((a, b) => a.id.localeCompare(b.id)));
}

async function readRaceFile(store: RaceStore, entry: IndexEntry): Promise<Race> {
  const path = `${RACES_DIR}/${entry.file}`;
  const text = await store.read(path);
  if (text === null) throw new Error(`${path} is listed in ${INDEX_PATH} but missing`);
  return RaceSchema.parse(JSON.parse(text));
}

type ComposeArgs = {
  id: string;
  slug: string;
  prev: Race | null;
  sources: RaceSource[];
  overrides: Overrides;
  now: string;
  /** Keep the previous wording of venue/organizer when a re-check only rewords it. */
  stabilizeAgainstPrev: boolean;
};

/** A race record from its sources (merged by priority) with OpenRace overrides on top, validated. */
function composeRace(a: ComposeArgs): { record: Race; fields: CanonicalField[] } | { error: string } {
  const reconciled = reconcile(a.sources);
  if ("error" in reconciled) return { error: reconciled.error };
  const derived = a.prev && a.stabilizeAgainstPrev ? stabilize(a.prev, reconciled.fields) : reconciled.fields;
  const canonical = applyOverrides(derived, a.overrides);
  const record: Race = {
    id: a.id,
    slug: a.slug,
    ...canonical,
    overrides: a.overrides,
    sources: a.sources,
    confidence: reconciled.confidence,
    createdAt: a.prev?.createdAt ?? a.now,
    updatedAt: a.now,
  };
  const valid = RaceSchema.safeParse(record);
  if (!valid.success) {
    return { error: `invalid record: ${valid.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}` };
  }
  return { record, fields: a.prev ? changedFields(a.prev, canonical) : [] };
}

/** Overridden fields whose value, as the sources alone would give it, differs between the old and new sources. */
function shadowedChanges(prev: Race, sources: RaceSource[]): CanonicalField[] {
  const fields = Object.keys(prev.overrides) as CanonicalField[];
  if (fields.length === 0) return [];
  const before = reconcile(prev.sources);
  const after = reconcile(sources);
  if ("error" in before || "error" in after) return [];
  return fields.filter((f) => !deepEqual(before.fields[f], after.fields[f]));
}

function indexEntry(record: Race): IndexEntry {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    date: record.date,
    lastModified: record.updatedAt,
    file: raceFileName(record.slug, record.date),
    sourceUrls: [...new Set(record.sources.map((s) => s.url))].sort(),
  };
}

export type Edit =
  | { kind: "set"; field: CanonicalField; value: unknown; reason: string }
  | { kind: "unset"; field: CanonicalField };

/**
 * Set or remove an OpenRace override on one race (found by id or slug). Setting a
 * value equal to the current one still records the override, so later source
 * changes can't move it.
 */
export async function planEdit(store: RaceStore, race: string, edits: readonly Edit[], now = new Date().toISOString()): Promise<SyncPlan> {
  const { index, prev } = await readRace(store, race);

  const overrides: Overrides = { ...prev.overrides };
  for (const edit of edits) {
    if (edit.kind === "set") overrides[edit.field] = { value: edit.value, reason: edit.reason, at: now };
    else if (overrides[edit.field]) delete overrides[edit.field];
    else throw new Error(`${prev.slug} has no override on ${edit.field}`);
  }

  const composed = composeRace({ id: prev.id, slug: prev.slug, prev, sources: prev.sources, overrides, now, stabilizeAgainstPrev: false });
  if ("error" in composed) throw new Error(composed.error);
  const { record, fields } = composed;
  if (deepEqual(record.overrides, prev.overrides) && fields.length === 0) return { files: {}, changes: [], skipped: [] };

  const files: Record<string, string | null> = {};
  const nextIndex = new Map(index.map((e) => [e.id, e]));
  const clash = writeRace(files, nextIndex, record);
  if (clash) throw new Error(clash);
  files[INDEX_PATH] = serializeIndex(nextIndex);
  return {
    files,
    changes: [{ id: record.id, slug: record.slug, kind: "updated", fields }],
    skipped: [],
  };
}

/**
 * Give a race (found by id or slug) a new slug: its file moves to the new name and
 * the index follows, in one change. The id stays, so the API updates the same race.
 * Ingestion never changes a slug; this is the only way it moves.
 */
export async function planRename(store: RaceStore, race: string, newSlug: string, now = new Date().toISOString()): Promise<SyncPlan> {
  const { index, prev } = await readRace(store, race);
  if (newSlug === prev.slug) return { files: {}, changes: [], skipped: [] };
  const owner = index.find((e) => e.slug === newSlug);
  if (owner) throw new Error(`slug "${newSlug}" is already used by ${owner.id}`);
  const record: Race = { ...prev, slug: newSlug, updatedAt: now };
  const valid = RaceSchema.safeParse(record);
  if (!valid.success) throw new Error(`invalid slug "${newSlug}": ${valid.error.issues.map((e) => e.message).join("; ")}`);

  const files: Record<string, string | null> = {};
  const nextIndex = new Map(index.map((e) => [e.id, e]));
  const clash = writeRace(files, nextIndex, record);
  if (clash) throw new Error(clash);
  files[INDEX_PATH] = serializeIndex(nextIndex);
  return {
    files,
    changes: [{ id: record.id, slug: newSlug, kind: "updated", fields: [], renamedFrom: prev.slug }],
    skipped: [],
  };
}

async function readRace(store: RaceStore, race: string): Promise<{ index: IndexEntry[]; prev: Race }> {
  const indexText = await store.read(INDEX_PATH);
  const index: IndexEntry[] = indexText ? IndexSchema.parse(JSON.parse(indexText)) : [];
  const entry = index.find((e) => e.id === race || e.slug === race || e.file === race || e.file === `${race}.json`);
  if (!entry) throw new Error(`no race with id, slug or file name "${race}"`);
  return { index, prev: await readRaceFile(store, entry) };
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

/** First slug among base, base-2, base-3, ... that is free, and whose file name is free too. */
function allocateSlug(base: string, date: string, takenSlugs: ReadonlySet<string>, takenFiles: ReadonlySet<string>): string {
  const free = (slug: string) => !takenSlugs.has(slug) && !takenFiles.has(raceFileName(slug, date));
  if (free(base)) return base;
  for (let n = 2; ; n++) if (free(`${base}-${n}`)) return `${base}-${n}`;
}

export function formatCommitMessage(plan: SyncPlan, context?: string): string {
  const added = plan.changes.filter((c) => c.kind === "added");
  const updated = plan.changes.filter((c) => c.kind === "updated");
  const counts = [added.length && `${added.length} added`, updated.length && `${updated.length} updated`].filter(Boolean);
  const lines = [
    `data: ${counts.join(", ")}`,
    "",
    ...added.map((c) => `+ ${c.slug} (${c.id})`),
    ...updated.map(
      (c) =>
        `~ ${c.slug}: ${[...(c.renamedFrom ? [`slug (was ${c.renamedFrom})`] : []), ...(c.joined ? ["+source"] : []), ...c.fields, ...(c.shadowed ?? []).map((f) => `${f} changed at the source (override kept)`)].join(", ") || "confidence"}`,
    ),
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
  /** Full commit message, instead of the generated one. */
  message?: string;
};

/** Extract inputs → one commit on the branch head (see commitToGitHub). */
export async function syncToGitHub(target: GitHubTarget, inputs: readonly SyncInput[], opts: SyncOptions = {}): Promise<SyncResult> {
  return commitToGitHub(target, (store) => planSync(store, inputs, opts.now), opts);
}

/**
 * Plans against the branch head and commits the plan's files as a single commit.
 * If the branch moves underneath us (a concurrent run), re-plans on the new head
 * and retries, so no update is lost and no empty commit is created.
 */
export async function commitToGitHub(
  target: GitHubTarget,
  planAt: (store: RaceStore) => Promise<SyncPlan>,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const repo = new GitHubRepo(target);
  for (let attempt = 1; ; attempt++) {
    const head = await repo.headSha();
    const store = repo.storeAt(head);
    const plan = await planAt(store);
    const extra = opts.extraFiles ? await opts.extraFiles(store) : {};
    const unchanged = plan.changes.length === 0 && Object.keys(extra).length === 0;
    if (unchanged || opts.dryRun) return { ...plan, commitSha: null };
    const message =
      opts.message ?? (plan.changes.length > 0 ? formatCommitMessage(plan, opts.context) : (opts.bookkeepingMessage ?? "state: update"));
    try {
      const commitSha = await repo.commitFiles(head, { ...plan.files, ...extra }, message);
      return { ...plan, commitSha };
    } catch (err) {
      if (attempt >= 3 || !isNotFastForward(err)) throw err;
    }
  }
}

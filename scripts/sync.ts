/**
 * Diff/commit core. Given what sources said about races, works out which race
 * files (and the index, series and organizers) must change, then commits all of it
 * to GitHub as one commit. Pure planning (`planSync`) is separated from I/O so it
 * can be tested and reused by the checker (`check.ts`), hand edits and the CLI.
 */
import { changedFields, deepEqual, stabilize } from "./lib/diff.ts";
import { GitHubRepo, isNotFastForward, type GitHubTarget } from "./lib/github.ts";
import { normalizeExtraction } from "./lib/extraction.ts";
import { applyOverrides, isEntityRef, reconcile, type EntityRef, type StoredExtraction } from "./lib/reconcile.ts";
import {
  INDEX_PATH,
  IndexSchema,
  ORGANIZERS_PATH,
  OrganizerListSchema,
  RaceSchema,
  RACES_DIR,
  SERIES_PATH,
  SeriesListSchema,
  raceFileName,
  serialize,
  type CanonicalField,
  type IndexEntry,
  type Organizer,
  type Overrides,
  type Race,
  type RaceSource,
  type Series,
  type SourceRole,
} from "./lib/schema.ts";
import { inferSeries } from "./lib/series.ts";
import { siteForUrl, type SitesConfig } from "./lib/sites.ts";
import { canonicalSourceUrl, slugFromName } from "./lib/slug.ts";
import { foldVietnamese } from "./lib/text.ts";

export type SyncInput = {
  /** Source page URL (canonicalized here). */
  url: string;
  /** Site key from config/sites.yaml, or "openrace" for a race entered by hand. */
  site: string;
  role: SourceRole;
  /** What the source said, stored verbatim as the source's `extracted`. */
  extracted: StoredExtraction;
  /** When the source was read (ISO 8601). */
  checkedAt: string;
  /** Slug for a new race (e.g. ActiUp's own slug); default: from the name. */
  slugHint?: string;
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
  /** Sites whose pages joined this race in this change. */
  joined?: string[];
  /** Flags raised in this change (see Race.flags). */
  newFlags?: string[];
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

/** Races further apart than this are different editions, even on the same page (an official site serves a new edition every year). */
export const EDITION_DAYS = 180;
/** A page linked from a race (or linking to it) is that race when race days are this close. */
const LINK_MATCH_DAYS = 7;
const MATCH_THRESHOLD = 0.5;
const DAY_MS = 86_400_000;

type Item = { input: SyncInput; date: string; name: string };
type Group = { id: string; newSlug?: string; items: Item[] };
/** What matching needs to know about a race: known ones from the index, plus races created in this run. */
type Candidate = { id: string; name: string; date: string; sites: Set<string>; sourceUrls: Set<string>; linkUrls: Set<string> };

export async function planSync(
  store: RaceStore,
  inputs: readonly SyncInput[],
  config: SitesConfig,
  now = new Date().toISOString(),
  newId: () => string = () => crypto.randomUUID(),
): Promise<SyncPlan> {
  const index = await readIndex(store);
  const indexById = new Map(index.map((e) => [e.id, e]));
  const takenSlugs = new Set(index.map((e) => e.slug));
  const takenFiles = new Set(index.map((e) => e.file));
  const candidates: Candidate[] = index.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    sites: new Set(e.sourceUrls.map((u) => siteForUrl(config, u)?.key ?? "openrace")),
    sourceUrls: new Set(e.sourceUrls),
    linkUrls: new Set(e.linkUrls),
  }));
  const loadRace = async (id: string): Promise<Race | null> => {
    const entry = indexById.get(id);
    return entry ? readRaceFile(store, entry) : null;
  };

  const skipped: Skipped[] = [];
  const groups = new Map<string, Group>();
  const addToGroup = (id: string, item: Item, newSlug?: string) => {
    const group = groups.get(id) ?? { id, newSlug, items: [] };
    group.items.push(item);
    groups.set(id, group);
  };

  // Official sites first, so their page creates the race that seller pages then join.
  const rank: Record<SourceRole, number> = { official: 0, seller: 1, reference: 2 };
  const ordered = dedupeByUrl(inputs, skipped).sort((a, b) => rank[a.role] - rank[b.role]);

  for (const input of ordered) {
    const normalized = normalizeExtraction(input.extracted);
    if (!normalized.ok) {
      skipped.push({ url: input.url, reason: normalized.reason });
      continue;
    }
    const { name, date } = normalized.facts;
    const item: Item = { input, date, name };
    const links = new Set(
      (input.extracted.links ?? []).flatMap((l) => {
        try {
          return [canonicalSourceUrl(l.url)];
        } catch {
          return [];
        }
      }),
    );
    const match =
      // 1. The same page, same edition.
      nearest(candidates.filter((c) => c.sourceUrls.has(input.url)), date, EDITION_DAYS) ??
      // 2. A page this one links to, or that links to this one.
      nearest(
        candidates.filter((c) => c.linkUrls.has(input.url) || [...c.sourceUrls].some((u) => links.has(u))),
        date,
        LINK_MATCH_DAYS,
      ) ??
      // 3. Another site's page for a race with nearly the same name on the same day.
      findByName(candidates, input.site, name, date);
    if (match) {
      match.sites.add(input.site);
      match.sourceUrls.add(input.url);
      addToGroup(match.id, item);
      continue;
    }
    const newSlug = allocateSlug(input.slugHint ?? slugFromName(name), date, takenSlugs, takenFiles);
    takenSlugs.add(newSlug);
    takenFiles.add(raceFileName(newSlug, date));
    const id = newId();
    candidates.push({ id, name, date, sites: new Set([input.site]), sourceUrls: new Set([input.url]), linkUrls: links });
    addToGroup(id, item, newSlug);
  }

  const files: Record<string, string | null> = {};
  const changes: RaceChange[] = [];
  const nextIndex = new Map(indexById);

  // Series across all races (known and new), from their slugs; see lib/series.ts.
  const inferred = inferSeries([
    ...index.filter((e) => !groups.has(e.id)).map((e) => ({ id: e.id, slug: e.slug, name: e.name, date: e.date })),
    ...[...groups.values()].map((g) => {
      const last = g.items.at(-1)!;
      return { id: g.id, slug: indexById.get(g.id)?.slug ?? g.newSlug!, name: last.name, date: last.date };
    }),
  ]);
  const seriesRefs: StoredExtraction[] = [];

  for (const { id, newSlug, items } of groups.values()) {
    const prev = await loadRace(id);
    const slug = prev?.slug ?? newSlug!;
    let sources = prev?.sources ?? [];
    const touched: RaceSource[] = [];
    const joined: string[] = [];
    for (const { input } of items) {
      const prevSource = sources.find((s) => s.site === input.site && s.url === input.url);
      const nextSource: RaceSource = {
        site: input.site,
        role: input.role,
        url: input.url,
        lastCheckedAt: input.checkedAt,
        lastChangedAt: prevSource?.lastChangedAt ?? input.checkedAt,
        extracted: input.extracted,
      };
      if (!prevSource || !deepEqual(prevSource.extracted, input.extracted) || prevSource.role !== input.role) touched.push(nextSource);
      if (!prevSource && prev) joined.push(input.site);
      sources = prevSource ? sources.map((s) => (s === prevSource ? nextSource : s)) : [...sources, nextSource];
    }

    const composed = composeRace({ id, slug, prev, sources, overrides: prev?.overrides ?? {}, now, config, stabilizeAgainstPrev: true, series: inferred.get(id) });
    if ("error" in composed) {
      for (const { input } of items) skipped.push({ url: input.url, reason: composed.error });
      continue;
    }
    const { record, fields } = composed;
    const newFlags = record.flags.filter((f) => !prev?.flags.includes(f));
    const shadowed = prev ? shadowedChanges(prev, sources, config) : [];
    const flagsChanged = prev ? !deepEqual(prev.flags, record.flags) : false;
    if (prev && fields.length === 0 && joined.length === 0 && shadowed.length === 0 && !flagsChanged && prev.confidence === record.confidence) continue;
    for (const source of touched) source.lastChangedAt = source.lastCheckedAt;

    const clash = writeRace(files, nextIndex, record);
    if (clash) {
      for (const { input } of items) skipped.push({ url: input.url, reason: clash });
      continue;
    }
    changes.push({
      id,
      slug,
      kind: prev ? "updated" : "added",
      fields,
      ...(joined.length > 0 && { joined }),
      ...(newFlags.length > 0 && { newFlags }),
      ...(shadowed.length > 0 && { shadowed }),
    });
    seriesRefs.push(...seriesEntity(record, inferred.get(id)));
  }

  // Earlier editions join a series when a new edition appears (or leave one).
  for (const entry of index) {
    if (groups.has(entry.id) || (inferred.get(entry.id)?.id ?? null) === entry.seriesId) continue;
    const prev = (await loadRace(entry.id))!;
    const composed = composeRace({ id: entry.id, slug: prev.slug, prev, sources: prev.sources, overrides: prev.overrides, now, config, stabilizeAgainstPrev: true, series: inferred.get(entry.id) });
    if ("error" in composed || composed.fields.length === 0) continue; // a site's own series wins
    if (writeRace(files, nextIndex, composed.record)) continue;
    changes.push({ id: entry.id, slug: prev.slug, kind: "updated", fields: composed.fields });
    seriesRefs.push(...seriesEntity(composed.record, inferred.get(entry.id)));
  }

  if (changes.length > 0) {
    files[INDEX_PATH] = serializeIndex(nextIndex);
    Object.assign(files, await plannedEntities(store, [...[...groups.values()].flatMap((g) => g.items.map((i) => i.input.extracted)), ...seriesRefs]));
  }
  return { files, changes, skipped };
}

/** The series entry for a race whose series was inferred (not named by its site), with the race's organizer. */
function seriesEntity(record: Race, inferred: EntityRef | undefined): StoredExtraction[] {
  if (!inferred || record.seriesId !== inferred.id) return [];
  return [{ series: inferred, ...(record.organizerId && record.organizer && { organizer: { id: record.organizerId, name: record.organizer } }) }];
}

/**
 * New series and organizers named by this run's sources. Entries are only added,
 * never changed: a name or website fixed by hand in series.json stays.
 */
async function plannedEntities(store: RaceStore, extractions: StoredExtraction[]): Promise<Record<string, string>> {
  const series = SeriesListSchema.parse(JSON.parse((await store.read(SERIES_PATH)) ?? "[]"));
  const organizers = OrganizerListSchema.parse(JSON.parse((await store.read(ORGANIZERS_PATH)) ?? "[]"));
  const out: Record<string, string> = {};
  const add = <T extends { id: string }>(list: T[], ref: EntityRef | undefined, make: (r: EntityRef) => T): boolean => {
    if (!isEntityRef(ref) || list.some((e) => e.id === ref.id)) return false;
    list.push(make(ref));
    return true;
  };
  let seriesChanged = false;
  let organizersChanged = false;
  for (const x of extractions) {
    organizersChanged = add<Organizer>(organizers, x.organizer, (r) => ({ id: r.id, name: r.name, website: r.website ?? null })) || organizersChanged;
    seriesChanged =
      add<Series>(series, x.series, (r) => ({ id: r.id, name: r.name, website: r.website ?? null, organizerId: isEntityRef(x.organizer) ? x.organizer.id : null })) ||
      seriesChanged;
  }
  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  if (seriesChanged) out[SERIES_PATH] = serialize(series.sort(byId));
  if (organizersChanged) out[ORGANIZERS_PATH] = serialize(organizers.sort(byId));
  return out;
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

async function readIndex(store: RaceStore): Promise<IndexEntry[]> {
  const text = await store.read(INDEX_PATH);
  return text ? IndexSchema.parse(JSON.parse(text)) : [];
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
  config: SitesConfig;
  /** Keep the previous wording of venue/city/organizer when a re-read only rewords it. */
  stabilizeAgainstPrev: boolean;
  /** The series found from the races' slugs; used when no source names one. */
  series?: EntityRef;
};

/** A race record from its sources, with OpenRace overrides on top, validated. */
function composeRace(a: ComposeArgs): { record: Race; fields: CanonicalField[] } | { error: string } {
  const reconciled = reconcile(a.sources, a.config);
  if ("error" in reconciled) return { error: reconciled.error };
  const fields = { ...reconciled.fields, seriesId: reconciled.fields.seriesId ?? a.series?.id ?? null };
  const derived = a.prev && a.stabilizeAgainstPrev ? stabilize(a.prev, fields) : fields;
  const canonical = applyOverrides(derived, a.overrides);
  const record: Race = {
    id: a.id,
    slug: a.slug,
    ...canonical,
    flags: reconciled.flags,
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
  return { record: valid.data, fields: a.prev ? changedFields(a.prev, canonical) : [] };
}

/** Overridden fields whose value, as the sources alone would give it, differs between the old and new sources. */
function shadowedChanges(prev: Race, sources: RaceSource[], config: SitesConfig): CanonicalField[] {
  const fields = Object.keys(prev.overrides) as CanonicalField[];
  if (fields.length === 0) return [];
  const before = reconcile(prev.sources, config);
  const after = reconcile(sources, config);
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
    seriesId: record.seriesId,
    sourceUrls: [...new Set(record.sources.map((s) => s.url))].sort(),
    linkUrls: [...new Set(record.links.filter((l) => l.kind === "official" || l.kind === "seller").map((l) => l.url))].sort(),
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
export async function planEdit(store: RaceStore, race: string, edits: readonly Edit[], config: SitesConfig, now = new Date().toISOString()): Promise<SyncPlan> {
  const { index, prev } = await readRace(store, race);

  const overrides: Overrides = { ...prev.overrides };
  for (const edit of edits) {
    if (edit.kind === "set") overrides[edit.field] = { value: edit.value, reason: edit.reason, at: now };
    else if (overrides[edit.field]) delete overrides[edit.field];
    else throw new Error(`${prev.slug} has no override on ${edit.field}`);
  }

  const series = inferSeries(index.map((e) => ({ id: e.id, slug: e.slug, name: e.name, date: e.date }))).get(prev.id);
  const composed = composeRace({ id: prev.id, slug: prev.slug, prev, sources: prev.sources, overrides, now, config, stabilizeAgainstPrev: false, series });
  if ("error" in composed) throw new Error(composed.error);
  const { record, fields } = composed;
  if (deepEqual(record.overrides, prev.overrides) && fields.length === 0) return { files: {}, changes: [], skipped: [] };

  const files: Record<string, string | null> = {};
  const nextIndex = new Map(index.map((e) => [e.id, e]));
  const clash = writeRace(files, nextIndex, record);
  if (clash) throw new Error(clash);
  files[INDEX_PATH] = serializeIndex(nextIndex);
  return { files, changes: [{ id: record.id, slug: record.slug, kind: "updated", fields }], skipped: [] };
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
  return { files, changes: [{ id: record.id, slug: newSlug, kind: "updated", fields: [], renamedFrom: prev.slug }], skipped: [] };
}

async function readRace(store: RaceStore, race: string): Promise<{ index: IndexEntry[]; prev: Race }> {
  const index = await readIndex(store);
  const entry = index.find((e) => e.id === race || e.slug === race || e.file === race || e.file === `${race}.json`);
  if (!entry) throw new Error(`no race with id, slug or file name "${race}"`);
  return { index, prev: await readRaceFile(store, entry) };
}

/** The candidate with the closest race day, if within `maxDays`. */
function nearest(candidates: Candidate[], date: string, maxDays: number): Candidate | null {
  let best: Candidate | null = null;
  let bestGap = maxDays * DAY_MS;
  for (const c of candidates) {
    const gap = Math.abs(Date.parse(c.date) - Date.parse(date));
    if (gap <= bestGap) [best, bestGap] = [c, gap];
  }
  return best;
}

/**
 * The race another site already has for this page: race day within a day
 * (multi-day events list different days), and a name that's mostly the same
 * ("Vũng Tàu City Trail 2026" vs "VungTau CityTrail 2026"). Best match wins.
 */
function findByName(candidates: Candidate[], site: string, name: string, date: string): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = MATCH_THRESHOLD;
  for (const c of candidates) {
    if (c.sites.has(site) || Math.abs(Date.parse(c.date) - Date.parse(date)) > DAY_MS) continue;
    const score = nameSimilarity(c.name, name);
    if (score >= bestScore) [best, bestScore] = [c, score];
  }
  return best;
}

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
  const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 100).replace(/^-+|-+$/g, "") || "race";
  const free = (slug: string) => !takenSlugs.has(slug) && !takenFiles.has(raceFileName(slug, date));
  if (free(clean)) return clean;
  for (let n = 2; ; n++) if (free(`${clean}-${n}`)) return `${clean}-${n}`;
}

export function formatCommitMessage(plan: SyncPlan, context?: string): string {
  const added = plan.changes.filter((c) => c.kind === "added");
  const updated = plan.changes.filter((c) => c.kind === "updated");
  const counts = [added.length && `${added.length} added`, updated.length && `${updated.length} updated`].filter(Boolean);
  const lines = [
    `data: ${counts.join(", ")}`,
    "",
    ...added.map((c) => `+ ${c.slug} (${c.id})${c.newFlags ? ` ⚠️ ${c.newFlags.join("; ")}` : ""}`),
    ...updated.map((c) => {
      const parts = [
        ...(c.renamedFrom ? [`slug (was ${c.renamedFrom})`] : []),
        ...(c.joined ?? []).map((s) => `+${s}`),
        ...c.fields,
        ...(c.shadowed ?? []).map((f) => `${f} changed at the source (override kept)`),
        ...(c.newFlags ?? []).map((f) => `⚠️ ${f}`),
      ];
      return `~ ${c.slug}: ${parts.join(", ") || "sources/metadata"}`;
    }),
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

/** Source inputs → one commit on the branch head (see commitToGitHub). */
export async function syncToGitHub(target: GitHubTarget, inputs: readonly SyncInput[], config: SitesConfig, opts: SyncOptions = {}): Promise<SyncResult> {
  return commitToGitHub(target, (store) => planSync(store, inputs, config, opts.now), opts);
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

/**
 * Diff/commit core. Given freshly extracted race data, works out which race
 * files (and the index) must change, then commits all of it to GitHub as one
 * commit. Pure planning (`planSync`) is separated from I/O so it can be tested
 * and reused by both the ingestion Worker and the local CLI.
 */
import { changedFields, stabilize } from "./lib/diff.ts";
import { GitHubRepo, isNotFastForward, type GitHubTarget } from "./lib/github.ts";
import { normalizeExtracted } from "./lib/extraction.ts";
import { reconcile } from "./lib/reconcile.ts";
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
import { canonicalSourceUrl, raceSlug } from "./lib/slug.ts";
import { sourceForUrl } from "./lib/sources.ts";

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

export type RaceChange = { id: string; kind: "added" | "updated"; fields: CanonicalField[] };
export type Skipped = { url: string; reason: string };

export type SyncPlan = {
  /** Repo path -> full new file contents. Empty when nothing changed. */
  files: Record<string, string>;
  changes: RaceChange[];
  skipped: Skipped[];
};

type Prepared = { input: SyncInput; url: string; source: SourceName; id: string };

export async function planSync(store: RaceStore, inputs: readonly SyncInput[], now = new Date().toISOString()): Promise<SyncPlan> {
  const indexText = await store.read(INDEX_PATH);
  const index: IndexEntry[] = indexText ? IndexSchema.parse(JSON.parse(indexText)) : [];
  const indexById = new Map(index.map((e) => [e.id, e]));
  const idByUrl = new Map(index.flatMap((e) => e.sourceUrls.map((u) => [u, e.id] as const)));

  const skipped: Skipped[] = [];
  const prepared: Prepared[] = [];

  for (const input of dedupeByUrl(inputs, skipped)) {
    const url = input.url;
    const source = sourceForUrl(url);
    if (!source) {
      skipped.push({ url, reason: "not an event page from a known source" });
      continue;
    }
    let id = idByUrl.get(url);
    if (!id) {
      const normalized = normalizeExtracted(input.extracted);
      if (!normalized.ok) {
        skipped.push({ url, reason: normalized.reason });
        continue;
      }
      id = allocateId(raceSlug(normalized.race.name, normalized.race.date), indexById, idByUrl);
      idByUrl.set(url, id);
    }
    prepared.push({ input, url, source, id });
  }

  const existing = await Promise.all(
    prepared.map(async ({ id }) => {
      if (!indexById.has(id)) return null;
      const text = await store.read(racePath(id));
      if (text === null) throw new Error(`${racePath(id)} is listed in ${INDEX_PATH} but missing`);
      return RaceSchema.parse(JSON.parse(text));
    }),
  );

  const files: Record<string, string> = {};
  const changes: RaceChange[] = [];
  const nextIndex = new Map(indexById);

  prepared.forEach(({ input, url, source, id }, i) => {
    const prev = existing[i] ?? null;
    const prevSources = prev?.sources ?? [];
    const prevSource = prevSources.find((s) => s.name === source && s.url === url);

    const nextSource: RaceSource = {
      name: source,
      url,
      lastCheckedAt: input.checkedAt,
      lastChangedAt: prevSource?.lastChangedAt ?? input.checkedAt,
      rawExtracted: input.extracted,
    };
    const sources = prevSource
      ? prevSources.map((s) => (s === prevSource ? nextSource : s))
      : [...prevSources, nextSource];

    const reconciled = reconcile(sources);
    if ("error" in reconciled) {
      skipped.push({ url, reason: reconciled.error });
      return;
    }

    const canonical = prev ? stabilize(prev, reconciled.fields) : reconciled.fields;
    const fields = prev ? changedFields(prev, canonical) : [];
    if (prev && fields.length === 0 && prev.confidence === reconciled.confidence) return;
    nextSource.lastChangedAt = input.checkedAt;

    const record: Race = {
      id,
      ...canonical,
      sources,
      confidence: reconciled.confidence,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    const valid = RaceSchema.safeParse(record);
    if (!valid.success) {
      skipped.push({ url, reason: `invalid record: ${valid.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}` });
      return;
    }

    files[racePath(id)] = serialize(record);
    changes.push({ id, kind: prev ? "updated" : "added", fields });
    const urls = new Set([...(nextIndex.get(id)?.sourceUrls ?? []), url]);
    nextIndex.set(id, { id, lastModified: now, sourceUrls: [...urls].sort() });
  });

  if (changes.length > 0) {
    const sorted = [...nextIndex.values()].sort((a, b) => a.id.localeCompare(b.id));
    files[INDEX_PATH] = serialize(sorted);
  }
  return { files, changes, skipped };
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
function allocateId(base: string, indexById: Map<string, IndexEntry>, idByUrl: Map<string, string>): string {
  const taken = new Set([...indexById.keys(), ...idByUrl.values()]);
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
    ...added.map((c) => `+ ${c.id}`),
    ...updated.map((c) => `~ ${c.id}: ${c.fields.join(", ") || "confidence"}`),
  ];
  if (context) lines.push("", context);
  return lines.join("\n");
}

export type SyncResult = SyncPlan & { commitSha: string | null };

/**
 * Plans against the branch head and commits every change as a single commit.
 * If the branch moves underneath us (concurrent delivery), re-plans on the new
 * head and retries, so no update is lost and no empty commit is created.
 */
export async function syncToGitHub(
  target: GitHubTarget,
  inputs: readonly SyncInput[],
  opts: { context?: string; dryRun?: boolean; now?: string } = {},
): Promise<SyncResult> {
  const repo = new GitHubRepo(target);
  for (let attempt = 1; ; attempt++) {
    const head = await repo.headSha();
    const plan = await planSync(repo.storeAt(head), inputs, opts.now);
    if (plan.changes.length === 0 || opts.dryRun) return { ...plan, commitSha: null };
    try {
      const commitSha = await repo.commitFiles(head, plan.files, formatCommitMessage(plan, opts.context));
      return { ...plan, commitSha };
    } catch (err) {
      if (attempt >= 3 || !isNotFastForward(err)) throw err;
    }
  }
}

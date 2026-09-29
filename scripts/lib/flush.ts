/**
 * Apply staged bundles as ONE batch (plan 019): each bundle is planned on top of the ones
 * accepted before it, validated in a temporary tree, and left out (not blocking the rest)
 * if planning or validation fails. The accepted plan is committed once by scripts/flush.ts.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_FIELDS, INDEX_PATH, IndexSchema, type CanonicalField } from "./schema.ts";
import { isWaybackUrl, siteForUrl, siteKeyForUrl, type SitesConfig } from "./sites.ts";
import { canonicalSourceUrl } from "./slug.ts";
import type { Bundle, Op } from "./staging.ts";
import { manualGeo } from "./geocode.ts";
import { planEdit, planSync, type Edit, type RaceChange, type RaceStore, type SyncInput, type SyncPlan } from "../sync.ts";

/** Repo files as a base store plus files written on top (null = deleted). */
export function overlayStore(base: RaceStore, files: Readonly<Record<string, string | null>>): RaceStore {
  return {
    read: async (path) => (Object.hasOwn(files, path) ? files[path]! : base.read(path)),
  };
}

/** Turns one staged operation into sync inputs or edits; throws a plain message when it can't. */
async function planOp(store: RaceStore, op: Op, config: SitesConfig, now: string): Promise<SyncPlan> {
  if (op.op === "set-many") {
    const unknown = Object.keys(op.fields).filter((f) => !(CANONICAL_FIELDS as readonly string[]).includes(f));
    if (unknown.length) throw new Error(`set-many ${op.race}: unknown field(s) ${unknown.join(", ")}`);
    const edits: Edit[] = [];
    for (const [field, value] of Object.entries(op.fields)) {
      edits.push({ kind: "set", field: field as CanonicalField, value: field === "geo" ? await geoValue(value) : value, reason: op.reason });
    }
    return planEdit(store, op.race, edits, config, now);
  }
  if (op.op === "add") {
    const reference = canonicalSourceUrl(op.url);
    const site = siteForUrl(config, reference);
    if (site && site.recipe !== "none" && !isWaybackUrl(reference)) {
      throw new Error(`${reference} is on ${site.key}, which is read automatically; use npm run check -- --race <url>`);
    }
    let matchId: string | undefined;
    if (op.attachTo) {
      const index = IndexSchema.parse(JSON.parse((await store.read(INDEX_PATH)) ?? "[]"));
      const target = index.find((e) => e.id === op.attachTo || e.slug === op.attachTo);
      if (!target) throw new Error(`attachTo "${op.attachTo}" matches no race`);
      matchId = target.id;
    }
    const input: SyncInput = {
      url: reference,
      site: siteKeyForUrl(config, reference),
      role: "reference",
      extracted: { facts: { ...op.fields, note: op.reason } },
      checkedAt: now,
      ...(matchId && { matchId }),
    };
    return planSync(store, [input], config, now);
  }
  const { input } = op;
  return planSync(store, [{ ...input, url: canonicalSourceUrl(input.url) }], config, now);
}

async function geoValue(value: unknown): Promise<unknown> {
  const p = value as { lat?: unknown; lng?: unknown } | null;
  if (typeof p?.lat !== "number" || typeof p?.lng !== "number") throw new Error("geo must be an object with numeric lat and lng");
  return manualGeo(p.lat, p.lng);
}

/** One bundle, its operations applied in order, each on top of the last. */
export async function planBundle(store: RaceStore, bundle: Bundle, config: SitesConfig, now: string): Promise<SyncPlan> {
  const files: Record<string, string | null> = {};
  const changes: RaceChange[] = [];
  const skipped: SyncPlan["skipped"] = [];
  for (const [i, op] of bundle.ops.entries()) {
    let plan: SyncPlan;
    try {
      plan = await planOp(overlayStore(store, files), op, config, now);
    } catch (err) {
      throw new Error(`op ${i + 1} (${op.op}): ${(err as Error).message}`);
    }
    Object.assign(files, plan.files);
    changes.push(...plan.changes);
    skipped.push(...plan.skipped);
  }
  // A planSync skip (a page that matched nothing usable) means the bundle didn't do what it says.
  if (skipped.length) throw new Error(skipped.map((s) => `${s.url}: ${s.reason}`).join("; "));
  return { files, changes: mergeChanges(changes), skipped };
}

/** Same race touched twice (added, then edited): one entry with the union of fields. */
export function mergeChanges(changes: readonly RaceChange[]): RaceChange[] {
  const byId = new Map<string, RaceChange>();
  for (const c of changes) {
    const prev = byId.get(c.id);
    if (!prev) {
      byId.set(c.id, { ...c, fields: [...c.fields] });
      continue;
    }
    prev.fields = [...new Set([...prev.fields, ...c.fields])];
    prev.slug = c.slug;
    prev.joined = [...new Set([...(prev.joined ?? []), ...(c.joined ?? [])])];
    prev.newFlags = [...new Set([...(prev.newFlags ?? []), ...(c.newFlags ?? [])])];
    prev.shadowed = [...new Set([...(prev.shadowed ?? []), ...(c.shadowed ?? [])])];
    if (c.dupWarning) prev.dupWarning = c.dupWarning;
    if (c.renamedFrom) prev.renamedFrom = c.renamedFrom;
  }
  return [...byId.values()].map((c) => {
    const { joined, newFlags, shadowed, ...rest } = c;
    return { ...rest, ...(joined?.length && { joined }), ...(newFlags?.length && { newFlags }), ...(shadowed?.length && { shadowed }) };
  });
}

/** Errors from validating `files` on top of the base tree, or [] when the tree is valid. */
export type Validator = (files: Readonly<Record<string, string | null>>) => Promise<string[]>;

export type BatchResult = {
  plan: SyncPlan;
  accepted: { unit: string; summary: string; changes: RaceChange[] }[];
  /** Units whose bundles changed nothing (already in the data). */
  unchanged: string[];
  rejected: { unit: string; reason: string }[];
};

/**
 * Plan every bundle on top of the ones accepted so far. A bundle that throws or fails
 * `validate` is rejected and leaves no trace in the accumulated files.
 */
export async function planBatch(base: RaceStore, bundles: readonly Bundle[], config: SitesConfig, now: string, validate: Validator | null): Promise<BatchResult> {
  let files: Record<string, string | null> = {};
  const changes: RaceChange[] = [];
  const accepted: BatchResult["accepted"] = [];
  const unchanged: string[] = [];
  const rejected: BatchResult["rejected"] = [];
  for (const bundle of bundles) {
    let plan: SyncPlan;
    try {
      plan = await planBundle(overlayStore(base, files), bundle, config, now);
    } catch (err) {
      rejected.push({ unit: bundle.unit, reason: (err as Error).message });
      continue;
    }
    if (plan.changes.length === 0) {
      unchanged.push(bundle.unit);
      continue;
    }
    const candidate = { ...files, ...plan.files };
    const errors = validate ? await validate(candidate) : [];
    if (errors.length) {
      rejected.push({ unit: bundle.unit, reason: `validate failed:\n${errors.slice(0, 8).join("\n")}` });
      continue;
    }
    files = candidate;
    changes.push(...plan.changes);
    accepted.push({ unit: bundle.unit, summary: bundle.summary, changes: plan.changes });
  }
  return { plan: { files, changes: mergeChanges(changes), skipped: [] }, accepted, unchanged, rejected };
}

/** `npm run validate` on a temporary copy of the checkout's data with `files` written on top. */
export function treeValidator(root: string): Validator {
  const tsxUrl = import.meta.resolve("tsx");
  const validateScript = join(dirname(fileURLToPath(import.meta.url)), "..", "validate.ts");
  return async (files) => {
    const tmp = mkdtempSync(join(tmpdir(), "openrace-flush-"));
    try {
      for (const dir of ["data", "config", "state", "schema"]) if (existsSync(join(root, dir))) cpSync(join(root, dir), join(tmp, dir), { recursive: true });
      for (const [path, content] of Object.entries(files)) {
        const dest = join(tmp, path);
        if (content === null) rmSync(dest, { force: true });
        else {
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, content);
        }
      }
      const run = spawnSync(process.execPath, ["--import", tsxUrl, validateScript], { cwd: tmp, encoding: "utf8" });
      if (run.status === 0) return [];
      const lines = `${run.stdout}\n${run.stderr}`.split("\n").map((l) => l.trim()).filter(Boolean);
      return lines.length ? lines : [`validate exited ${run.status}`];
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  };
}

/** Commit message body: which unit did what. */
export function batchContext(result: BatchResult): string {
  return result.accepted.map((a) => `- ${a.unit}: ${a.summary} (${a.changes.map((c) => c.slug).join(", ")})`).join("\n");
}

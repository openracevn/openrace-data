/**
 * Staging bundles (plan 019). A worker never commits: it writes `.staging/<unit>.json`, a
 * list of operations with reasons and source links, and `npm run flush` later applies all
 * bundles, validates them and commits once. Operations reuse what `npm run edit` does:
 *
 *   add       a race (or a new edition) from a reference page, like `edit add`
 *   set-many  overrides on one existing race, like `edit set-many`
 *   source    a page already read (agent-read result), as a sync input
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { releaseUnit } from "./claims.ts";
import type { Workspace } from "./workspace.ts";

export const UNIT_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/;

const reason = z.string().min(1, "every operation needs a reason (where the fact comes from)");
const fields = z.record(z.string(), z.unknown()).refine((o) => Object.keys(o).length > 0, "no fields");

export const OpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    /** Where the info comes from: organizer page, reseller page, article or a Wayback snapshot. */
    url: z.url(),
    /** Force the source onto this existing race (id or slug), bypassing name/date matching. */
    attachTo: z.string().min(1).optional(),
    /** Extraction-shaped facts (see `edit add`): name and date are required. */
    fields,
    reason,
  }),
  z.object({ op: z.literal("set-many"), race: z.string().min(1), fields, reason }),
  z.object({
    op: z.literal("source"),
    input: z.object({
      url: z.url(),
      site: z.string().min(1),
      role: z.enum(["official", "seller", "reference"]),
      extracted: z.record(z.string(), z.unknown()),
      checkedAt: z.string().min(1),
      slugHint: z.string().optional(),
      matchId: z.string().optional(),
    }),
  }),
]);
export type Op = z.infer<typeof OpSchema>;

export const BundleSchema = z.object({
  unit: z.string().regex(UNIT_NAME, "unit must be lowercase letters, digits and dashes"),
  /** One line for the commit message: what this unit was asked to do. */
  summary: z.string().min(1),
  ops: z.array(OpSchema),
  /** Gaps that stayed gaps, with what was tried (mirrors attempts.json). Never staged as data. */
  deadEnds: z.array(z.object({ target: z.string().min(1), field: z.string().min(1), tried: z.string().min(1) })).default([]),
});
export type Bundle = z.infer<typeof BundleSchema>;

export type StagedFile = { unit: string; bundle: Bundle } | { unit: string; error: string };

export function parseBundle(text: string): Bundle {
  return BundleSchema.parse(JSON.parse(text));
}

export function writeBundle(ws: Workspace, bundle: Bundle): string {
  const parsed = BundleSchema.parse(bundle);
  mkdirSync(ws.stagingDir, { recursive: true });
  const path = join(ws.stagingDir, `${parsed.unit}.json`);
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
  return path;
}

/** Every bundle in the staging folder (or just `only`); an unreadable one comes back as an error, not a throw. */
export function readStaged(ws: Workspace, only?: readonly string[]): StagedFile[] {
  if (!existsSync(ws.stagingDir)) return [];
  return readdirSync(ws.stagingDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .filter((unit) => !only || only.includes(unit))
    .sort()
    .map((unit): StagedFile => {
      try {
        const bundle = parseBundle(readFileSync(join(ws.stagingDir, `${unit}.json`), "utf8"));
        if (bundle.unit !== unit) return { unit, error: `file is ${unit}.json but the bundle says unit "${bundle.unit}"` };
        return { unit, bundle };
      } catch (err) {
        return { unit, error: (err as Error).message };
      }
    });
}

export type ArchiveStatus = "committed" | "nothing-new" | "rejected" | "dead-end";

/**
 * Move a finished unit out of the way, never deleting: its bundle and working folder go to
 * `<archive>/<YYYY-MM-DD>-<unit>/`, with a status note, and its claims are released.
 */
export function archiveUnit(ws: Workspace, unit: string, status: ArchiveStatus, note: string, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  let dest = join(ws.archiveDir, `${day}-${unit}`);
  for (let n = 2; existsSync(dest); n++) dest = join(ws.archiveDir, `${day}-${unit}-${n}`);
  mkdirSync(dest, { recursive: true });
  const bundle = join(ws.stagingDir, `${unit}.json`);
  if (existsSync(bundle)) renameSync(bundle, join(dest, "bundle.json"));
  const work = join(ws.workDir, unit);
  if (existsSync(work)) renameSync(work, join(dest, "work"));
  writeFileSync(join(dest, "status.json"), `${JSON.stringify({ unit, status, note, at: now.toISOString() }, null, 2)}\n`);
  releaseUnit(ws.claimsDir, unit);
  return dest;
}

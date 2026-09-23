/**
 * Which races a push added, updated or removed, from the git diff of data/races
 * (not commit messages), so it is accurate for checker commits, manual edits and
 * merges alike. Shared by the Discord and API notifications. Node-only (runs git).
 */
import { execFileSync } from "node:child_process";
import { changedFields } from "./diff.ts";
import { RACES_DIR, type CanonicalField, type Race } from "./schema.ts";

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export type RaceDiff = {
  before: string;
  after: string;
  added: { id: string; path: string; race: Race | null }[];
  updated: { id: string; path: string; before: Race | null; after: Race | null; fields: CanonicalField[] }[];
  removed: { id: string; path: string; race: Race | null }[];
};

/**
 * Files are named by slug, so races are matched by the id inside them: a slug
 * rename (old file deleted, new file added, same id) is one update.
 */
export function raceDiff(beforeSha: string | undefined, afterSha: string | undefined): RaceDiff {
  const after = afterSha ?? git("rev-parse", "HEAD");
  const before = resolveBase(beforeSha, after);
  const diff: RaceDiff = { before, after, added: [], updated: [], removed: [] };
  const lines = git("diff", "--no-renames", "--name-status", before, after, "--", RACES_DIR)
    .split("\n")
    .filter((l) => l.endsWith(".json"));
  const gone = new Map<string, { path: string; race: Race | null }>();
  const added: { id: string; path: string; race: Race | null }[] = [];
  for (const line of lines) {
    const [status, path] = line.split("\t") as [string, string];
    if (status === "A") {
      const race = readRace(after, path);
      added.push({ id: race?.id ?? fileStem(path), path, race });
    } else if (status === "D") {
      const race = readRace(before, path);
      gone.set(race?.id ?? fileStem(path), { path, race });
    } else {
      const a = readRace(before, path);
      const b = readRace(after, path);
      diff.updated.push({ id: b?.id ?? a?.id ?? fileStem(path), path, before: a, after: b, fields: a && b ? changedFields(a, b) : [] });
    }
  }
  for (const { id, path, race } of added) {
    const old = gone.get(id);
    if (!old) {
      diff.added.push({ id, path, race });
      continue;
    }
    gone.delete(id);
    diff.updated.push({ id, path, before: old.race, after: race, fields: old.race && race ? changedFields(old.race, race) : [] });
  }
  for (const [id, { path, race }] of gone) diff.removed.push({ id, path, race });
  return diff;
}

function fileStem(path: string): string {
  return path.slice(RACES_DIR.length + 1, -".json".length);
}

export function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

/** github.event.before is all zeros for a new branch, and may be missing after a force push. */
function resolveBase(sha: string | undefined, head: string): string {
  if (sha && !/^0+$/.test(sha)) {
    try {
      git("cat-file", "-e", `${sha}^{commit}`);
      return sha;
    } catch {
      // fall through
    }
  }
  try {
    return git("rev-parse", `${head}^`);
  } catch {
    return EMPTY_TREE;
  }
}

function readRace(rev: string, path: string): Race | null {
  try {
    return JSON.parse(git("show", `${rev}:${path}`)) as Race;
  } catch {
    return null;
  }
}

/** Joins lines into messages of at most `limit` characters, splitting only between lines (Discord caps a message at 2000). */
export function splitMessages(lines: readonly string[], limit: number): string[] {
  const messages: string[] = [];
  for (const line of lines) {
    const entry = line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
    const last = messages.at(-1);
    if (last !== undefined && last.length + 1 + entry.length <= limit) messages[messages.length - 1] = `${last}\n${entry}`;
    else messages.push(entry);
  }
  return messages;
}

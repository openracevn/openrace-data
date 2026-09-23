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
  added: { id: string; race: Race | null }[];
  updated: { id: string; before: Race | null; after: Race | null; fields: CanonicalField[] }[];
  removed: { id: string; race: Race | null }[];
};

export function raceDiff(beforeSha: string | undefined, afterSha: string | undefined): RaceDiff {
  const after = afterSha ?? git("rev-parse", "HEAD");
  const before = resolveBase(beforeSha, after);
  const diff: RaceDiff = { before, after, added: [], updated: [], removed: [] };
  const lines = git("diff", "--no-renames", "--name-status", before, after, "--", RACES_DIR)
    .split("\n")
    .filter((l) => l.endsWith(".json"));
  for (const line of lines) {
    const [status, path] = line.split("\t") as [string, string];
    const id = path.slice(RACES_DIR.length + 1, -".json".length);
    if (status === "A") diff.added.push({ id, race: readRace(after, path) });
    else if (status === "D") diff.removed.push({ id, race: readRace(before, path) });
    else {
      const a = readRace(before, path);
      const b = readRace(after, path);
      diff.updated.push({ id, before: a, after: b, fields: a && b ? changedFields(a, b) : [] });
    }
  }
  return diff;
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

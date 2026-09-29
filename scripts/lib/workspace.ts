/**
 * Where update-race keeps its working files (plan 019). Everything is anchored to the MAIN
 * checkout, not the current worktree, so subagents in their own worktrees share one
 * staging area, one claims folder and one archive, and removing a worktree loses nothing.
 * All three folders are untracked (.gitignore / inside .git).
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

export type Workspace = {
  /** Staged bundles, one `<unit>.json` each. */
  stagingDir: string;
  /** Per-unit working folders (fetched pages, search results, price images). */
  workDir: string;
  /** Finished units: `<YYYY-MM-DD>-<unit>/`. */
  archiveDir: string;
  /** One file per claimed race or series id. */
  claimsDir: string;
};

export function workspaceAt(mainRoot: string, gitCommonDir: string): Workspace {
  return {
    stagingDir: resolve(mainRoot, ".staging"),
    workDir: resolve(mainRoot, ".agent-read"),
    archiveDir: resolve(mainRoot, ".agent-read-archive"),
    claimsDir: resolve(gitCommonDir, "openrace-claims"),
  };
}

/** The workspace of the checkout the command runs in, resolved to the main checkout. */
export function defaultWorkspace(cwd = process.cwd()): Workspace {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8" }).trim();
  return workspaceAt(dirname(common), common);
}

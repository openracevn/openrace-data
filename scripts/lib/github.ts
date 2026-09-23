import { Octokit } from "@octokit/rest";
import type { RaceStore } from "../sync.ts";

export type GitHubTarget = {
  token: string;
  owner: string;
  repo: string;
  branch: string;
};

/** Thin wrapper over the Git Data API: read files at a commit, write many files as one commit. */
export class GitHubRepo {
  private readonly octokit: Octokit;
  private readonly repoRef: { owner: string; repo: string };

  constructor(private readonly target: GitHubTarget) {
    this.octokit = new Octokit({ auth: target.token, userAgent: "openrace-data-sync" });
    this.repoRef = { owner: target.owner, repo: target.repo };
  }

  async headSha(): Promise<string> {
    const { data } = await this.octokit.git.getRef({ ...this.repoRef, ref: `heads/${this.target.branch}` });
    return data.object.sha;
  }

  storeAt(commitSha: string): RaceStore {
    return {
      read: async (path) => {
        try {
          const { data } = await this.octokit.repos.getContent({ ...this.repoRef, path, ref: commitSha });
          if (Array.isArray(data) || data.type !== "file") throw new Error(`${path} is not a file`);
          return decodeBase64Utf8(data.content);
        } catch (err) {
          if (statusOf(err) === 404) return null;
          throw err;
        }
      },
    };
  }

  /** Creates one commit on top of `parentSha` writing all `files` (null deletes); fails if the branch moved. */
  async commitFiles(parentSha: string, files: Record<string, string | null>, message: string): Promise<string> {
    const { data: parent } = await this.octokit.git.getCommit({ ...this.repoRef, commit_sha: parentSha });
    const { data: tree } = await this.octokit.git.createTree({
      ...this.repoRef,
      base_tree: parent.tree.sha,
      tree: Object.entries(files).map(([path, content]) =>
        content === null ? { path, mode: "100644", type: "blob", sha: null } : { path, mode: "100644", type: "blob", content },
      ),
    });
    const { data: commit } = await this.octokit.git.createCommit({
      ...this.repoRef,
      message,
      tree: tree.sha,
      parents: [parentSha],
    });
    await this.octokit.git.updateRef({
      ...this.repoRef,
      ref: `heads/${this.target.branch}`,
      sha: commit.sha,
      force: false,
    });
    return commit.sha;
  }
}

function statusOf(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "status" in err ? Number(err.status) : undefined;
}

/** GitHub answers 422 "Update is not a fast forward" when the branch moved since we read it. */
export function isNotFastForward(err: unknown): boolean {
  return statusOf(err) === 422;
}

// Decodes UTF-8 correctly for Vietnamese text (plain atob would mangle it).
function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

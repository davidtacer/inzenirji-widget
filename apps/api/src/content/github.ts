/**
 * Site content on GitHub (TASK-005, ADR-012). Reads `site.json` + `pages/*.json` from a branch and writes all
 * changes of one edit as a single commit. Writes are only ever allowed under the site's content root.
 */

export interface RepoConfig {
  owner: string;
  repo: string;
  devBranch: string;
  mainBranch: string;
  contentRoot: string; // no leading/trailing slash
}

export interface ContentSnapshot {
  /** Commit the snapshot was read from (used to detect concurrent changes when committing). */
  headSha: string;
  site: unknown;
  pages: Record<string, unknown>;
}

/** A file change relative to the content root: "site.json" or "pages/<slug>.json"; null content deletes. */
export interface ContentChange {
  path: string;
  content: string | null;
}

export type GitHubErrorCode = "not_found" | "conflict" | "unauthorized" | "upstream" | "nothing_to_undo";

/** Every publish commit starts with this; undo only ever reverts such a commit. */
export const PUBLISH_PREFIX = "Objava urejevalnika: ";

export class GitHubError extends Error {
  constructor(
    readonly code: GitHubErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const CONTENT_PATH = /^(site\.json|pages\/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.json)$/;

/** True for paths the editor may write inside the content root. */
export function isAllowedContentPath(path: string): boolean {
  return CONTENT_PATH.test(path);
}

function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export interface GitHubContentStore {
  read(branch: string): Promise<ContentSnapshot>;
  commit(changes: ContentChange[], message: string, expectedHeadSha: string): Promise<string>;
  publish(message: string): Promise<{ merged: boolean; sha: string | null }>;
  undoLastPublish(): Promise<{ sha: string; revertedMessage: string }>;
  discardDraft(): Promise<string>;
  status(): Promise<{ unpublished: number; devSha: string; mainSha: string; previewBuild: BuildState }>;
}

export type BuildState = "pending" | "success" | "failure" | "unknown";

export function createGitHubStore(
  cfg: RepoConfig,
  token: string,
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
): GitHubContentStore {
  const base = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;

  async function gh<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "inzenirji-editor",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    const data = (text ? JSON.parse(text) : null) as T;
    if (res.status === 401 || res.status === 403)
      throw new GitHubError("unauthorized", res.status, `GitHub ${method} ${path}`);
    if (res.status === 404) throw new GitHubError("not_found", 404, `GitHub ${method} ${path}`);
    if (res.status === 409 || res.status === 422)
      throw new GitHubError("conflict", res.status, `GitHub ${method} ${path}`);
    if (res.status >= 400) throw new GitHubError("upstream", res.status, `GitHub ${method} ${path}`);
    return { status: res.status, data };
  }

  const branchRef = (branch: string) =>
    `/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`;
  const updateRef = (branch: string) =>
    `/git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`;
  const contentPath = (rel: string) => `${cfg.contentRoot}/${rel}`;

  /**
   * Content files changed on the test site since it last met the live site. Counts files, not commits: after
   * an undo, dev contains a merge commit with no changes.
   */
  async function changedContentFiles(mainSha?: string, devSha?: string): Promise<number> {
    const [m, d] = await Promise.all([mainSha ?? headOf(cfg.mainBranch), devSha ?? headOf(cfg.devBranch)]);
    const { data: cmp } = await gh<{ files?: Array<{ filename: string }> }>(
      "GET",
      `/compare/${encodeURIComponent(m)}...${encodeURIComponent(d)}`,
    );
    return (cmp.files ?? []).filter((f) => f.filename.startsWith(`${cfg.contentRoot}/`)).length;
  }

  async function headOf(branch: string): Promise<string> {
    const { data } = await gh<{ object: { sha: string } }>("GET", branchRef(branch));
    return data.object.sha;
  }

  async function readFileAt(path: string, sha: string): Promise<string> {
    const { data } = await gh<{ content: string; encoding: string }>(
      "GET",
      `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`,
    );
    return decodeBase64Utf8(data.content);
  }

  return {
    async read(branch) {
      const headSha = await headOf(branch);
      const site = JSON.parse(await readFileAt(contentPath("site.json"), headSha)) as unknown;
      const { data: listing } = await gh<Array<{ name: string; type: string }>>(
        "GET",
        `/contents/${contentPath("pages").split("/").map(encodeURIComponent).join("/")}?ref=${headSha}`,
      );
      const pages: Record<string, unknown> = {};
      for (const entry of listing) {
        if (entry.type !== "file" || !entry.name.endsWith(".json")) continue;
        pages[entry.name.slice(0, -5)] = JSON.parse(
          await readFileAt(contentPath(`pages/${entry.name}`), headSha),
        );
      }
      return { headSha, site, pages };
    },

    async commit(changes, message, expectedHeadSha) {
      if (changes.length === 0) throw new Error("commit: no changes");
      for (const c of changes) {
        if (!isAllowedContentPath(c.path)) throw new Error(`commit: path not allowed: ${c.path}`);
      }
      const head = await headOf(cfg.devBranch);
      if (head !== expectedHeadSha) {
        throw new GitHubError("conflict", 409, "The test site changed while editing; please try again.");
      }
      const { data: headCommit } = await gh<{ tree: { sha: string } }>("GET", `/git/commits/${head}`);
      const { data: tree } = await gh<{ sha: string }>("POST", "/git/trees", {
        base_tree: headCommit.tree.sha,
        tree: changes.map((c) =>
          c.content === null
            ? { path: contentPath(c.path), mode: "100644", type: "blob", sha: null }
            : { path: contentPath(c.path), mode: "100644", type: "blob", content: c.content },
        ),
      });
      const { data: commit } = await gh<{ sha: string }>("POST", "/git/commits", {
        message,
        tree: tree.sha,
        parents: [head],
      });
      // force: false — fails (422) if someone else moved the branch in the meantime.
      await gh("PATCH", updateRef(cfg.devBranch), { sha: commit.sha, force: false });
      return commit.sha;
    },

    async publish(message) {
      // Nothing to publish (e.g. right after an undo, dev only has a merge commit without content changes).
      if ((await changedContentFiles()) === 0) return { merged: false, sha: null };
      const { status, data } = await gh<{ sha: string } | null>("POST", "/merges", {
        base: cfg.mainBranch,
        head: cfg.devBranch,
        commit_message: `${PUBLISH_PREFIX}${message}`,
      });
      return status === 204 ? { merged: false, sha: null } : { merged: true, sha: data?.sha ?? null };
    },

    async undoLastPublish() {
      const mainHead = await headOf(cfg.mainBranch);
      const { data: last } = await gh<{ message: string; parents: Array<{ sha: string }> }>(
        "GET",
        `/git/commits/${mainHead}`,
      );
      // Only a publish made by the editor can be undone (never template/code commits, never an undo).
      const previous = last.parents[0]?.sha;
      if (!previous || !last.message.startsWith(PUBLISH_PREFIX)) {
        throw new GitHubError("nothing_to_undo", 409, "The last change on the live site is not a publish.");
      }
      const { data: prevCommit } = await gh<{ tree: { sha: string } }>("GET", `/git/commits/${previous}`);
      const firstLine = (last.message.split("\n")[0] ?? "").slice(PUBLISH_PREFIX.length);
      const { data: revert } = await gh<{ sha: string }>("POST", "/git/commits", {
        message: `Razveljavljeno: ${firstLine}`,
        tree: prevCommit.tree.sha,
        parents: [mainHead],
      });
      await gh("PATCH", updateRef(cfg.mainBranch), { sha: revert.sha, force: false });
      // Bring the test site in line, so the next publish does not bring the change back.
      await gh("POST", "/merges", {
        base: cfg.devBranch,
        head: cfg.mainBranch,
        commit_message: `Razveljavljeno tudi na testni strani: ${firstLine}`,
      });
      return { sha: revert.sha, revertedMessage: firstLine };
    },

    async discardDraft() {
      const mainHead = await headOf(cfg.mainBranch);
      await gh("PATCH", updateRef(cfg.devBranch), { sha: mainHead, force: true });
      return mainHead;
    },

    async status() {
      const [devSha, mainSha] = await Promise.all([headOf(cfg.devBranch), headOf(cfg.mainBranch)]);
      const unpublished = await changedContentFiles(mainSha, devSha);
      let previewBuild: BuildState = "unknown";
      try {
        const { data: runs } = await gh<{
          check_runs: Array<{ name: string; status: string; conclusion: string | null }>;
        }>("GET", `/commits/${devSha}/check-runs?check_name=${encodeURIComponent("Deploy site")}`);
        const run = runs.check_runs[0];
        if (run) {
          previewBuild =
            run.status !== "completed" ? "pending" : run.conclusion === "success" ? "success" : "failure";
        } else {
          previewBuild = "pending";
        }
      } catch {
        previewBuild = "unknown";
      }
      return { unpublished, devSha, mainSha, previewBuild };
    },
  };
}

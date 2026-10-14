/**
 * Test-only in-memory GitHub: a small git model (flat trees, commits, branches, three-way merges) behind the
 * REST endpoints that content/github.ts uses. Lets tests check real publish/undo semantics without network.
 */
type Tree = Record<string, string>; // path → file content
interface Commit {
  tree: string;
  parents: string[];
  message: string;
}

export class FakeGitHub {
  trees = new Map<string, Tree>();
  commits = new Map<string, Commit>();
  refs = new Map<string, string>();
  /** Binary blobs (stored as "base64:<data>" in trees). */
  blobs = new Map<string, string>();
  /** "Deploy site" check run per commit sha (no entry → no run yet). */
  checkRuns = new Map<
    string,
    { status: "queued" | "in_progress" | "completed"; conclusion: string | null }
  >();
  requests: Array<{ method: string; path: string }> = [];
  private n = 0;
  /** Set to a status to make the next matching request fail (e.g. simulate a concurrent push). */
  failNext: { method: string; pathIncludes: string; status: number } | null = null;

  constructor(
    readonly owner = "acme",
    readonly repo = "site",
    readonly token = "test-token",
  ) {}

  private id(prefix: string) {
    this.n++;
    return `${prefix}${this.n.toString(16).padStart(39, "0")}`;
  }

  addTree(files: Tree): string {
    const sha = this.id("t");
    this.trees.set(sha, { ...files });
    return sha;
  }

  addCommit(files: Tree, parents: string[], message: string): string {
    const sha = this.id("c");
    this.commits.set(sha, { tree: this.addTree(files), parents, message });
    return sha;
  }

  filesAt(ref: string): Tree {
    const sha = this.refs.get(ref) ?? ref;
    const c = this.commits.get(sha);
    if (!c) throw new Error(`no commit ${sha}`);
    return this.trees.get(c.tree) ?? {};
  }

  private ancestors(sha: string): Set<string> {
    const seen = new Set<string>();
    const stack = [sha];
    while (stack.length) {
      const s = stack.pop() as string;
      if (seen.has(s)) continue;
      seen.add(s);
      stack.push(...(this.commits.get(s)?.parents ?? []));
    }
    return seen;
  }

  /** Best common ancestor, like git: a common ancestor that is not an ancestor of another common ancestor. */
  private mergeBase(a: string, b: string): string | null {
    const ab = this.ancestors(b);
    const common = [...this.ancestors(a)].filter((s) => ab.has(s));
    const best = common.filter((c) => !common.some((o) => o !== c && this.ancestors(o).has(c)));
    return best[0] ?? null;
  }

  private json(status: number, body?: unknown): Response {
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }

  /** fetch-compatible handler. */
  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const prefix = `/repos/${this.owner}/${this.repo}`;
    if (!url.pathname.startsWith(prefix)) return this.json(404, { message: "Not Found" });
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    this.requests.push({ method, path });
    if (new Headers(init?.headers).get("Authorization") !== `Bearer ${this.token}`) {
      return this.json(401, { message: "Bad credentials" });
    }
    if (this.failNext && method === this.failNext.method && path.includes(this.failNext.pathIncludes)) {
      const status = this.failNext.status;
      this.failNext = null;
      return this.json(status, { message: "simulated failure" });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const ref = url.searchParams.get("ref");

    let m: RegExpMatchArray | null;
    m = method === "GET" ? path.match(/^\/git\/ref\/heads\/(.+)$/) : null;
    if (m) {
      const sha = this.refs.get(m[1] as string);
      return sha ? this.json(200, { object: { sha } }) : this.json(404);
    }
    m = method === "PATCH" ? path.match(/^\/git\/refs\/heads\/(.+)$/) : null;
    if (m) {
      const branch = m[1] as string;
      const current = this.refs.get(branch);
      if (!current) return this.json(404);
      if (!body.force && !this.ancestors(body.sha).has(current))
        return this.json(422, { message: "not fast-forward" });
      this.refs.set(branch, body.sha);
      return this.json(200, { object: { sha: body.sha } });
    }
    m = method === "GET" ? path.match(/^\/git\/commits\/(\w+)$/) : null;
    if (m) {
      const c = this.commits.get(m[1] as string);
      return c
        ? this.json(200, {
            sha: m[1],
            message: c.message,
            tree: { sha: c.tree },
            parents: c.parents.map((sha) => ({ sha })),
          })
        : this.json(404);
    }
    if (method === "POST" && path === "/git/blobs") {
      if (body.encoding !== "base64" || typeof body.content !== "string") return this.json(422);
      const sha = this.id("b");
      this.blobs.set(sha, `base64:${body.content}`);
      return this.json(201, { sha });
    }
    if (method === "POST" && path === "/git/trees") {
      const baseTree = this.trees.get(body.base_tree);
      if (!baseTree) return this.json(422);
      const next: Tree = { ...baseTree };
      for (const e of body.tree as Array<{ path: string; content?: string; sha?: string | null }>) {
        if (e.sha === null) delete next[e.path];
        else if (typeof e.sha === "string") {
          const blob = this.blobs.get(e.sha);
          if (blob === undefined) return this.json(422, { message: "unknown blob" });
          next[e.path] = blob;
        } else next[e.path] = e.content ?? "";
      }
      return this.json(201, { sha: this.addTree(next) });
    }
    if (method === "POST" && path === "/git/commits") {
      if (!this.trees.has(body.tree)) return this.json(422);
      const sha = this.id("c");
      this.commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message });
      return this.json(201, { sha });
    }
    m = method === "GET" ? path.match(/^\/contents\/(.+)$/) : null;
    if (m && ref) {
      const files = this.filesAt(ref);
      const p = m[1] as string;
      if (p in files) {
        const content = btoa(String.fromCharCode(...new TextEncoder().encode(files[p] as string)));
        return this.json(200, { type: "file", encoding: "base64", content });
      }
      const dir = `${p}/`;
      const names = Object.keys(files)
        .filter((f) => f.startsWith(dir) && !f.slice(dir.length).includes("/"))
        .map((f) => ({ name: f.slice(dir.length), type: "file" }));
      return names.length ? this.json(200, names) : this.json(404);
    }
    if (method === "POST" && path === "/merges") {
      const baseSha = this.refs.get(body.base);
      const headSha = this.refs.get(body.head);
      if (!baseSha || !headSha) return this.json(404);
      if (this.ancestors(baseSha).has(headSha)) return this.json(204);
      const mb = this.mergeBase(baseSha, headSha);
      const B = this.filesAt(baseSha);
      const H = this.filesAt(headSha);
      const M = mb ? this.filesAt(mb) : {};
      const merged: Tree = {};
      for (const p of new Set([...Object.keys(B), ...Object.keys(H), ...Object.keys(M)])) {
        const [b, h, o] = [B[p], H[p], M[p]];
        const pick = h === o ? b : b === o ? h : b === h ? b : Symbol.for("conflict");
        if (pick === Symbol.for("conflict")) return this.json(409, { message: "Merge conflict" });
        if (pick !== undefined) merged[p] = pick as string;
      }
      const sha = this.addCommit(merged, [baseSha, headSha], body.commit_message);
      this.refs.set(body.base, sha);
      return this.json(201, { sha });
    }
    m = method === "GET" ? path.match(/^\/compare\/(\w+)\.\.\.(\w+)$/) : null;
    if (m) {
      const [a, b] = [m[1] as string, m[2] as string];
      const mb = this.mergeBase(a, b);
      const M = mb ? this.filesAt(mb) : {};
      const H = this.filesAt(b);
      const files = [...new Set([...Object.keys(M), ...Object.keys(H)])]
        .filter((p) => M[p] !== H[p])
        .map((filename) => ({ filename }));
      return this.json(200, { files });
    }
    m = method === "GET" ? path.match(/^\/commits\/(\w+)\/check-runs$/) : null;
    if (m) {
      const run = this.checkRuns.get(m[1] as string);
      return this.json(200, { check_runs: run ? [{ name: "Deploy site", ...run }] : [] });
    }
    return this.json(404, { message: `fake: no route ${method} ${path}` });
  };
}

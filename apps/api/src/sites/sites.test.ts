import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.ts";
import { createGitHubStore, GitHubError, PUBLISH_PREFIX } from "../content/github.ts";
import { contentFixture, DEMO, OTHER, ROOT, T0 } from "../testing/fixtures.ts";

async function setup(opts: { noStore?: boolean; token?: () => Promise<string> } = {}) {
  const f = await contentFixture();
  const app = createApp({
    version: "test",
    sites: {
      db: f.db,
      now: () => T0,
      storeFor: (repo) =>
        opts.noStore ? null : createGitHubStore(repo, opts.token ?? f.gh.token, f.gh.fetch),
    },
  });
  const call = (method: string, path: string, token: string | null = f.session) =>
    app.request(`/api/sites/${path}`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  const draft = (price: number) => {
    const head = f.gh.refs.get("demo/dev") as string;
    const files = { ...f.gh.filesAt(head), [`${ROOT}/pages/meni.json`]: JSON.stringify({ price }) };
    f.gh.refs.set("demo/dev", f.gh.addCommit(files, [head], `Cena ${price}`));
  };
  const log = () =>
    f.db.raw.prepare("SELECT kind, email, commit_sha FROM change_log ORDER BY id").all() as Array<{
      kind: string;
      email: string;
      commit_sha: string | null;
    }>;
  return { ...f, call, draft, log };
}

describe("GitHub App (TASK-014)", () => {
  it("works with an installation token fetched per request", async () => {
    let token = "";
    const t = await setup({ token: async () => token });
    token = t.gh.token;
    expect((await t.call("GET", "demo/status")).status).toBe(200);
  });

  it("app not installed on the site's repo → 503 github_not_installed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await setup({
      token: async () => {
        throw new GitHubError("not_installed", 404, "x");
      },
    });
    const res = await t.call("GET", "demo/status");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "github_not_installed" });
    vi.restoreAllMocks();
  });
});

describe("access", () => {
  it("needs a session", async () => {
    const t = await setup();
    expect((await t.call("GET", "demo/status", null)).status).toBe(401);
    expect((await t.call("GET", "demo/status", "Z".repeat(43))).status).toBe(401);
  });

  it("refuses a session of another site", async () => {
    const t = await setup();
    const res = await t.call("POST", "demo/publish", t.otherSession);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "wrong_site" });
  });

  it("404 for a site without a connected repo", async () => {
    const t = await setup();
    const res = await t.call("GET", `${OTHER.id}/status`, t.otherSession);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "site_not_connected" });
  });

  it("503 when GitHub access is not configured", async () => {
    const t = await setup({ noStore: true });
    expect((await t.call("GET", "demo/status")).status).toBe(503);
  });

  it("400 for an invalid site id", async () => {
    const t = await setup();
    expect((await t.call("GET", "Demo!/status")).status).toBe(400);
  });
});

describe("status, publish, undo, discard", () => {
  it("status shows unpublished changes, the deployed commit and build of each site, and the URLs", async () => {
    const t = await setup();
    t.draft(650);
    const devSha = t.gh.refs.get("demo/dev") as string;
    const mainSha = t.gh.refs.get("demo/main") as string;
    t.gh.checkRuns.set(mainSha, { status: "completed", conclusion: "success" });
    const res = await t.call("GET", "demo/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      unpublished: 1,
      previewSha: devSha,
      previewBuild: "pending", // no run for the new commit yet
      liveSha: mainSha,
      liveBuild: "success",
      previewUrl: "https://demo-dev.inzenirji.si",
      liveUrl: "https://demo.inzenirji.si",
    });
  });

  it.each([
    [{ status: "queued", conclusion: null }, "pending"],
    [{ status: "in_progress", conclusion: null }, "pending"],
    [{ status: "completed", conclusion: "success" }, "success"],
    [{ status: "completed", conclusion: "failure" }, "failure"],
    [{ status: "completed", conclusion: "cancelled" }, "failure"],
  ] as const)("test site build %o → %s", async (run, expected) => {
    const t = await setup();
    t.draft(650);
    t.gh.checkRuns.set(t.gh.refs.get("demo/dev") as string, run);
    expect(
      ((await (await t.call("GET", "demo/status")).json()) as { previewBuild: string }).previewBuild,
    ).toBe(expected);
  });

  it("publish merges into the live branch and logs who did it", async () => {
    const t = await setup();
    t.draft(650);
    const res = await t.call("POST", "demo/publish");
    expect(await res.json()).toEqual({
      published: true,
      sha: t.gh.refs.get("demo/main"),
      liveUrl: DEMO.origin,
    });
    expect(t.gh.commits.get(t.gh.refs.get("demo/main") as string)?.message).toMatch(
      new RegExp(`^${PUBLISH_PREFIX}`),
    );
    expect(t.log()).toEqual([
      { kind: "publish", email: "lastnik@example.com", commit_sha: t.gh.refs.get("demo/main") },
    ]);
  });

  it("publish without changes does nothing and logs nothing", async () => {
    const t = await setup();
    expect(await (await t.call("POST", "demo/publish")).json()).toEqual({
      published: false,
      sha: null,
      liveUrl: DEMO.origin,
    });
    expect(t.log()).toEqual([]);
  });

  it("undo reverts the last publish; a second undo answers 409 nothing_to_undo", async () => {
    const t = await setup();
    t.draft(650);
    await t.call("POST", "demo/publish");
    const res = await t.call("POST", "demo/undo");
    expect(res.status).toBe(200);
    expect(JSON.parse(t.gh.filesAt("demo/main")[`${ROOT}/pages/meni.json`] as string).blocks).toBeDefined();
    const again = await t.call("POST", "demo/undo");
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "nothing_to_undo" });
    expect(t.log().map((l) => l.kind)).toEqual(["publish", "undo"]);
  });

  it("discard resets the test site", async () => {
    const t = await setup();
    t.draft(999);
    expect((await t.call("POST", "demo/discard")).status).toBe(200);
    expect(t.gh.refs.get("demo/dev")).toBe(t.gh.refs.get("demo/main"));
  });

  it("maps GitHub failures to 502 without leaking details", async () => {
    const t = await setup();
    t.gh.failNext = { method: "GET", pathIncludes: "/git/ref/heads/", status: 500 };
    const res = await t.call("GET", "demo/status");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
  });
});

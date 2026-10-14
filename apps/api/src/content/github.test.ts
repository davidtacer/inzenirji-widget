import { describe, expect, it } from "vitest";
import { FakeGitHub } from "../testing/fake-github.ts";
import {
  createGitHubStore,
  GitHubError,
  isAllowedContentPath,
  PUBLISH_PREFIX,
  type RepoConfig,
  SiteSchemaError,
} from "./github.ts";

const ROOT = "apps/site/content";
const cfg: RepoConfig = {
  owner: "acme",
  repo: "site",
  devBranch: "demo/dev",
  mainBranch: "demo/main",
  contentRoot: ROOT,
};
/** A minimal site with its own schema: the store knows nothing about block types (ADR-013). */
const schemaText = JSON.stringify({
  version: 1,
  notes: "Cene so v centih.",
  site: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  page: {
    type: "object",
    properties: { slug: { type: "string" }, title: { type: "string" }, price: { type: "integer" } },
    required: ["slug", "title"],
  },
});
const site = { name: "Gostilna" };
const home = { slug: "index", title: "Domov" };
const menu = { slug: "meni", title: "Meni", price: 550 };

function setup() {
  const gh = new FakeGitHub();
  const initial = gh.addCommit(
    {
      "README.md": "template code",
      [`${ROOT}/schema.json`]: schemaText,
      [`${ROOT}/site.json`]: JSON.stringify(site),
      [`${ROOT}/pages/index.json`]: JSON.stringify(home),
      [`${ROOT}/pages/meni.json`]: JSON.stringify(menu),
    },
    [],
    "initial",
  );
  gh.refs.set("demo/dev", initial);
  gh.refs.set("demo/main", initial);
  const store = createGitHubStore(cfg, gh.token, gh.fetch);
  return { gh, store };
}

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

describe("isAllowedContentPath", () => {
  it.each([
    ["site.json", true],
    ["pages/index.json", true],
    ["pages/o-nas.json", true],
    ["pages/O-nas.json", false],
    ["pages/../site.json", false],
    ["../package.json", false],
    ["pages/sub/x.json", false],
    ["pages/x.js", false],
    ["public/uploads/a.png", false],
  ])("%s → %s", (p, ok) => {
    expect(isAllowedContentPath(p)).toBe(ok);
  });
});

describe("read", () => {
  it("returns site, pages and the head commit of a branch", async () => {
    const { gh, store } = setup();
    const snap = await store.read("demo/dev");
    expect(snap.headSha).toBe(gh.refs.get("demo/dev"));
    expect(snap.site).toEqual(site);
    expect(snap.pages).toEqual({ index: home, meni: menu });
    expect(snap.schema.notes).toBe("Cene so v centih.");
    expect(snap.schema.text).toBe(schemaText);
  });

  it.each([
    ["missing", null, "missing"],
    ["not JSON", "{", "not valid JSON"],
    ["wrong version", JSON.stringify({ version: 2, site: {}, page: {} }), "version"],
    [
      "page without slug",
      JSON.stringify({
        version: 1,
        site: { type: "object" },
        page: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
      }),
      'require "slug"',
    ],
  ])("a site without a usable schema.json cannot be read (%s)", async (_case, text, reason) => {
    const { gh, store } = setup();
    const head = gh.refs.get("demo/dev") as string;
    const files: Record<string, string> = { ...gh.filesAt(head) };
    if (text === null) delete files[`${ROOT}/schema.json`];
    else files[`${ROOT}/schema.json`] = text;
    gh.refs.set("demo/dev", gh.addCommit(files, [head], "schema"));
    const err = await store.read("demo/dev").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SiteSchemaError);
    expect((err as SiteSchemaError).reason).toContain(reason);
  });

  it("schema.json itself can never be written by the editor", async () => {
    const { store, gh } = setup();
    const head = gh.refs.get("demo/dev") as string;
    await expect(store.commit([{ path: "schema.json", content: "{}" }], "x", head)).rejects.toThrow(
      "path not allowed",
    );
  });

  it("decodes UTF-8 (č, š, ž, €)", async () => {
    const { gh, store } = setup();
    const head = gh.refs.get("demo/dev") as string;
    const files = {
      ...gh.filesAt(head),
      [`${ROOT}/site.json`]: JSON.stringify({ name: "Hiša Čebelica – 5 €" }),
    };
    gh.refs.set("demo/dev", gh.addCommit(files, [head], "utf8"));
    expect((await store.read("demo/dev")).site).toEqual({ name: "Hiša Čebelica – 5 €" });
  });

  it("maps a wrong token to unauthorized", async () => {
    const gh = new FakeGitHub();
    const store = createGitHubStore(cfg, "wrong", gh.fetch);
    await expect(store.read("demo/dev")).rejects.toMatchObject({ code: "unauthorized" });
  });
});

describe("commit", () => {
  it("writes all changes as one commit on the dev branch only", async () => {
    const { gh, store } = setup();
    const snap = await store.read("demo/dev");
    const newMenu = { ...menu, price: 650 };
    const sha = await store.commit(
      [
        { path: "pages/meni.json", content: json(newMenu) },
        { path: "pages/o-nas.json", content: json({ slug: "o-nas" }) },
      ],
      "Nova cena bučne juhe",
      snap.headSha,
    );
    expect(gh.refs.get("demo/dev")).toBe(sha);
    expect(gh.commits.get(sha)?.parents).toEqual([snap.headSha]);
    expect(gh.commits.get(sha)?.message).toBe("Nova cena bučne juhe");
    const files = gh.filesAt("demo/dev");
    expect(JSON.parse(files[`${ROOT}/pages/meni.json`] as string)).toEqual(newMenu);
    expect(files[`${ROOT}/pages/o-nas.json`]).toBeDefined();
    expect(files["README.md"]).toBe("template code");
    expect(gh.filesAt("demo/main")[`${ROOT}/pages/meni.json`]).toBe(JSON.stringify(menu)); // live untouched
  });

  it("deletes files with null content", async () => {
    const { gh, store } = setup();
    const snap = await store.read("demo/dev");
    await store.commit([{ path: "pages/meni.json", content: null }], "Odstranjen meni", snap.headSha);
    expect(gh.filesAt("demo/dev")[`${ROOT}/pages/meni.json`]).toBeUndefined();
  });

  it.each(["../package.json", "pages/../site.json", "public/uploads/x.png", "README.md"])(
    "refuses to write outside the content files (%s)",
    async (path) => {
      const { gh, store } = setup();
      const snap = await store.read("demo/dev");
      const before = gh.refs.get("demo/dev");
      await expect(store.commit([{ path, content: "x" }], "hack", snap.headSha)).rejects.toThrow(
        "path not allowed",
      );
      expect(gh.refs.get("demo/dev")).toBe(before);
      expect(gh.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
    },
  );

  it("refuses when the branch moved since it was read", async () => {
    const { gh, store } = setup();
    const snap = await store.read("demo/dev");
    const head = gh.refs.get("demo/dev") as string;
    gh.refs.set("demo/dev", gh.addCommit(gh.filesAt(head), [head], "someone else"));
    await expect(
      store.commit([{ path: "site.json", content: "{}" }], "x", snap.headSha),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses an empty change set", async () => {
    const { store } = setup();
    const snap = await store.read("demo/dev");
    await expect(store.commit([], "x", snap.headSha)).rejects.toThrow("no changes");
  });
});

describe("publish, undo, discard, status", () => {
  async function edit(store: ReturnType<typeof setup>["store"], price: number) {
    const snap = await store.read("demo/dev");
    return store.commit(
      [{ path: "pages/meni.json", content: json({ ...menu, price }) }],
      `Cena ${price}`,
      snap.headSha,
    );
  }
  const livePrice = (gh: FakeGitHub) =>
    JSON.parse(gh.filesAt("demo/main")[`${ROOT}/pages/meni.json`] as string).price;
  const testPrice = (gh: FakeGitHub) =>
    JSON.parse(gh.filesAt("demo/dev")[`${ROOT}/pages/meni.json`] as string).price;

  it("status counts changed content files waiting for publish", async () => {
    const { store } = setup();
    expect((await store.status()).unpublished).toBe(0);
    await edit(store, 650);
    expect((await store.status()).unpublished).toBe(1);
  });

  it("publish merges the test site into the live site with the publish prefix", async () => {
    const { gh, store } = setup();
    await edit(store, 650);
    const res = await store.publish("Cena 650");
    expect(res.merged).toBe(true);
    expect(livePrice(gh)).toBe(650);
    expect(gh.commits.get(gh.refs.get("demo/main") as string)?.message).toBe(`${PUBLISH_PREFIX}Cena 650`);
    expect((await store.status()).unpublished).toBe(0);
  });

  it("publish with nothing new reports merged=false", async () => {
    const { store } = setup();
    expect(await store.publish("nič")).toEqual({ merged: false, sha: null });
  });

  it("undo restores the live site and the test site, and nothing comes back on the next publish", async () => {
    const { gh, store } = setup();
    await edit(store, 650);
    await store.publish("Cena 650");
    await edit(store, 700);
    await store.publish("Cena 700");
    const res = await store.undoLastPublish();
    expect(res.revertedMessage).toBe("Cena 700");
    expect(livePrice(gh)).toBe(650);
    expect(testPrice(gh)).toBe(650);
    expect((await store.status()).unpublished).toBe(0);
    expect(await store.publish("ponovno")).toEqual({ merged: false, sha: null });
    expect(livePrice(gh)).toBe(650);
  });

  it("undo refuses when the last live commit is not a publish (template code, or an undo)", async () => {
    const { store } = setup();
    await expect(store.undoLastPublish()).rejects.toMatchObject({ code: "nothing_to_undo" });
    await edit(store, 650);
    await store.publish("Cena 650");
    await store.undoLastPublish();
    await expect(store.undoLastPublish()).rejects.toBeInstanceOf(GitHubError);
  });

  it("undo keeps template files untouched", async () => {
    const { gh, store } = setup();
    await edit(store, 650);
    await store.publish("Cena 650");
    await store.undoLastPublish();
    expect(gh.filesAt("demo/main")["README.md"]).toBe("template code");
  });

  it("discard resets the test site to the live site", async () => {
    const { gh, store } = setup();
    await edit(store, 999);
    expect(testPrice(gh)).toBe(999);
    await store.discardDraft();
    expect(testPrice(gh)).toBe(550);
    expect(gh.refs.get("demo/dev")).toBe(gh.refs.get("demo/main"));
  });
});

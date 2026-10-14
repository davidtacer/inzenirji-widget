import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { tokenSourceFor } from "../worker.ts";
import { GitHubError, type RepoConfig } from "./github.ts";
import { appJwt, createAppAuth, INSTALLATION_PERMISSIONS, importAppKey } from "./github-app.ts";

// A real RSA key pair, exported the way GitHub hands it out (PKCS#1 "RSA PRIVATE KEY").
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const NOW = Date.UTC(2026, 9, 14, 8, 0, 0);

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
/** Verifies an app JWT the way GitHub does: RS256 signature with the app's public key. */
function verifyJwt(jwt: string) {
  const [h, p, s] = jwt.split(".") as [string, string, string];
  const ok = verify("sha256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"));
  return { ok, header: decode(h), payload: decode(p) };
}

/** Fake GitHub App API: one installation on acme/site; checks every app JWT. */
function fakeGitHubApp() {
  const calls: Array<{ method: string; path: string; body?: unknown; jwtOk: boolean }> = [];
  let issued = 0;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("https://api.github.com", "");
    const jwt = new Headers(init?.headers).get("Authorization")?.replace("Bearer ", "") ?? "";
    const jwtOk = verifyJwt(jwt).ok;
    calls.push({
      method: init?.method ?? "GET",
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      jwtOk,
    });
    if (!jwtOk) return new Response("{}", { status: 401 });
    if (path === "/repos/acme/site/installation") return Response.json({ id: 77 });
    if (path === "/app/installations/77/access_tokens" && init?.method === "POST") {
      issued++;
      return Response.json(
        { token: `ghs_installation_${issued}`, expires_at: new Date(NOW + 60 * 60_000).toISOString() },
        { status: 201 },
      );
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  });
  return { fetch, calls };
}

describe("app JWT", () => {
  it.each([
    ["PKCS#1 (as GitHub downloads it)", pkcs1],
    ["PKCS#8", pkcs8],
    ["PKCS#1 pasted with literal \\n", pkcs1.replace(/\n/g, "\\n")],
  ])("signs a valid RS256 JWT from a %s key", async (_name, pem) => {
    const jwt = await appJwt("123456", await importAppKey(pem), NOW);
    const { ok, header, payload } = verifyJwt(jwt);
    expect(ok).toBe(true);
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    const iat = NOW / 1000 - 60; // backdated for clock drift
    expect(payload).toEqual({ iss: "123456", iat, exp: iat + 600 }); // GitHub allows at most 10 minutes
  });

  it("rejects something that is not a key, with a clear message", async () => {
    await expect(importAppKey("not a key")).rejects.toThrow("private key");
  });
});

describe("installation tokens", () => {
  it("asks for a token for exactly this repo with the editor's permissions only", async () => {
    const gh = fakeGitHubApp();
    const auth = createAppAuth({ appId: "123456", privateKey: pkcs1 }, gh.fetch, () => NOW);
    expect(await auth.tokenFor("acme", "site")).toBe("ghs_installation_1");
    expect(gh.calls).toEqual([
      { method: "GET", path: "/repos/acme/site/installation", body: undefined, jwtOk: true },
      {
        method: "POST",
        path: "/app/installations/77/access_tokens",
        body: {
          repositories: ["site"],
          permissions: { contents: "write", checks: "read", metadata: "read" },
        },
        jwtOk: true,
      },
    ]);
    expect(INSTALLATION_PERMISSIONS).not.toHaveProperty("administration");
  });

  it("reuses a token until 5 minutes before it expires, then gets a new one", async () => {
    const gh = fakeGitHubApp();
    let t = NOW;
    const auth = createAppAuth({ appId: "123456", privateKey: pkcs1 }, gh.fetch, () => t);
    await auth.tokenFor("acme", "site");
    t = NOW + 54 * 60_000;
    expect(await auth.tokenFor("acme", "site")).toBe("ghs_installation_1");
    t = NOW + 56 * 60_000;
    expect(await auth.tokenFor("acme", "site")).toBe("ghs_installation_2");
    // a fresh app JWT was signed for the renewal (the first one lives 9 minutes)
    expect(gh.calls.every((c) => c.jwtOk)).toBe(true);
  });

  it("app not installed on the repo → not_installed", async () => {
    const gh = fakeGitHubApp();
    const auth = createAppAuth({ appId: "123456", privateKey: pkcs1 }, gh.fetch, () => NOW);
    const err = await auth.tokenFor("tujec", "repo").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).code).toBe("not_installed");
  });

  it("a wrong key is refused by GitHub → unauthorized", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const gh = fakeGitHubApp();
    const auth = createAppAuth(
      { appId: "123456", privateKey: other.export({ type: "pkcs1", format: "pem" }).toString() },
      gh.fetch,
      () => NOW,
    );
    const err = await auth.tokenFor("acme", "site").catch((e: unknown) => e);
    expect((err as GitHubError).code).toBe("unauthorized");
  });
});

describe("tokenSourceFor (worker)", () => {
  const repo: RepoConfig = { owner: "acme", repo: "site", devBranch: "d", mainBranch: "m", contentRoot: "c" };
  const app = (tokenFor: (o: string, r: string) => Promise<string>) => () => ({ tokenFor });

  it("no app, no token → null (sites answer 503 github_unavailable)", () => {
    expect(tokenSourceFor({}, repo)).toBeNull();
  });

  it("only GITHUB_TOKEN → that token (dev)", () => {
    expect(tokenSourceFor({ GITHUB_TOKEN: " ghp_x " }, repo)).toBe("ghp_x");
  });

  it("app configured → installation token for the site's repo", async () => {
    const tokenFor = vi.fn(async () => "ghs_app");
    const source = tokenSourceFor({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "k1" }, repo, app(tokenFor));
    expect(typeof source).toBe("function");
    expect(await (source as () => Promise<string>)()).toBe("ghs_app");
    expect(tokenFor).toHaveBeenCalledWith("acme", "site");
  });

  it("app not installed on this repo → falls back to GITHUB_TOKEN if set, otherwise the error", async () => {
    const notInstalled = async () => {
      throw new GitHubError("not_installed", 404, "x");
    };
    const withToken = tokenSourceFor(
      { GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "k2", GITHUB_TOKEN: "ghp_dev" },
      repo,
      app(notInstalled),
    ) as () => Promise<string>;
    expect(await withToken()).toBe("ghp_dev");
    const without = tokenSourceFor(
      { GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "k3" },
      repo,
      app(notInstalled),
    ) as () => Promise<string>;
    await expect(without()).rejects.toMatchObject({ code: "not_installed" });
  });

  it("other app errors never fall back to the token", async () => {
    const source = tokenSourceFor(
      { GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "k4", GITHUB_TOKEN: "ghp_dev" },
      repo,
      app(async () => {
        throw new GitHubError("unauthorized", 401, "x");
      }),
    ) as () => Promise<string>;
    await expect(source()).rejects.toMatchObject({ code: "unauthorized" });
  });
});

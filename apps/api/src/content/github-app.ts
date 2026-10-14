import { GitHubError } from "./github.ts";

/**
 * GitHub App authentication (TASK-014). Clients install the "Inženirji.si" GitHub App on their site repo; the
 * editor then gets a short-lived installation token for exactly that repo with the permissions it needs, and
 * never holds a client's personal token. Flow: app JWT (RS256, signed with the app's private key) →
 * `GET /repos/{owner}/{repo}/installation` → `POST /app/installations/{id}/access_tokens` (1 h, cached).
 */
export interface GitHubAppConfig {
  /** App ID (or Client ID) from the app's settings page. */
  appId: string;
  /** The app's private key (.pem as downloaded: PKCS#1 or PKCS#8; literal "\n" sequences are accepted). */
  privateKey: string;
}

/** What the editor asks GitHub for, per repo (least privilege). */
export const INSTALLATION_PERMISSIONS = { contents: "write", checks: "read", metadata: "read" } as const;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type CryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

const API = "https://api.github.com";
/** Renew tokens this long before GitHub expires them. */
const TOKEN_MARGIN_MS = 5 * 60_000;
/** App JWTs may live at most 10 minutes; we use 9 and backdate by 60 s for clock drift (GitHub's advice). */
const JWT_TTL_S = 9 * 60;

export interface GitHubAppAuth {
  /** Installation token for one repo; throws GitHubError "not_installed" when the app is not installed there. */
  tokenFor(owner: string, repo: string): Promise<string>;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

/** DER length bytes. */
function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}
const der = (tag: number, body: Uint8Array) => Uint8Array.from([tag, ...derLength(body.length), ...body]);

/** Wraps a PKCS#1 RSAPrivateKey in a PKCS#8 PrivateKeyInfo (WebCrypto only imports PKCS#8). */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = Uint8Array.from([0x02, 0x01, 0x00]);
  // AlgorithmIdentifier { rsaEncryption (1.2.840.113549.1.1.1), NULL }
  const algorithm = Uint8Array.from([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);
  const key = der(0x04, pkcs1);
  return der(0x30, Uint8Array.from([...version, ...algorithm, ...key]));
}

/** Imports the app's private key from PEM (PKCS#1 "RSA PRIVATE KEY" or PKCS#8 "PRIVATE KEY"). */
export async function importAppKey(pem: string): Promise<CryptoKey> {
  const text = pem.replace(/\\n/g, "\n").trim();
  const pkcs1 = /BEGIN RSA PRIVATE KEY/.test(text);
  const body = text.replace(/-----(BEGIN|END)[^-]*-----/g, "").replace(/\s+/g, "");
  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("GitHub App private key is not a PEM key");
  }
  const pkcs8 = pkcs1 ? pkcs1ToPkcs8(raw) : raw;
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new Error("GitHub App private key could not be imported (expected an RSA key in PEM format)");
  }
}

/** Signed app JWT: `iss` = app id, valid from now − 60 s for 9 minutes. */
export async function appJwt(appId: string, key: CryptoKey, nowMs: number): Promise<string> {
  const iat = Math.floor(nowMs / 1000) - 60;
  const input = `${b64urlJson({ alg: "RS256", typ: "JWT" })}.${b64urlJson({ iat, exp: iat + 60 + JWT_TTL_S, iss: appId })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

export function createAppAuth(
  cfg: GitHubAppConfig,
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
  now: () => number = Date.now,
): GitHubAppAuth {
  let key: Promise<CryptoKey> | null = null;
  let jwt: { value: string; until: number } | null = null;
  const tokens = new Map<string, { token: string; until: number }>();

  const appToken = async () => {
    const t = now();
    if (jwt && jwt.until > t) return jwt.value;
    key ??= importAppKey(cfg.privateKey);
    const value = await appJwt(cfg.appId, await key, t);
    jwt = { value, until: t + (JWT_TTL_S - 60) * 1000 };
    return value;
  };

  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await appToken()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "inzenirji-editor",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 404) throw new GitHubError("not_installed", 404, `GitHub App ${method} ${path}`);
    if (res.status === 401 || res.status === 403)
      throw new GitHubError("unauthorized", res.status, `GitHub App ${method} ${path}`);
    if (!res.ok) throw new GitHubError("upstream", res.status, `GitHub App ${method} ${path}`);
    return (await res.json()) as T;
  };

  return {
    async tokenFor(owner, repo) {
      const id = `${owner}/${repo}`.toLowerCase();
      const cached = tokens.get(id);
      if (cached && cached.until > now()) return cached.token;
      const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
      const installation = await call<{ id: number }>("GET", `${path}/installation`);
      const res = await call<{ token: string; expires_at: string }>(
        "POST",
        `/app/installations/${installation.id}/access_tokens`,
        { repositories: [repo], permissions: INSTALLATION_PERMISSIONS },
      );
      const expires = Date.parse(res.expires_at);
      tokens.set(id, {
        token: res.token,
        until: (Number.isFinite(expires) ? expires : now() + 60 * 60_000) - TOKEN_MARGIN_MS,
      });
      return res.token;
    },
  };
}

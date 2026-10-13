import type { Role } from "@inzenirji/shared";
import { parseEmbedToWidget } from "@inzenirji/shared/embed-protocol";
import { useEffect, useRef, useState } from "preact/hooks";
import { type AuthApi, createAuthApi } from "./api.ts";
import { type Lang, type MessageKey, t } from "./i18n.ts";
import type { WidgetParams } from "./params.ts";
import { postToParent } from "./parent.ts";
import { createSessionStore, type SessionStore } from "./session-store.ts";

export interface AppDeps {
  api: AuthApi;
  store: SessionStore;
  /** The window that receives postMessage from the embed script; `parent` is the client page. */
  win: Pick<Window, "addEventListener" | "removeEventListener" | "parent">;
}

type View =
  | { kind: "checking" }
  | { kind: "signingIn" }
  | { kind: "signedOut"; notice?: MessageKey }
  | { kind: "linkSent" }
  | { kind: "signedIn"; email: string; role: Role; token: string };

const defaultDeps = (): AppDeps => ({ api: createAuthApi(), store: createSessionStore(), win: window });

/** Maps a failed API result to the message shown to the user. */
function noticeFor(result: { status: number; error: string }): MessageKey {
  if (result.status === 0) return "networkError";
  if (result.status === 429) return "rateLimited";
  if (result.status === 401 || result.error === "invalid_token") return "linkInvalid";
  return "networkError";
}

export function App(props: { params: WidgetParams; deps?: AppDeps }) {
  const { params } = props;
  // Created once per mounted app: a new object per render would re-run the auth effect on every render.
  const [deps] = useState<AppDeps>(() => props.deps ?? defaultDeps());
  const { siteId, parentOrigin, lang } = params;
  const [view, setView] = useState<View>(() =>
    siteId && deps.store.load(siteId) ? { kind: "checking" } : { kind: "signedOut" },
  );
  // Only the latest auth operation may change the view (an e-mail link can arrive while the stored
  // session is still being checked).
  const op = useRef(0);

  useEffect(() => {
    if (!siteId) return;
    postToParent("widget:ready", parentOrigin);

    /**
     * Verifies the stored session (if any). `failNotice` is shown when there is no usable session, e.g. after a
     * refused e-mail link; an owner who is still signed in and re-opens an old link simply stays signed in.
     */
    const checkStored = (failNotice?: MessageKey) => {
      const stored = deps.store.load(siteId);
      if (!stored) {
        setView({ kind: "signedOut", ...(failNotice ? { notice: failNotice } : {}) });
        return;
      }
      const mine = ++op.current;
      setView({ kind: "checking" });
      void deps.api.me(siteId, stored.token).then((res) => {
        if (mine !== op.current) return;
        if (res.ok) {
          setView({ kind: "signedIn", email: res.value.email, role: res.value.role, token: stored.token });
          return;
        }
        if (res.status === 401 || res.status === 403) deps.store.clear(siteId);
        const notice = failNotice ?? (res.status === 0 ? "networkError" : undefined);
        setView({ kind: "signedOut", ...(notice ? { notice } : {}) });
      });
    };
    if (deps.store.load(siteId)) checkStored();

    const onMessage = (event: MessageEvent) => {
      if (!parentOrigin || event.source !== deps.win.parent || event.origin !== parentOrigin) return;
      const message = parseEmbedToWidget(event.data);
      if (!message) return;
      const mine = ++op.current;
      setView({ kind: "signingIn" });
      void deps.api.exchange(siteId, message.token).then((res) => {
        if (mine !== op.current) return;
        if (res.ok) {
          deps.store.save(siteId, { token: res.value.sessionToken, expiresAt: res.value.expiresAt });
          setView({
            kind: "signedIn",
            email: res.value.email,
            role: res.value.role,
            token: res.value.sessionToken,
          });
        } else {
          checkStored(noticeFor(res));
        }
      });
    };
    deps.win.addEventListener("message", onMessage as EventListener);
    return () => deps.win.removeEventListener("message", onMessage as EventListener);
  }, [siteId, parentOrigin, deps]);

  const logout = (token: string) => {
    if (!siteId) return;
    op.current++;
    deps.store.clear(siteId);
    setView({ kind: "signedOut" });
    void deps.api.logout(token);
  };

  return (
    <div class="shell">
      <header class="header">
        <div>
          <h1>{t(lang, "title")}</h1>
          {siteId && <p class="site">{siteId}</p>}
        </div>
        <button type="button" class="button" onClick={() => postToParent("widget:close", parentOrigin)}>
          {t(lang, "close")}
        </button>
      </header>
      <main class="main">
        {!siteId ? (
          <p role="alert" class="error">
            {t(lang, "invalidSite")}
          </p>
        ) : (
          <Body lang={lang} siteId={siteId} view={view} setView={setView} api={deps.api} onLogout={logout} />
        )}
      </main>
    </div>
  );
}

function Body(props: {
  lang: Lang;
  siteId: string;
  view: View;
  setView: (v: View) => void;
  api: AuthApi;
  onLogout: (token: string) => void;
}) {
  const { lang, view } = props;
  switch (view.kind) {
    case "checking":
    case "signingIn":
      return (
        <p class="muted" role="status">
          {t(lang, view.kind === "checking" ? "checking" : "signingIn")}
        </p>
      );
    case "linkSent":
      return (
        <section aria-labelledby="sent-title">
          <h2 id="sent-title">{t(lang, "linkSentTitle")}</h2>
          <p role="status">{t(lang, "linkSent")}</p>
          <button type="button" class="link" onClick={() => props.setView({ kind: "signedOut" })}>
            {t(lang, "useAnotherEmail")}
          </button>
        </section>
      );
    case "signedOut":
      return <LoginForm {...props} notice={view.notice} />;
    case "signedIn":
      return (
        <section>
          <p class="who">
            {t(lang, "signedInAs")} <strong>{view.email}</strong>
          </p>
          <p>{t(lang, "subtitle")}</p>
          <p class="muted">{t(lang, "comingSoon")}</p>
          <button type="button" class="button" onClick={() => props.onLogout(view.token)}>
            {t(lang, "logout")}
          </button>
        </section>
      );
  }
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function LoginForm(props: {
  lang: Lang;
  siteId: string;
  api: AuthApi;
  setView: (v: View) => void;
  notice: MessageKey | undefined;
}) {
  const { lang } = props;
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<MessageKey | undefined>(props.notice);
  // The form can stay mounted while the view changes (e.g. a refused login link arrives while it is shown),
  // so a new notice from the parent must replace the current message.
  useEffect(() => setError(props.notice), [props.notice]);

  const submit = async (e: Event) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_SHAPE.test(value)) {
      setError("invalidEmail");
      return;
    }
    setSending(true);
    setError(undefined);
    const res = await props.api.requestLink(props.siteId, value);
    setSending(false);
    if (res.ok) props.setView({ kind: "linkSent" });
    else setError(res.status === 400 ? "invalidEmail" : noticeFor(res));
  };

  return (
    <form class="login" onSubmit={submit} noValidate aria-labelledby="login-title">
      <h2 id="login-title">{t(lang, "loginTitle")}</h2>
      <p>{t(lang, "loginIntro")}</p>
      <label for="email">{t(lang, "emailLabel")}</label>
      <input
        id="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        aria-invalid={error === "invalidEmail"}
        aria-describedby={error ? "login-error" : undefined}
        required
      />
      {error && (
        <p id="login-error" role="alert" class="error">
          {t(lang, error)}
        </p>
      )}
      <button type="submit" class="button primary" disabled={sending}>
        {t(lang, sending ? "sending" : "sendLink")}
      </button>
    </form>
  );
}

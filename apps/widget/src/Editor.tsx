import { useEffect, useRef, useState } from "preact/hooks";
import type { ApiResult } from "./api.ts";
import { type Lang, type MessageKey, t } from "./i18n.ts";
import { formatCents, type SiteStatus, type SitesApi } from "./sites-api.ts";

/** Polling interval for the test site build while it is being prepared. */
export const STATUS_POLL_MS = 10_000;

type ChatItem =
  | { id: number; from: "you"; text: string }
  | { id: number; from: "editor"; text: string; priceCents?: number; changed?: boolean; escalated?: boolean }
  | { id: number; from: "notice"; key: MessageKey; tone: "info" | "error" };

/** ChatItem without its id (distributes over the union). */
type NewChatItem = ChatItem extends infer T ? (T extends ChatItem ? Omit<T, "id"> : never) : never;

type Pending = "publish" | "undo" | "discard";

/** Maps API errors of the sites routes to a message. 401 means the session ended (handled by the caller). */
function errorKey(res: { status: number; error: string }): MessageKey {
  if (res.status === 0) return "networkError";
  if (res.error === "agent_unavailable") return "errAgentUnavailable";
  if (res.error === "site_not_connected") return "errNotConnected";
  if (res.error === "conflict") return "errConflict";
  if (res.error === "nothing_to_undo") return "nothingToUndo";
  if (res.status === 429) return "rateLimited";
  if (res.error === "github_unavailable") return "errGithub";
  return "networkError";
}

export function Editor(props: {
  lang: Lang;
  email: string;
  api: SitesApi;
  onLogout: () => void;
  /** Called when the API says the session is no longer valid. */
  onSessionEnded: () => void;
}) {
  const { lang, api } = props;
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);

  const add = (item: NewChatItem) =>
    setItems((list) => [...list, { ...item, id: nextId.current++ } as ChatItem]);

  /** Shared handling of failed calls: 401 ends the session, everything else becomes a notice. */
  const failed = (res: { status: number; error: string }) => {
    if (res.status === 401) {
      props.onSessionEnded();
      return;
    }
    add({ from: "notice", key: errorKey(res), tone: "error" });
  };

  const refreshStatus = async () => {
    const res = await api.status();
    if (res.ok) setStatus(res.value);
    else if (res.status === 401) props.onSessionEnded();
    else if (res.error === "site_not_connected")
      add({ from: "notice", key: "errNotConnected", tone: "error" });
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  // While the test site is being rebuilt, poll until it is ready.
  useEffect(() => {
    if (status?.previewBuild !== "pending") return;
    const timer = setTimeout(() => void refreshStatus(), STATUS_POLL_MS);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, busy]);

  const send = async (e?: Event) => {
    e?.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setDraft("");
    add({ from: "you", text: message });
    setBusy(true);
    const res = await api.edit(message);
    setBusy(false);
    if (!res.ok) {
      failed(res);
      return;
    }
    add({
      from: "editor",
      text: res.value.reply,
      priceCents: res.value.priceCents,
      changed: res.value.changed,
      escalated: res.value.escalated,
    });
    if (res.value.changed)
      setStatus((s) => (s ? { ...s, previewBuild: "pending", unpublished: Math.max(1, s.unpublished) } : s));
    void refreshStatus();
  };

  const runAction = async (action: Pending) => {
    setConfirm(null);
    setBusy(true);
    const res: ApiResult<unknown> =
      action === "publish" ? await api.publish() : action === "undo" ? await api.undo() : await api.discard();
    setBusy(false);
    if (!res.ok) {
      failed(res);
      return;
    }
    if (action === "publish") {
      const published = (res.value as { published: boolean }).published;
      add({ from: "notice", key: published ? "published" : "nothingToPublish", tone: "info" });
    } else {
      add({ from: "notice", key: action === "undo" ? "undone" : "discarded", tone: "info" });
    }
    void refreshStatus();
  };

  const buildLabel: Record<SiteStatus["previewBuild"], MessageKey | null> = {
    pending: "buildPending",
    success: "buildReady",
    failure: "buildFailed",
    unknown: null,
  };
  const build = status ? buildLabel[status.previewBuild] : null;

  return (
    <div class="editor-view">
      <section class="status" aria-label={t(lang, "testSite")}>
        <div class="status-row">
          {status ? (
            <span>
              <a href={status.previewUrl} target="_blank" rel="noopener">
                {t(lang, "testSite")}
              </a>
              {build && <span class={`badge badge-${status.previewBuild}`}> · {t(lang, build)}</span>}
              {" · "}
              <a href={status.liveUrl} target="_blank" rel="noopener">
                {t(lang, "liveSite")}
              </a>
            </span>
          ) : (
            <span class="muted">…</span>
          )}
          <span class="who">
            {props.email}{" "}
            <button type="button" class="link" onClick={props.onLogout}>
              {t(lang, "logout")}
            </button>
          </span>
        </div>
        {status && (
          <div class="status-row">
            <span class="muted">
              {status.unpublished > 0
                ? `${t(lang, "unpublished")}: ${status.unpublished}`
                : t(lang, "noUnpublished")}
            </span>
            {confirm ? (
              <span class="actions">
                <button type="button" class="button primary" onClick={() => void runAction(confirm)}>
                  {t(
                    lang,
                    confirm === "publish"
                      ? "confirmPublish"
                      : confirm === "undo"
                        ? "confirmUndo"
                        : "confirmDiscard",
                  )}
                </button>
                <button type="button" class="button" onClick={() => setConfirm(null)}>
                  {t(lang, "cancel")}
                </button>
              </span>
            ) : (
              <span class="actions">
                <button
                  type="button"
                  class="button primary"
                  disabled={busy || status.unpublished === 0}
                  onClick={() => setConfirm("publish")}
                >
                  {t(lang, "publish")}
                </button>
                {status.unpublished > 0 && (
                  <button type="button" class="button" disabled={busy} onClick={() => setConfirm("discard")}>
                    {t(lang, "discard")}
                  </button>
                )}
                <button type="button" class="button" disabled={busy} onClick={() => setConfirm("undo")}>
                  {t(lang, "undo")}
                </button>
              </span>
            )}
          </div>
        )}
      </section>

      <div class="chat" ref={logRef} aria-live="polite">
        {items.length === 0 && <p class="muted intro">{t(lang, "editorIntro")}</p>}
        {items.map((item) =>
          item.from === "notice" ? (
            <p key={item.id} class={`notice ${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>
              {t(lang, item.key)}
            </p>
          ) : (
            <div key={item.id} class={`bubble ${item.from}`}>
              <span class="sender">{t(lang, item.from === "you" ? "you" : "editor")}</span>
              <p>{item.text}</p>
              {item.from === "editor" && (
                <span class="meta">
                  {item.escalated
                    ? `${t(lang, "escalated")} · `
                    : item.changed === false
                      ? `${t(lang, "noChange")} · `
                      : ""}
                  {t(lang, "cost")}: {formatCents(item.priceCents ?? 0)}
                </span>
              )}
            </div>
          ),
        )}
        {busy && (
          <p class="muted" role="status">
            {t(lang, "working")}
          </p>
        )}
      </div>

      <form class="composer" onSubmit={send}>
        <label for="message" class="visually-hidden">
          {t(lang, "messageLabel")}
        </label>
        <textarea
          id="message"
          rows={2}
          value={draft}
          placeholder={t(lang, "messageLabel")}
          maxLength={2000}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) void send(e);
          }}
          disabled={busy}
        />
        <button type="submit" class="button primary" disabled={busy || !draft.trim()}>
          {t(lang, "send")}
        </button>
      </form>
    </div>
  );
}

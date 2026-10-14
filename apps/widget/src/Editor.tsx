import { useEffect, useRef, useState } from "preact/hooks";
import type { ApiResult } from "./api.ts";
import { type Lang, type MessageKey, t } from "./i18n.ts";
import { type PreparedUpload, type PrepareUpload, prepareUpload } from "./image-resize.ts";
import { type BuildState, formatCents, type SiteStatus, type SitesApi } from "./sites-api.ts";

/** Images per message (the API allows the same). */
export const MAX_ATTACHMENTS = 3;

interface Attachment extends PreparedUpload {
  id: number;
  /** Object URL for the thumbnail. */
  preview: string;
}

/** Polling interval while a site is being rebuilt. */
export const STATUS_POLL_MS = 5_000;
/** After this long a rebuild is marked as slower than usual (it usually takes 1–2 minutes). */
export const DEPLOY_SLOW_MS = 5 * 60_000;

type Phase = "deploying" | "ready" | "failed" | "unknown" | "discarded";

/**
 * A change on its way to a site: the editor reply (test site) or a publish/undo (live site). It stays
 * "deploying" until the site's build for that commit has finished, so "done" is only said when it is visible.
 */
export interface Deploy {
  target: "preview" | "live";
  sha: string | null;
  phase: Phase;
  startedAt: number;
}

type ChatItem =
  | { id: number; from: "you"; text: string; previews?: string[] }
  | {
      id: number;
      from: "editor";
      text: string;
      priceCents?: number;
      changed?: boolean;
      escalated?: boolean;
      deploy?: Deploy;
    }
  | { id: number; from: "action"; kind: "publish" | "undo"; deploy: Deploy }
  | { id: number; from: "notice"; key: MessageKey; tone: "info" | "error" };

const phaseOf: Record<BuildState, Phase> = {
  pending: "deploying",
  success: "ready",
  failure: "failed",
  unknown: "unknown",
};

const deployOf = (item: ChatItem): Deploy | undefined =>
  item.from === "editor" || item.from === "action" ? item.deploy : undefined;

const withPhase = (item: ChatItem, phase: Phase): ChatItem => {
  const d = deployOf(item);
  return d ? ({ ...item, deploy: { ...d, phase } } as ChatItem) : item;
};

/**
 * Resolves changes that are still deploying from a status response. Per site, the newest deploying change decides:
 * only when the site is built from its commit does its build state count (an older status answer, e.g. one that
 * was already on its way before the change was committed, must not say "done" too early). Older changes on the
 * same site are contained in the newer commit, so they take the same result.
 */
export function applyStatus(items: ChatItem[], s: SiteStatus): ChatItem[] {
  let next = items;
  for (const target of ["preview", "live"] as const) {
    const siteSha = target === "preview" ? s.previewSha : s.liveSha;
    const build = target === "preview" ? s.previewBuild : s.liveBuild;
    const waiting = next.filter((i) => deployOf(i)?.target === target && deployOf(i)?.phase === "deploying");
    const last = waiting[waiting.length - 1];
    const latest = last ? deployOf(last) : undefined;
    if (!latest || (latest.sha !== null && latest.sha !== siteSha)) continue;
    const phase = phaseOf[build];
    if (phase === "deploying") continue;
    const ids = new Set(waiting.map((i) => i.id));
    next = next.map((i) => (ids.has(i.id) ? withPhase(i, phase) : i));
  }
  return next;
}

const elapsed = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;
};

/** ChatItem without its id (distributes over the union). */
type NewChatItem = ChatItem extends infer T ? (T extends ChatItem ? Omit<T, "id"> : never) : never;

type Pending = "publish" | "undo" | "discard";

/** Maps API errors of the sites routes to a message. 401 means the session ended (handled by the caller). */
function errorKey(res: { status: number; error: string }): MessageKey {
  if (res.status === 0) return "networkError";
  if (res.error === "agent_unavailable") return "errAgentUnavailable";
  if (["site_not_connected", "site_schema_invalid", "github_not_installed"].includes(res.error))
    return "errNotConnected";
  if (res.error === "conflict") return "errConflict";
  if (res.error === "nothing_to_undo") return "nothingToUndo";
  if (res.error === "image_type") return "errImageType";
  if (res.error === "image_too_large") return "errImageTooLarge";
  if (res.error === "too_many_images") return "imagesMax";
  if (res.error === "uploads_not_supported") return "errUploadsNotSupported";
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
  /** Resizes a picked image (injectable for tests; the browser one needs canvas). */
  prepareUpload?: PrepareUpload;
}) {
  const { lang, api } = props;
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
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
    if (res.ok) {
      setStatus(res.value);
      setItems((list) => applyStatus(list, res.value));
    } else if (res.status === 401) props.onSessionEnded();
    else if (res.error === "site_not_connected")
      add({ from: "notice", key: "errNotConnected", tone: "error" });
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  const deploying = items.some((i) => deployOf(i)?.phase === "deploying");

  // While a site is being rebuilt (or a change is on its way), poll until it is done.
  useEffect(() => {
    if (!deploying && status?.previewBuild !== "pending" && status?.liveBuild !== "pending") return;
    const timer = setTimeout(() => void refreshStatus(), STATUS_POLL_MS);
    return () => clearTimeout(timer);
  }, [status, deploying]);

  // Clock for the elapsed time next to a change that is deploying.
  useEffect(() => {
    if (!deploying) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deploying]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, busy]);

  const pickImages = async (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (fileRef.current) fileRef.current.value = ""; // allow picking the same file again
    if (!files.length) return;
    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      add({ from: "notice", key: "imagesMax", tone: "error" });
      return;
    }
    setPreparing(true);
    const prepare = props.prepareUpload ?? prepareUpload;
    for (const file of files) {
      try {
        const up = await prepare(file);
        setAttachments((a) => [...a, { ...up, id: nextId.current++, preview: URL.createObjectURL(up.blob) }]);
      } catch {
        add({ from: "notice", key: "imageRead", tone: "error" });
      }
    }
    setPreparing(false);
  };

  const removeAttachment = (id: number) =>
    setAttachments((a) => {
      const gone = a.find((x) => x.id === id);
      if (gone) URL.revokeObjectURL(gone.preview);
      return a.filter((x) => x.id !== id);
    });

  const send = async (e?: Event) => {
    e?.preventDefault();
    const message = draft.trim();
    if (busy || preparing) return;
    if (!message) {
      if (attachments.length) add({ from: "notice", key: "imageHint", tone: "info" });
      return;
    }
    const sent = attachments;
    setDraft("");
    setAttachments([]);
    add({ from: "you", text: message, ...(sent.length ? { previews: sent.map((a) => a.preview) } : {}) });
    setBusy(true);
    const res = await api.edit(
      message,
      sent.map(({ blob, name }) => ({ blob, name })),
    );
    setBusy(false);
    if (!res.ok) {
      failed(res);
      return;
    }
    const startedAt = Date.now();
    setNow(startedAt);
    add({
      from: "editor",
      text: res.value.reply,
      priceCents: res.value.priceCents,
      changed: res.value.changed,
      escalated: res.value.escalated,
      ...(res.value.changed
        ? { deploy: { target: "preview", sha: res.value.commitSha ?? null, phase: "deploying", startedAt } }
        : {}),
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
    const startedAt = Date.now();
    setNow(startedAt);
    if (action === "discard") {
      // The test site goes back to the live content: changes still on their way will not arrive.
      setItems((list) =>
        list.map((i) =>
          deployOf(i)?.target === "preview" && deployOf(i)?.phase === "deploying"
            ? withPhase(i, "discarded")
            : i,
        ),
      );
      add({ from: "notice", key: "discarded", tone: "info" });
    } else {
      const value = res.value as { published?: boolean; sha?: string | null };
      if (action === "publish" && !value.published) {
        add({ from: "notice", key: "nothingToPublish", tone: "info" });
      } else {
        add({
          from: "action",
          kind: action,
          deploy: { target: "live", sha: value.sha ?? null, phase: "deploying", startedAt },
        });
      }
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
          ) : item.from === "action" ? (
            <DeployLine
              key={item.id}
              lang={lang}
              deploy={item.deploy}
              kind={item.kind}
              now={now}
              url={status?.liveUrl}
            />
          ) : (
            <div key={item.id} class={`bubble ${item.from}`}>
              <span class="sender">{t(lang, item.from === "you" ? "you" : "editor")}</span>
              {item.from === "you" && item.previews && (
                <div class="thumbs">
                  {item.previews.map((src) => (
                    <img key={src} src={src} alt="" />
                  ))}
                </div>
              )}
              <p>{item.text}</p>
              {item.from === "editor" && item.deploy && (
                <DeployLine lang={lang} deploy={item.deploy} kind="edit" now={now} url={status?.previewUrl} />
              )}
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
        {(attachments.length > 0 || preparing) && (
          <div class="attachments">
            {attachments.map((a) => (
              <span class="attachment" key={a.id}>
                <img src={a.preview} alt="" />
                <button
                  type="button"
                  class="remove"
                  aria-label={t(lang, "removeImage")}
                  onClick={() => removeAttachment(a.id)}
                >
                  ×
                </button>
              </span>
            ))}
            {preparing && <span class="spinner" aria-hidden="true" />}
          </div>
        )}
        <div class="composer-row">
          <input
            ref={fileRef}
            id="image-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            class="visually-hidden"
            onChange={(e) => void pickImages((e.target as HTMLInputElement).files)}
            disabled={busy || attachments.length >= MAX_ATTACHMENTS}
          />
          <label
            for="image-input"
            class={`button attach${busy || attachments.length >= MAX_ATTACHMENTS ? " disabled" : ""}`}
            title={t(lang, "attachImage")}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"
              />
            </svg>
            <span class="visually-hidden">{t(lang, "attachImage")}</span>
          </label>
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
          <button type="submit" class="button primary" disabled={busy || preparing || !draft.trim()}>
            {t(lang, "send")}
          </button>
        </div>
      </form>
    </div>
  );
}

const DEPLOY_TEXT: Record<"edit" | "publish" | "undo", Record<Phase, MessageKey>> = {
  edit: {
    deploying: "previewDeploying",
    ready: "previewReady",
    failed: "previewFailed",
    unknown: "previewUnknown",
    discarded: "previewDiscarded",
  },
  publish: {
    deploying: "publishDeploying",
    ready: "publishReady",
    failed: "liveFailed",
    unknown: "liveUnknown",
    discarded: "liveUnknown",
  },
  undo: {
    deploying: "undoDeploying",
    ready: "undoReady",
    failed: "liveFailed",
    unknown: "liveUnknown",
    discarded: "liveUnknown",
  },
};

/** Progress of a change on its way to a site: spinner and elapsed time, then done (with a link) or a problem. */
function DeployLine(props: {
  lang: Lang;
  deploy: Deploy;
  kind: "edit" | "publish" | "undo";
  now: number;
  url: string | undefined;
}) {
  const { lang, deploy, kind } = props;
  const label = t(lang, DEPLOY_TEXT[kind][deploy.phase]);
  const took = props.now - deploy.startedAt;
  const linkKey: MessageKey = deploy.target === "preview" ? "openPreview" : "openLive";
  return (
    <p class={`deploy deploy-${deploy.phase}`} role={deploy.phase === "failed" ? "alert" : "status"}>
      {deploy.phase === "deploying" && <span class="spinner" aria-hidden="true" />}
      {deploy.phase === "ready" && (
        <span class="check" aria-hidden="true">
          ✓
        </span>
      )}
      <span>
        {label}
        {deploy.phase === "deploying" && (
          <span class="muted">
            {" "}
            {elapsed(took)}
            {took >= DEPLOY_SLOW_MS ? ` · ${t(lang, "deploySlow")}` : ""}
          </span>
        )}
        {deploy.phase === "ready" && props.url && (
          <>
            {" "}
            <a href={props.url} target="_blank" rel="noopener">
              {t(lang, linkKey)}
            </a>
          </>
        )}
      </span>
    </p>
  );
}

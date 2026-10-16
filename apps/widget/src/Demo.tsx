import { DEMO_CONTENT_TYPE, demoContentMessage } from "@inzenirji/shared/embed-protocol";
import { useEffect, useRef, useState } from "preact/hooks";
import { createDemoApi, type DemoApi, type DemoConfig, type DemoState, demoTokenStore } from "./demo-api.ts";
import { type PreparedUpload, type PrepareUpload, prepareUpload } from "./image-resize.ts";

/**
 * Public editor demo (TASK-016, ADR-015): the same chat as the real editor, but it edits a private sandbox copy
 * of the demo site. Every result is sent to the demo page (parent), which renders it at once. Slovenian only.
 */

/** Same booking page as inzenirji.si (Google Calendar appointment schedule). */
export const BOOKING_URL = "https://calendar.app.google/Mti4dttj8z2eH5MAA";

export const SUGGESTIONS = [
  "Dodaj na meni ričet s klobaso za 8,90 €",
  "V nedeljo smo zaprti",
  "Dodaj obvestilo: ta teden dnevna kosila po 9,90 €",
  "Bučna juha naj stane 6,50 €",
  "Na prvi strani napiši, da imamo tudi vrt za 40 gostov",
];

const T = {
  title: "Preizkusite urejevalnik",
  intro:
    "To je izmišljena Gostilna Pri Lipi. Napišite, kaj želite spremeniti, kot bi pisali sodelavcu. Spremembo boste videli na strani v nekaj sekundah. Vidite jo samo vi.",
  starting: "Pripravljam vašo kopijo strani …",
  captcha: "Še hitro preverjanje, da niste robot:",
  working: "Urejam …",
  you: "Vi",
  editor: "Urejevalnik",
  send: "Pošlji",
  placeholder: "Npr. Dodaj sladico dneva: palačinke 4,50 €",
  counter: (used: number, limit: number) => `Spremembe: ${used} od ${limit}`,
  reset: "Začni znova",
  resetDone: "Stran je spet takšna kot na začetku.",
  publish: "Objavi v živo",
  publishNote:
    "Na pravi strani bi zdaj ta gumb vaše spremembe objavil v živo, v 1–2 minutah. Pred tem jih vedno vidite na testni strani, zato ni nobenega tveganja.",
  emailTitle: "Vam je všeč? Dobite še 10 sprememb.",
  emailIntro:
    "Vpišite e-naslov in nadaljujte. Poslali vam bomo kratko predstavitev, kako bi tak urejevalnik deloval na vaši strani. Brez oglasov in brez obveznosti.",
  emailLabel: "E-naslov",
  websiteLabel: "Vaša spletna stran (neobvezno)",
  emailSubmit: "Nadaljuj",
  emailInvalid: "Vpišite veljaven e-naslov.",
  emailThanks: "Hvala! Imate še 10 sprememb.",
  consent: "Z vpisom se strinjate, da vas Inženirji.si kontaktira glede vaše spletne strani.",
  limitDone:
    "To so bile vse spremembe demota. Želite tak urejevalnik na svoji strani? Dogovorimo se za kratek klic.",
  cta: "Rezervirajte uvodni klic",
  ctaLead: "Želite to na svoji strani?",
  paused: "Demo je danes zelo obiskan in smo ga začasno ustavili. Poskusite jutri ali nas pokličite.",
  rateLimited: "Preveč sprememb v kratkem času. Počakajte nekaj minut.",
  expired: "Vaša kopija strani je potekla. Pripravljam novo …",
  network: "Povezava ni uspela. Poskusite znova.",
  unavailable: "Demo trenutno ne deluje. Poskusite kasneje.",
  captchaFailed: "Preverjanje ni uspelo. Osvežite stran in poskusite znova.",
  noChange: "Ni sprememb.",
  attach: "Dodaj sliko",
  removeImage: "Odstrani sliko",
  imagesMax: "Največ 3 slike na sporočilo.",
  imageRead: "Te slike ni bilo mogoče prebrati. Poskusite z drugo (JPG, PNG).",
  imageHint: "Napišite še, kam naj gre slika, npr. »To sliko daj na naslovnico«.",
  imageType: "Ta vrsta slike ni podprta. Uporabite JPG, PNG ali WebP.",
  imageTooLarge: "Slika je prevelika.",
} as const;

type Item =
  | { id: number; from: "you" | "editor"; text: string; changed?: boolean; previews?: string[] }
  | { id: number; from: "notice"; text: string; tone: "info" | "error" };

type Phase = "starting" | "captcha" | "ready" | "failed";

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: Record<string, unknown>): string;
    };
  }
}

/** Loads Cloudflare Turnstile once and renders it into `el`; calls back with the token. */
function renderTurnstile(
  el: HTMLElement,
  siteKey: string,
  onToken: (t: string) => void,
  onError: () => void,
) {
  const draw = () =>
    window.turnstile?.render(el, {
      sitekey: siteKey,
      language: "sl",
      appearance: "interaction-only",
      callback: onToken,
      "error-callback": onError,
    });
  if (window.turnstile) {
    draw();
    return;
  }
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  s.async = true;
  s.onload = draw;
  s.onerror = onError;
  document.head.appendChild(s);
}

export interface DemoProps {
  parentOrigin: string | null;
  api?: DemoApi;
  /** Sends a message to the demo page (injectable for tests). */
  post?: (message: unknown, origin: string) => void;
  tokens?: typeof demoTokenStore;
  /** Resizes a picked image (injectable for tests; the browser one needs canvas). */
  prepareUpload?: PrepareUpload;
}

/** Images per message (the API allows the same). */
export const MAX_DEMO_IMAGES = 3;

type Attachment = PreparedUpload & { id: number; preview: string };

export function Demo(props: DemoProps) {
  const [api] = useState(() => props.api ?? createDemoApi());
  const tokens = props.tokens ?? demoTokenStore;
  const [phase, setPhase] = useState<Phase>("starting");
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [state, setState] = useState<DemoState | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [askEmail, setAskEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [emailError, setEmailError] = useState(false);
  const [done, setDone] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const token = useRef<string | null>(null);
  const nextId = useRef(1);
  const captchaRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  type NewItem = Item extends infer I ? (I extends Item ? Omit<I, "id"> : never) : never;
  const add = (item: NewItem) => setItems((list) => [...list, { ...item, id: nextId.current++ } as Item]);
  const notice = (text: string, tone: "info" | "error" = "info") => add({ from: "notice", text, tone });

  const show = (s: DemoState, page: string | null) => {
    setState(s);
    const { parentOrigin } = props;
    if (!parentOrigin) return;
    const msg = demoContentMessage(s.content, page);
    if (props.post) props.post(msg, parentOrigin);
    else if (window.parent !== window.self) window.parent.postMessage(msg, parentOrigin);
  };

  const begin = async (captchaToken: string | null) => {
    setPhase("starting");
    const res = await api.start(captchaToken);
    if (!res.ok) {
      setPhase("failed");
      notice(
        res.error === "captcha_failed"
          ? T.captchaFailed
          : res.status === 429
            ? T.rateLimited
            : res.status === 0
              ? T.network
              : T.unavailable,
        "error",
      );
      return;
    }
    token.current = res.value.token;
    tokens.save(res.value.token, res.value.expiresAt);
    setPhase("ready");
    show(res.value, null);
  };

  const startFresh = (cfg: DemoConfig) => {
    tokens.clear();
    token.current = null;
    if (!cfg.turnstileSiteKey) {
      void begin(null);
      return;
    }
    setPhase("captcha");
  };

  // Boot: config, then the stored sandbox or a new one.
  useEffect(() => {
    void (async () => {
      const cfg = await api.config();
      if (!cfg.ok) {
        setPhase("failed");
        notice(cfg.status === 0 ? T.network : T.unavailable, "error");
        return;
      }
      setConfig(cfg.value);
      const stored = tokens.load();
      if (stored) {
        const s = await api.state(stored);
        if (s.ok) {
          token.current = stored;
          setPhase("ready");
          show(s.value, null);
          if (s.value.edits >= s.value.limit) setDone(s.value.emailGiven);
          return;
        }
      }
      startFresh(cfg.value);
    })();
  }, []);

  // Turnstile when the phase asks for it.
  useEffect(() => {
    if (phase !== "captcha" || !config?.turnstileSiteKey || !captchaRef.current) return;
    renderTurnstile(
      captchaRef.current,
      config.turnstileSiteKey,
      (t) => void begin(t),
      () => {
        setPhase("failed");
        notice(T.captchaFailed, "error");
      },
    );
  }, [phase, config]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [items, busy, askEmail]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message && attachments.length) {
      notice(T.imageHint);
      return;
    }
    if (!message || busy || preparing || !token.current || phase !== "ready") return;
    if (state && state.edits >= state.limit) {
      if (state.emailGiven) setDone(true);
      else setAskEmail(true);
      return;
    }
    const sent = attachments;
    setDraft("");
    setAttachments([]);
    add({ from: "you", text: message, ...(sent.length ? { previews: sent.map((a) => a.preview) } : {}) });
    setBusy(true);
    const res = await api.edit(
      token.current,
      message,
      sent.map(({ blob, name }) => ({ blob, name })),
    );
    setBusy(false);
    if (res.ok) {
      add({ from: "editor", text: res.value.reply, changed: res.value.changed });
      show(res.value, res.value.pages[0] ?? null);
      if (res.value.edits >= res.value.limit) {
        if (res.value.emailGiven) setDone(true);
        else setAskEmail(true);
      }
      return;
    }
    if (res.error === "email_required") setAskEmail(true);
    else if (res.error === "demo_limit") setDone(true);
    else if (res.error === "sandbox_expired" && config) {
      notice(T.expired);
      startFresh(config);
    } else if (res.error === "demo_paused") notice(T.paused, "error");
    else if (res.status === 429) notice(T.rateLimited, "error");
    else if (res.error === "image_type") notice(T.imageType, "error");
    else if (res.error === "image_too_large") notice(T.imageTooLarge, "error");
    else if (res.error === "too_many_images") notice(T.imagesMax, "error");
    else notice(res.status === 0 ? T.network : T.unavailable, "error");
  };

  const pickImages = async (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (fileRef.current) fileRef.current.value = "";
    if (!files.length) return;
    if (attachments.length + files.length > MAX_DEMO_IMAGES) {
      notice(T.imagesMax, "error");
      return;
    }
    setPreparing(true);
    const prepare = props.prepareUpload ?? prepareUpload;
    for (const file of files) {
      try {
        const up = await prepare(file);
        setAttachments((a) => [...a, { ...up, id: nextId.current++, preview: URL.createObjectURL(up.blob) }]);
      } catch {
        notice(T.imageRead, "error");
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

  const submitEmail = async (e: Event) => {
    e.preventDefault();
    if (!token.current) return;
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      setEmailError(true);
      return;
    }
    setEmailError(false);
    setBusy(true);
    const res = await api.email(token.current, value, website.trim());
    setBusy(false);
    if (res.ok) {
      setAskEmail(false);
      setState(res.value);
      notice(T.emailThanks);
    } else if (res.error === "invalid_email") setEmailError(true);
    else notice(res.status === 0 ? T.network : T.unavailable, "error");
  };

  const reset = async () => {
    if (!token.current || busy) return;
    setBusy(true);
    const res = await api.reset(token.current);
    setBusy(false);
    if (res.ok) {
      show(res.value, "index");
      notice(T.resetDone);
    } else notice(res.status === 0 ? T.network : T.unavailable, "error");
  };

  const ready = phase === "ready";
  return (
    <div class="shell demo">
      <header class="header">
        <div>
          <h1>{T.title}</h1>
          {state && (
            <p class="site" aria-live="polite">
              {T.counter(state.edits, state.limit)}
            </p>
          )}
        </div>
        {ready && (
          <span class="actions">
            <button type="button" class="button" disabled={busy} onClick={() => notice(T.publishNote)}>
              {T.publish}
            </button>
            <button type="button" class="button" disabled={busy} onClick={() => void reset()}>
              {T.reset}
            </button>
          </span>
        )}
      </header>
      <main class="main">
        <div class="editor-view">
          <div class="chat" ref={logRef} aria-live="polite">
            <p class="muted intro">{T.intro}</p>
            {phase === "starting" && (
              <p class="muted" role="status">
                {T.starting}
              </p>
            )}
            {phase === "captcha" && (
              <div class="captcha">
                <p class="muted">{T.captcha}</p>
                <div ref={captchaRef} />
              </div>
            )}
            {items.map((item) =>
              item.from === "notice" ? (
                <p
                  key={item.id}
                  class={`notice ${item.tone}`}
                  role={item.tone === "error" ? "alert" : "status"}
                >
                  {item.text}
                </p>
              ) : (
                <div key={item.id} class={`bubble ${item.from}`}>
                  <span class="sender">{item.from === "you" ? T.you : T.editor}</span>
                  {item.previews && (
                    <div class="thumbs">
                      {item.previews.map((src) => (
                        <img key={src} src={src} alt="" />
                      ))}
                    </div>
                  )}
                  <p>{item.text}</p>
                  {item.from === "editor" && item.changed === false && <span class="meta">{T.noChange}</span>}
                </div>
              ),
            )}
            {busy && (
              <p class="muted" role="status">
                <span class="spinner" aria-hidden="true" /> {T.working}
              </p>
            )}
            {askEmail && (
              <form class="login demo-email" onSubmit={submitEmail} noValidate>
                <h2>{T.emailTitle}</h2>
                <p>{T.emailIntro}</p>
                <label for="demo-email">{T.emailLabel}</label>
                <input
                  id="demo-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  aria-invalid={emailError}
                  onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                />
                <label for="demo-website">{T.websiteLabel}</label>
                <input
                  id="demo-website"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  value={website}
                  onInput={(e) => setWebsite((e.target as HTMLInputElement).value)}
                />
                {emailError && (
                  <p role="alert" class="error">
                    {T.emailInvalid}
                  </p>
                )}
                <p class="muted small">{T.consent}</p>
                <button type="submit" class="button primary" disabled={busy}>
                  {T.emailSubmit}
                </button>
              </form>
            )}
            {done && (
              <div class="notice info cta">
                <p>{T.limitDone}</p>
                <a class="button primary" href={BOOKING_URL} target="_blank" rel="noopener">
                  {T.cta}
                </a>
              </div>
            )}
          </div>

          {ready && !askEmail && !done && (
            <div class="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" class="chip" disabled={busy} onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            class="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            {(attachments.length > 0 || preparing) && (
              <div class="attachments">
                {attachments.map((a) => (
                  <span class="attachment" key={a.id}>
                    <img src={a.preview} alt="" />
                    <button
                      type="button"
                      class="remove"
                      aria-label={T.removeImage}
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
                id="demo-image-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                multiple
                class="visually-hidden"
                onChange={(e) => void pickImages((e.target as HTMLInputElement).files)}
                disabled={!ready || busy || askEmail || done || attachments.length >= MAX_DEMO_IMAGES}
              />
              <label
                for="demo-image-input"
                class={`button attach${!ready || busy || askEmail || done || attachments.length >= MAX_DEMO_IMAGES ? " disabled" : ""}`}
                title={T.attach}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"
                  />
                </svg>
                <span class="visually-hidden">{T.attach}</span>
              </label>
              <label for="demo-message" class="visually-hidden">
                {T.placeholder}
              </label>
              <textarea
                id="demo-message"
                rows={2}
                value={draft}
                placeholder={T.placeholder}
                maxLength={500}
                onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
                disabled={!ready || busy || askEmail || done}
              />
              <button
                type="submit"
                class="button primary"
                disabled={!ready || busy || preparing || askEmail || done || !draft.trim()}
              >
                {T.send}
              </button>
            </div>
            <span class="muted small estimate">
              {T.ctaLead}{" "}
              <a class="cta-link" href={BOOKING_URL} target="_blank" rel="noopener">
                {T.cta}
              </a>
            </span>
          </form>
        </div>
      </main>
    </div>
  );
}

export { DEMO_CONTENT_TYPE, T as DEMO_TEXT };

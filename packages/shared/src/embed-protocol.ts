/**
 * Messages exchanged between the embed script (client page) and the widget (iframe) via postMessage.
 * Every message carries the protocol version; receivers drop anything that does not parse.
 * Origins are checked by the receiver before parsing (see docs/technical/embed.md).
 *
 * Deliberately dependency-free: the embed script imports this file and must stay under 3 KB gzipped (ADR-002).
 */
export const EMBED_PROTOCOL_VERSION = 1;

export const WIDGET_TO_EMBED_TYPES = ["widget:ready", "widget:close"] as const;
export type WidgetToEmbedType = (typeof WIDGET_TO_EMBED_TYPES)[number];

export interface WidgetToEmbedMessage {
  v: typeof EMBED_PROTOCOL_VERSION;
  type: WidgetToEmbedType;
}

/** Returns the message if it is exactly `{ v, type }` with a known type, otherwise null. */
export function parseWidgetToEmbed(data: unknown): WidgetToEmbedMessage | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  if (keys.length !== 2) return null;
  const { v, type } = data as Record<string, unknown>;
  if (v !== EMBED_PROTOCOL_VERSION) return null;
  if (!(WIDGET_TO_EMBED_TYPES as readonly unknown[]).includes(type)) return null;
  return { v: EMBED_PROTOCOL_VERSION, type: type as WidgetToEmbedType };
}

export function widgetMessage(type: WidgetToEmbedType): WidgetToEmbedMessage {
  return { v: EMBED_PROTOCOL_VERSION, type };
}

/** Login link token: 32 random bytes as base64url (43 chars). Same format as TOKEN_PATTERN in auth.ts. */
export const LOGIN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Message sent from the embed script (parent page) to the widget (iframe). */
export interface EmbedLoginMessage {
  v: typeof EMBED_PROTOCOL_VERSION;
  type: "embed:login";
  /** One-time login token taken from `#login=<token>` on the client's /uredi page. */
  token: string;
}

/** Returns the message if it is exactly `{ v, type: "embed:login", token }` with a well-formed token. */
export function parseEmbedToWidget(data: unknown): EmbedLoginMessage | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  if (Object.keys(data).length !== 3) return null;
  const { v, type, token } = data as Record<string, unknown>;
  if (v !== EMBED_PROTOCOL_VERSION || type !== "embed:login") return null;
  if (typeof token !== "string" || !LOGIN_TOKEN_PATTERN.test(token)) return null;
  return { v: EMBED_PROTOCOL_VERSION, type: "embed:login", token };
}

/** Reads `#login=<token>` from a URL hash; returns the token or null. */
export function loginTokenFromHash(hash: string): string | null {
  const match = /^#login=([A-Za-z0-9_-]{43})$/.exec(hash);
  return match?.[1] ?? null;
}

/** True for an `http:` or `https:` origin string such as "https://hisa-denk.si" (no path). */
export function isHttpOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
  } catch {
    return false;
  }
}

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

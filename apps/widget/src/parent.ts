import { type WidgetToEmbedType, widgetMessage } from "@inzenirji/shared/embed-protocol";

/**
 * Sends a protocol message to the embedding page. Does nothing when there is no parent frame or the
 * parent origin is unknown: we never post with targetOrigin "*".
 */
export function postToParent(
  type: WidgetToEmbedType,
  parentOrigin: string | null,
  win: Pick<Window, "parent"> & { self: unknown } = window,
): boolean {
  if (!parentOrigin || win.parent === win.self) return false;
  win.parent.postMessage(widgetMessage(type), parentOrigin);
  return true;
}

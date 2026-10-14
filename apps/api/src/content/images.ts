/**
 * Images the owner attaches in the chat (TASK-015). The widget already shrinks them; here they are only checked
 * (real JPEG/PNG/WebP by their bytes, not by name or declared type — no SVG, which can carry script), named, and
 * encoded for GitHub and for the model.
 */
export const MAX_IMAGES = 3;
/** Per image, after the widget's resize (it aims for ~200–400 KB). */
export const MAX_IMAGE_BYTES = 1_500_000;

export type ImageKind = "jpg" | "png" | "webp";
export const MEDIA_TYPE: Record<ImageKind, "image/jpeg" | "image/png" | "image/webp"> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Detects the image format from its first bytes; null for anything else. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "jpg";
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 && b(4) === 0x0d && b(5) === 0x0a)
    return "png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

/** Base64 of binary data, in chunks (spreading a whole image into String.fromCharCode overflows the stack). */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** "Hotel Korošica – terasa.JPG" → "hotel-korosica-terasa". */
export function slugifyName(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const slug = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "slika";
}

/**
 * File name for an upload: month, readable name and the first 8 hex chars of the SHA-256 of the bytes
 * ("2026-10-hotel-korosica-3fa9c2d1.jpg"). The same picture uploaded twice gets the same name.
 */
export async function uploadName(original: string, kind: ImageKind, bytes: Uint8Array, nowMs: number) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = [...digest.subarray(0, 4)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const month = new Date(nowMs).toISOString().slice(0, 7);
  return `${month}-${slugifyName(original)}-${hash}.${kind}`;
}

export interface PreparedImage {
  /** URL path the site will serve it at, e.g. "/uploads/2026-10-terasa-3fa9c2d1.jpg". */
  url: string;
  repoPath: string;
  mediaType: (typeof MEDIA_TYPE)[ImageKind];
  base64: string;
}

export type ImageCheck =
  | { ok: true; image: PreparedImage }
  | { ok: false; error: "image_too_large" | "image_type" };

/** Checks one uploaded file and prepares it for the model and the commit. */
export async function prepareImage(
  file: { name: string; bytes: Uint8Array },
  uploads: { dir: string; publicPath: string },
  nowMs: number,
): Promise<ImageCheck> {
  if (file.bytes.length === 0 || file.bytes.length > MAX_IMAGE_BYTES)
    return { ok: false, error: "image_too_large" };
  const kind = sniffImage(file.bytes);
  if (!kind) return { ok: false, error: "image_type" };
  const name = await uploadName(file.name, kind, file.bytes, nowMs);
  return {
    ok: true,
    image: {
      url: `${uploads.publicPath}/${name}`,
      repoPath: `${uploads.dir}/${name}`,
      mediaType: MEDIA_TYPE[kind],
      base64: toBase64(file.bytes),
    },
  };
}

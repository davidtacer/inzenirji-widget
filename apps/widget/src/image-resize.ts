/**
 * Shrinks a photo in the browser before upload (TASK-015): phone photos are 3–8 MB; a website needs ~1600 px.
 * Smaller uploads are faster on mobile data, cheaper for the AI (image tokens grow with size) and keep the
 * site fast. PNGs that are already small stay as they are (logos with transparency).
 */
export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.82;
/** The API refuses larger images (apps/api/src/content/images.ts). */
export const MAX_UPLOAD_BYTES = 1_500_000;

export interface PreparedUpload {
  blob: Blob;
  name: string;
}

export type PrepareUpload = (file: File) => Promise<PreparedUpload>;

const jpegName = (name: string) => `${name.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "slika"}.jpg`;

export const prepareUpload: PrepareUpload = async (file) => {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (file.type === "image/png" && scale === 1 && file.size <= MAX_UPLOAD_BYTES) {
      return { blob: file, name: file.name };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#ffffff"; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new Error("encode failed");
    return { blob, name: jpegName(file.name) };
  } finally {
    bitmap.close();
  }
};

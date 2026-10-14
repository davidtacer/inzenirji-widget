import { describe, expect, it } from "vitest";
import { JPEG, PNG, SVG } from "../testing/fixtures.ts";
import { MAX_IMAGE_BYTES, prepareImage, slugifyName, sniffImage, toBase64, uploadName } from "./images.ts";

const bytes = (...b: number[]) => Uint8Array.from(b);
const WEBP = new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ");
const GIF = new TextEncoder().encode("GIF89a......");
const NOW = Date.UTC(2026, 9, 14);
const uploads = { dir: "apps/site/public/uploads", publicPath: "/uploads" };

describe("sniffImage — by bytes, never by name", () => {
  it.each([
    ["jpeg", JPEG, "jpg"],
    ["png", PNG, "png"],
    ["webp", WEBP, "webp"],
    ["svg (can carry script)", SVG, null],
    ["gif", GIF, null],
    ["empty", bytes(), null],
  ] as const)("%s → %s", (_n, b, kind) => {
    expect(sniffImage(b)).toBe(kind);
  });
});

describe("names", () => {
  it.each([
    ["Hotel Korošica – terasa.JPG", "hotel-korosica-terasa"],
    ["IMG_2041.jpeg", "img-2041"],
    ["../../.github/workflows/x.yml", "github-workflows-x"],
    ["😀.png", "slika"],
  ])("%s → %s", (name, slug) => {
    expect(slugifyName(name)).toBe(slug);
  });

  it("month + readable name + content hash; same picture → same name", async () => {
    const a = await uploadName("Terasa.jpg", "jpg", JPEG, NOW);
    expect(a).toMatch(/^2026-10-terasa-[0-9a-f]{8}\.jpg$/);
    expect(await uploadName("Terasa.jpg", "jpg", JPEG, NOW)).toBe(a);
    expect(await uploadName("Terasa.jpg", "jpg", PNG, NOW)).not.toBe(a);
  });
});

describe("prepareImage", () => {
  it("prepares a JPEG for the site's uploads folder", async () => {
    const res = await prepareImage({ name: "Terasa.jpg", bytes: JPEG }, uploads, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.image.url).toMatch(/^\/uploads\/2026-10-terasa-[0-9a-f]{8}\.jpg$/);
    expect(res.image.repoPath).toBe(`apps/site/public${res.image.url}`);
    expect(res.image.mediaType).toBe("image/jpeg");
    expect(Uint8Array.from(atob(res.image.base64), (c) => c.charCodeAt(0))).toEqual(JPEG);
  });

  it("an SVG renamed to .jpg is still refused", async () => {
    expect(await prepareImage({ name: "logo.jpg", bytes: SVG }, uploads, NOW)).toEqual({
      ok: false,
      error: "image_type",
    });
  });

  it("refuses empty and oversized files", async () => {
    expect((await prepareImage({ name: "x.jpg", bytes: bytes() }, uploads, NOW)).ok).toBe(false);
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(JPEG);
    expect(await prepareImage({ name: "x.jpg", bytes: big }, uploads, NOW)).toEqual({
      ok: false,
      error: "image_too_large",
    });
  });

  it("toBase64 handles images larger than the call-stack limit", () => {
    const big = new Uint8Array(1_200_000).map((_, i) => i % 256);
    expect(toBase64(big).length).toBe(Math.ceil(big.length / 3) * 4);
  });
});

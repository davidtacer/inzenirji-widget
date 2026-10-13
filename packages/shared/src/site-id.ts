/**
 * A site id identifies one client website (e.g. "hisa-denk").
 * Rules: 3–63 chars, lowercase a–z, digits and hyphens, no leading or trailing hyphen.
 */
export const SITE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

export function isValidSiteId(value: unknown): value is string {
  return typeof value === "string" && SITE_ID_PATTERN.test(value);
}

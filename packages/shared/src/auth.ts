import { z } from "zod";
import { SITE_ID_PATTERN } from "./site-id.ts";

/** 32 random bytes, base64url without padding → exactly 43 chars. Used for login links and sessions. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isTokenFormat(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

const SiteId = z.string().regex(SITE_ID_PATTERN);
const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const Token = z.string().regex(TOKEN_PATTERN);

export const LoginRequestBody = z.strictObject({ siteId: SiteId, email: Email });
export type LoginRequestBody = z.infer<typeof LoginRequestBody>;

export const ExchangeBody = z.strictObject({ siteId: SiteId, token: Token });
export type ExchangeBody = z.infer<typeof ExchangeBody>;

export const Role = z.enum(["owner", "editor"]);
export type Role = z.infer<typeof Role>;

export const SessionInfo = z.strictObject({ siteId: SiteId, email: z.string(), role: Role });
export type SessionInfo = z.infer<typeof SessionInfo>;

export const ExchangeResponse = z.strictObject({
  sessionToken: Token,
  expiresAt: z.number().int(),
  siteId: SiteId,
  email: z.string(),
  role: Role,
});
export type ExchangeResponse = z.infer<typeof ExchangeResponse>;

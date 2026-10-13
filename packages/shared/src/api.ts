import { z } from "zod";

export const HealthResponse = z.strictObject({
  status: z.literal("ok"),
  version: z.string().min(1),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ErrorResponse = z.strictObject({ error: z.string().min(1) });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

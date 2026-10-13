import { serve } from "@hono/node-server";
import { configFromEnv, createApp } from "./app.ts";

const app = createApp(configFromEnv(process.env));
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
});

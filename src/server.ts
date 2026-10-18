import { serve } from "@hono/node-server";
import { Hono } from "hono";
import primitive, { PrimitiveWebhookError, WebhookVerificationError } from "@primitivedotdev/sdk";
import { env } from "./env";
import { handleInbound } from "./inbound";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/webhooks/email", async (c) => {
  let email;
  try {
    email = await primitive.receive(c.req.raw, { secret: env.webhookSecret });
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      console.warn(`[webhook] bad signature: ${err.message}`);
      return c.json({ error: "invalid signature" }, 401);
    }
    if (err instanceof PrimitiveWebhookError) {
      console.warn(`[webhook] unreadable payload: ${err.message}`);
      return c.json({ error: "invalid payload" }, 400);
    }
    throw err;
  }

  // Answer now and work in the background: Primitive retries a delivery that gets no 2xx within 10 s.
  handleInbound(email).catch((err) => console.error("[inbound] failed:", err));
  return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`Campus Desk listening on http://localhost:${info.port}`);
});

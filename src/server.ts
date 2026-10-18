import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { type Context, Hono } from "hono";
import primitive, { PrimitiveWebhookError, WebhookVerificationError } from "@primitivedotdev/sdk";
import { PrimitiveApiClient, getAccount } from "@primitivedotdev/sdk/api";
import { env } from "./env";
import { setDomain, snapshot } from "./events";
import { handleInbound } from "./inbound";
import { modelName, provider } from "./llm";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/webhooks/email", async (c) => {
  const copy = c.req.raw.clone(); // receive() consumes the body; keep a copy to log a payload it rejects
  let email;
  try {
    email = await primitive.receive(c.req.raw, { secret: env.webhookSecret });
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      console.warn(`[webhook] bad signature: ${err.message}`);
      return c.json({ error: "invalid signature" }, 401);
    }
    if (err instanceof PrimitiveWebhookError) {
      const body = await copy.text();
      let keys = "(not JSON)";
      try {
        keys = Object.keys(JSON.parse(body)).join(", ");
      } catch {}
      console.warn(
        `[webhook] unreadable payload: ${err.message}; X-Webhook-Event=${copy.headers.get("x-webhook-event")}; top-level keys: ${keys}`,
      );
      return c.json({ error: "invalid payload" }, 400);
    }
    throw err;
  }

  // Answer now and work in the background: Primitive retries a delivery that gets no 2xx within 10 s.
  handleInbound(email).catch((err) => console.error("[inbound] failed:", err));
  return c.json({ ok: true });
});

// The dashboard shows student files and the server is public through the tunnel, so it needs a token.
const dashboardToken = env.dashboardToken ?? randomBytes(12).toString("base64url");

function authorized(c: Context): boolean {
  const given = Buffer.from(c.req.query("token") ?? c.req.header("x-dashboard-token") ?? "");
  const expected = Buffer.from(dashboardToken);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

app.get("/", (c) =>
  authorized(c)
    ? c.html(readFileSync(new URL("../public/dashboard.html", import.meta.url), "utf8"))
    : c.text("Open the dashboard with the ?token=... link printed in the server log.", 401),
);

app.get("/api/state", (c) =>
  authorized(c) ? c.json(snapshot(Number(c.req.query("since") ?? 0) || 0)) : c.json({ error: "unauthorized" }, 401),
);

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`Campus Desk listening on http://localhost:${info.port}`);
  console.log(`Dashboard: http://localhost:${info.port}/?token=${dashboardToken}`);
  console.log(
    provider
      ? `Models: ${provider} (answers ${modelName("smart")}, routing ${modelName("fast")})`
      : "No model key: routing by keywords, and offices can't write answers",
  );
  if (env.dryRun) console.log("DRY_RUN=1: replies are logged, not sent");
  else if (!env.primitiveApiKey) console.warn("PRIMITIVE_API_KEY is not set: replies will fail until it is");
});

// Show the agents' real addresses on the dashboard before the first email arrives.
if (env.primitiveApiKey) {
  getAccount({ client: new PrimitiveApiClient({ apiKey: env.primitiveApiKey }).client })
    .then((res) => {
      const managed = res.data?.data?.managed_inbox_address;
      if (managed) setDomain(managed);
    })
    .catch(() => {});
}

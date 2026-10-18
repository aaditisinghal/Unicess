import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { type Context, Hono } from "hono";
import primitive, { PrimitiveWebhookError, WebhookVerificationError } from "@primitivedotdev/sdk";
import { PrimitiveApiClient, getAccount } from "@primitivedotdev/sdk/api";
import { demoAccessEnabled, endSession, getSession, googleCallback, googleConfigured, googleRedirect, startSession } from "./auth";
import { env } from "./env";
import { isDemoEscalation, resolveEscalation } from "./escalation";
import { emit, getDomain, setDomain, snapshot } from "./events";
import { handleInbound } from "./inbound";
import { maskEmail, outreachTarget, sendOutreach } from "./outreach";
import { generateText, modelName, provider } from "./llm";
import { hasRecording, isPlayingRecording, playRecording, recordRun } from "./recording";
import { SCENARIOS, busyWith, playAll, runScenario, tryQuestion } from "./scenarios";
import { DEMO_DOMAIN } from "./webhook-payload";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

// The logo is public (it's on the dashboard's login-free error page and the favicon).
app.get("/logo.svg", (c) =>
  c.body(readFileSync(new URL("../public/logo.svg", import.meta.url)), 200, { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" }),
);

app.post("/webhooks/email", async (c) => {
  const copy = c.req.raw.clone(); // receive() consumes the body; keep a copy to log a payload it rejects
  let email;
  try {
    email = await primitive.receive(c.req.raw, { secret: env.webhookSecret });
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      console.warn(`[webhook] bad signature: ${err.message}`);
      emit("shield", "Forged webhook rejected: its signature doesn't match the signing secret", {
        data: { kind: "forged_webhook" },
        primitive: ["primitive.receive(): Primitive-Signature HMAC check failed"],
      });
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

// The dashboard shows student files and the server is public through the tunnel, so it needs the
// token link or a signed-in portal session.
const dashboardToken = env.dashboardToken ?? randomBytes(12).toString("base64url");

function hasToken(c: Context): boolean {
  const given = Buffer.from(c.req.query("token") ?? c.req.header("x-dashboard-token") ?? "");
  const expected = Buffer.from(dashboardToken);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
const authorized = (c: Context) => hasToken(c) || getSession(c) !== null;
const page = (name: string) => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");

// Live when Primitive and the model both answer at startup; otherwise the dashboard plays the recording.
type Health = { primitive: "checking" | "ok" | "failed"; model: "checking" | "ok" | "failed"; detail?: string };
const health: Health = { primitive: "checking", model: "checking" };
const forcedRecorded = process.env.DEMO_MODE?.trim().toLowerCase() === "recorded";
const mode = () =>
  forcedRecorded || ((health.primitive === "failed" || health.model === "failed") && hasRecording())
    ? "recorded"
    : health.primitive === "checking" || health.model === "checking"
      ? "starting"
      : "live";

// Public landing page. Old dashboard links (/?token=...) still land on the live dashboard.
app.get("/", (c) => (hasToken(c) ? c.redirect(`/live?token=${encodeURIComponent(c.req.query("token") ?? "")}`) : c.html(page("landing.html"))));
app.get("/live", (c) => (authorized(c) ? c.html(page("dashboard.html")) : c.redirect("/login")));
app.get("/login", (c) => (getSession(c) ? c.redirect("/portal") : c.html(page("login.html"))));
app.get("/portal", (c) => (getSession(c) ? c.html(page("portal.html")) : c.redirect("/login")));

// ---------- Staff sign-in ----------
app.get("/auth/options", (c) => c.json({ google: googleConfigured(), demo: demoAccessEnabled() }));
app.get("/auth/google", (c) => (googleConfigured() ? googleRedirect(c) : c.redirect("/login?error=google_not_configured")));
app.get("/auth/google/callback", async (c) => {
  const result = await googleCallback(c);
  if ("error" in result) return c.redirect(`/login?error=${result.error}`);
  startSession(c, { ...result, method: "google" });
  console.log(`[auth] ${result.email} signed in with Google`);
  return c.redirect("/portal");
});
app.post("/auth/demo", (c) => {
  if (!demoAccessEnabled()) return c.redirect("/login?error=demo_off");
  startSession(c, { email: "demo", name: "Demo reviewer", method: "demo" });
  return c.redirect("/portal");
});
app.post("/auth/logout", (c) => {
  endSession(c);
  return c.redirect("/");
});
app.get("/api/me", (c) => {
  const s = getSession(c);
  if (!s) return c.json({ error: "unauthorized" }, 401);
  const inbox = outreachTarget();
  return c.json({ name: s.name, email: s.email, method: s.method, outreach: inbox ? maskEmail(inbox) : null });
});

// "Open a conversation with prospective students": a real email to DEMO_INBOX only; a reply starts a live conversation.
app.post("/api/portal/email-me", async (c) => {
  if (!getSession(c)) return c.json({ error: "Sign in first" }, 401);
  const result = await sendOutreach(domainNow());
  return result.ok ? c.json(result) : c.json({ error: result.error }, 409);
});

// The portal's review queue: approve an agent's draft, or send staff's own answer (which teaches a gap).
// Demo access may act on demo mail only; real applicant mail needs a staff member signed in with Google.
app.post("/api/portal/resolve", async (c) => {
  const s = getSession(c);
  if (!s) return c.json({ error: "Sign in first" }, 401);
  const input = await c.req.json<{ ref?: string; action?: string; text?: string }>().catch(() => ({}) as never);
  if (!input.ref) return c.json({ error: "Missing ref" }, 400);
  if (s.method === "demo" && !isDemoEscalation(input.ref)) {
    return c.json({ error: "Demo access can review demo mail only. Sign in with Google as staff to act on real applicant mail." }, 403);
  }
  const staff = s.method === "google" ? s.email : "the demo reviewer";
  const decision = input.action === "approve" ? ({ approve: true } as const) : { text: input.text ?? "" };
  const result = await resolveEscalation(input.ref, staff, decision, "portal").catch((err) => {
    console.warn(`[portal] resolve ${input.ref} failed:`, err instanceof Error ? err.message : err);
    return "failed" as const;
  });
  if (result === "approved" || result === "edited") return c.json({ ok: true, status: result });
  const messages = { not_found: "This request no longer exists.", empty: "Write an answer first.", already_resolved: "Someone already resolved this request.", failed: "Sending failed; try again." };
  return c.json({ error: messages[result] }, result === "failed" ? 502 : 409);
});

app.get("/api/state", (c) =>
  authorized(c)
    ? c.json(
        snapshot(Number(c.req.query("since") ?? 0) || 0, {
          mode: mode(),
          health,
          busy: busyWith() ?? (isPlayingRecording() ? "recording" : null),
          scenarios: SCENARIOS,
        }),
      )
    : c.json({ error: "unauthorized" }, 401),
);

// Starts work in the background and answers at once; the dashboard follows along through /api/state.
function start(c: Context, work: () => Promise<unknown>) {
  if (busyWith() || isPlayingRecording()) return c.json({ error: "A demo is already running; wait for it to finish" }, 409);
  work().catch((err) => console.warn("[scenario] stopped:", err instanceof Error ? err.message : err));
  return c.json({ ok: true, mode: mode() });
}

app.post("/api/play", (c) => {
  if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
  return start(c, () => (mode() === "recorded" ? playRecording() : playAll()));
});

app.post("/api/scenario/:key", (c) => {
  if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
  if (mode() === "recorded") return start(c, () => playRecording());
  const key = c.req.param("key");
  if (!SCENARIOS.includes(key)) return c.json({ error: `unknown scenario ${key}` }, 404);
  return start(c, () => runScenario(key));
});

app.post("/api/try", async (c) => {
  if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
  if (mode() === "recorded") return c.json({ error: "Live questions need working Primitive and model keys; this copy is in recorded mode" }, 503);
  const input = await c.req.json<{ to?: string; subject?: string; body?: string; attach?: string[] }>().catch(() => ({}) as never);
  if (!input.body?.trim()) return c.json({ error: "Write a question first" }, 400);
  return start(c, () => tryQuestion({ ...input, body: input.body! }));
});

// Discoverable by AI assistants: what each address answers, so ChatGPT or Claude can point a student
// (or email on their behalf) to the right inbox. Public, like a contact page.
const DIRECTORY = [
  ["ask", "Front desk. Send any question; it's split across the right offices and answered in one reply."],
  ["admissions", "Deadlines, application requirements, application status, transcripts, the $75 application fee."],
  ["intl", "International students: I-20 funding proof, bank statements, visas, English tests, sponsor letters."],
  ["finaid", "Scholarships, cost of attendance, application fee waivers (approved by a human counselor)."],
  ["housing", "On-campus housing, deposits and housing deadlines."],
  ["counselor", "What's still missing from an application, with due dates. Reply with documents attached."],
] as const;
const domainNow = () => getDomain() ?? DEMO_DOMAIN;

app.get("/llms.txt", (c) =>
  c.text(
    [
      "# Unicess at Halden University (fictional)",
      "",
      "> Email agents that answer prospective students and their AI assistants in seconds, at any hour.",
      "",
      "## Addresses",
      ...DIRECTORY.map(([a, what]) => `- ${a}@${domainNow()}: ${what}`),
      "",
      "## For AI agents",
      '- Add the line "Reply format: structured" to get a JSON block (and a .json attachment) with deadlines, requirements, amounts, missing items, the next step and contacts.',
      "- Attach documents (PDF or image) to the email; they're read and added to the student's file.",
      "- Every address shares one file per sender, so later emails never repeat what was already sent.",
    ].join("\n"),
  ),
);

app.get("/.well-known/agent.json", (c) =>
  c.json({
    name: "Unicess at Halden University",
    description: "Email agents for admissions, international students, financial aid, housing and application completeness (fictional demo school).",
    protocol: "email",
    structured_reply: { request: 'Include "Reply format: structured" in the email', format: "unicess/v1" },
    agents: DIRECTORY.map(([a, what]) => ({ address: `${a}@${domainNow()}`, answers: what })),
  }),
);

// Records a full live run into fixtures/recording.json (used by recorded mode). Local use only.
app.post("/api/record", (c) => {
  if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
  if (mode() !== "live") return c.json({ error: "Recording needs live mode" }, 409);
  return start(c, () => recordRun(playAll).then((n) => console.log(`[record] saved ${n} items to fixtures/recording.json`)));
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  const url = `http://localhost:${info.port}/`;
  console.log(`Unicess listening on ${url}`);
  console.log(`Live dashboard: http://localhost:${info.port}/live?token=${dashboardToken}`);
  console.log(
    `Staff portal sign-in: Google ${googleConfigured() ? "on" : "off (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)"}, demo access ${demoAccessEnabled() ? "on" : "off"}`,
  );
  console.log(
    provider
      ? `Models: ${provider} (answers ${modelName("smart")}, routing ${modelName("fast")})`
      : "No model key: routing by keywords, and offices can't write answers",
  );
  if (env.dryRun) console.log("DRY_RUN=1: replies are logged, not sent");
  else if (!env.primitiveApiKey) console.warn("PRIMITIVE_API_KEY is not set: replies will fail until it is");
  // One command for a judge: the landing page opens by itself. OPEN_BROWSER=0 turns this off.
  if (process.env.OPEN_BROWSER !== "0" && !process.env.RAILWAY_ENVIRONMENT) {
    const [cmd, args] =
      process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
    execFile(cmd as string, args as string[], () => {});
  }
});

// Startup checks decide live or recorded mode, and show the agents' real addresses before the first email.
async function checkHealth() {
  const primitiveCheck = (async () => {
    if (!env.primitiveApiKey) throw new Error("PRIMITIVE_API_KEY is not set");
    const res = await getAccount({ client: new PrimitiveApiClient({ apiKey: env.primitiveApiKey }).client });
    if (res.error || !res.data?.data) throw new Error(`Primitive: ${JSON.stringify(res.error).slice(0, 120)}`);
    const managed = res.data.data.managed_inbox_address;
    if (managed) setDomain(managed);
  })();
  const modelCheck = (async () => {
    if (!provider) throw new Error("no model key");
    await generateText({ tier: "fast", system: "Reply with the single word OK.", user: "Health check", signal: AbortSignal.timeout(20_000) });
  })();
  const [p, m] = await Promise.allSettled([primitiveCheck, modelCheck]);
  health.primitive = p.status === "fulfilled" ? "ok" : "failed";
  health.model = m.status === "fulfilled" ? "ok" : "failed";
  const problems = [p, m].flatMap((r) => (r.status === "rejected" ? [String(r.reason instanceof Error ? r.reason.message : r.reason)] : []));
  if (problems.length) health.detail = problems.join("; ");
  console.log(`[health] Primitive ${health.primitive}, model ${health.model} -> ${mode()} mode${problems.length ? ` (${health.detail})` : ""}`);
}
if (forcedRecorded) {
  health.primitive = "ok";
  health.model = "ok";
  console.log("[health] DEMO_MODE=recorded: the dashboard plays the recorded run");
} else checkHealth();

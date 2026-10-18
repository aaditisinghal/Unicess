import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";

process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.PORTAL_ALLOWED = "dean@halden.edu,@admissions.halden.edu";
const auth = await import("../src/auth");

const app = new Hono();
app.post("/in", (c) => {
  auth.startSession(c, { email: "dean@halden.edu", name: "Dean", method: "google" });
  return c.text("ok");
});
app.get("/me", (c) => c.json(auth.getSession(c)));
app.get("/auth/google", (c) => auth.googleRedirect(c));

test("a session cookie round-trips, and one with edited contents is refused", async () => {
  const res = await app.request("/in", { method: "POST" });
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const me = (await (await app.request("/me", { headers: { cookie } })).json()) as { email: string };
  assert.equal(me.email, "dean@halden.edu");

  const [name, value] = cookie.split("=") as [string, string];
  const mac = value.split(".")[1];
  const forged = Buffer.from(JSON.stringify({ email: "x@evil.example", name: "x", method: "google", exp: Date.now() + 1e7 })).toString("base64url");
  assert.equal(await (await app.request("/me", { headers: { cookie: `${name}=${forged}.${mac}` } })).json(), null);
});

test("only listed staff addresses and domains may sign in with Google", () => {
  assert.equal(auth.isAllowed("Dean@Halden.edu"), true);
  assert.equal(auth.isAllowed("someone@admissions.halden.edu"), true);
  assert.equal(auth.isAllowed("someone@halden.edu"), false);
  assert.equal(auth.isAllowed("dean@halden.edu.evil.example"), false);
});

test("Google sign-in starts with a state value bound to this browser", async () => {
  const res = await app.request("http://localhost:3000/auth/google");
  assert.equal(res.status, 302);
  const url = new URL(res.headers.get("location")!);
  assert.equal(url.host, "accounts.google.com");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/auth/google/callback");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.ok(url.searchParams.get("state"));
  assert.ok(res.headers.get("set-cookie")?.includes("unicess_oauth_state="));
});

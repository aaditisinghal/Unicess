// Staff sign-in for the portal: Google OAuth when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set,
// plus a demo-access bypass for judges (PORTAL_DEMO_ACCESS=0 turns it off).
// A session is a signed cookie, base64url(JSON).HMAC-SHA256, checked on every request.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { env } from "./env";

export type Session = { email: string; name: string; method: "google" | "demo"; exp: number };

const SESSION_COOKIE = "unicess_session";
const STATE_COOKIE = "unicess_oauth_state";
const SESSION_HOURS = 12;
// Without SESSION_SECRET, sessions last until the server restarts.
const secret = process.env.SESSION_SECRET?.trim() || randomBytes(32).toString("hex");

const google = {
  clientId: process.env.GOOGLE_CLIENT_ID?.trim() || undefined,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined,
};
export const googleConfigured = () => Boolean(google.clientId && google.clientSecret);
export const demoAccessEnabled = () => process.env.PORTAL_DEMO_ACCESS?.trim() !== "0";

// Who may sign in with Google: PORTAL_ALLOWED (emails, or @domain for a whole domain), else STAFF_ADDRESSES.
const allowList = (process.env.PORTAL_ALLOWED?.trim() ? process.env.PORTAL_ALLOWED.split(",") : env.staffAddresses)
  .map((a) => a.trim().toLowerCase())
  .filter(Boolean);
export function isAllowed(email: string): boolean {
  const e = email.toLowerCase();
  return allowList.some((a) => (a.startsWith("@") ? e.endsWith(a) : e === a));
}

const sign = (data: string) => createHmac("sha256", secret).update(data).digest("base64url");
function seal(value: unknown): string {
  const data = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${data}.${sign(data)}`;
}
function unseal<T extends { exp: number }>(token: string | undefined): T | null {
  const [data, mac] = token?.split(".") ?? [];
  if (!data || !mac) return null;
  const given = Buffer.from(mac);
  const expected = Buffer.from(sign(data));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(data, "base64url").toString()) as T;
    return value.exp > Date.now() ? value : null;
  } catch {
    return null;
  }
}

// Behind the tunnel the app sees plain http; the forwarded headers carry what the browser used.
const protocol = (c: Context) => c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "");
const origin = (c: Context) =>
  process.env.PUBLIC_URL?.trim().replace(/\/$/, "") ||
  `${protocol(c)}://${c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).host}`;
const cookieOptions = (c: Context, path: string, maxAge: number) =>
  ({ httpOnly: true, sameSite: "Lax", secure: protocol(c) === "https", path, maxAge }) as const;

export const getSession = (c: Context): Session | null => unseal<Session>(getCookie(c, SESSION_COOKIE));

export function startSession(c: Context, who: Omit<Session, "exp">): void {
  const session: Session = { ...who, exp: Date.now() + SESSION_HOURS * 3_600_000 };
  setCookie(c, SESSION_COOKIE, seal(session), cookieOptions(c, "/", SESSION_HOURS * 3600));
}

export const endSession = (c: Context) => deleteCookie(c, SESSION_COOKIE, { path: "/" });

// Step 1: send the browser to Google with a one-time state value tied to this browser.
export function googleRedirect(c: Context): Response {
  const state = randomBytes(16).toString("base64url");
  setCookie(c, STATE_COOKIE, seal({ state, exp: Date.now() + 600_000 }), cookieOptions(c, "/auth", 600));
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: google.clientId!,
    redirect_uri: `${origin(c)}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString();
  return c.redirect(url.toString());
}

// Step 2: Google sends the browser back with a code; trade it for the user's verified identity.
export async function googleCallback(c: Context): Promise<{ email: string; name: string } | { error: string }> {
  const saved = unseal<{ state: string; exp: number }>(getCookie(c, STATE_COOKIE));
  deleteCookie(c, STATE_COOKIE, { path: "/auth" });
  if (c.req.query("error")) return { error: "cancelled" };
  const code = c.req.query("code");
  if (!saved || !code || c.req.query("state") !== saved.state) return { error: "expired" };

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: google.clientId!,
      client_secret: google.clientSecret!,
      redirect_uri: `${origin(c)}/auth/google/callback`,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) return { error: "google" };
  const { id_token: idToken } = (await res.json()) as { id_token?: string };
  if (!idToken) return { error: "google" };

  // The ID token came straight from Google's token endpoint over TLS, so its claims are checked
  // rather than its signature (OpenID Connect Core 3.1.3.7).
  const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString() || "{}") as {
    aud?: string; iss?: string; exp?: number; email?: string; email_verified?: boolean; name?: string;
  };
  const issuerOk = claims.iss === "accounts.google.com" || claims.iss === "https://accounts.google.com";
  if (claims.aud !== google.clientId || !issuerOk || (claims.exp ?? 0) * 1000 < Date.now() || !claims.email || !claims.email_verified) {
    return { error: "google" };
  }
  if (!isAllowed(claims.email)) return { error: "not_allowed" };
  return { email: claims.email, name: claims.name ?? claims.email };
}

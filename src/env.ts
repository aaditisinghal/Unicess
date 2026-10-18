import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

try {
  process.loadEnvFile();
} catch {
  // No .env file (on Railway, for example): the variables come from the environment.
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}; see .env.example`);
  return value;
}

// On a host without the key file (Railway), the service-account JSON comes in GOOGLE_CREDENTIALS_JSON
// and is written to a private temp file for the Vertex client.
function gcpCredentialsPath(): string | undefined {
  const json = process.env.GOOGLE_CREDENTIALS_JSON?.trim();
  if (json) {
    const path = join(tmpdir(), "unicess-vertex-key.json");
    writeFileSync(path, json, { mode: 0o600 });
    return path;
  }
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  return file ? resolve(file) : undefined;
}

function list(value: string | undefined, fallback: string): string[] {
  return (value?.trim() || fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  webhookSecret: required("PRIMITIVE_WEBHOOK_SECRET"),
  // Optional at startup so the webhook can be tested before sending is set up; checked on first send.
  primitiveApiKey: process.env.PRIMITIVE_API_KEY?.trim() || undefined,
  // Model keys: Claude is used when its key is set, otherwise Gemini. With neither,
  // ask@ routes by keywords and every office points the student to its own address.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || undefined,
  // Comma-separated, tried in order: a busy (503) or rate-limited (429) model falls through to the next.
  // gemini-3.5-flash-lite answered the intl@ demo prompt correctly in ~2.5 s and flash-lite-latest in ~1.5 s;
  // the full flash models took 8-15 s, so they come last.
  geminiModels: list(process.env.GEMINI_MODEL, "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-flash-latest"),
  geminiFastModels: list(process.env.GEMINI_FAST_MODEL, "gemini-flash-lite-latest,gemini-3.5-flash-lite"),
  // Vertex AI on Google Cloud: used when the project and its service-account key file are set.
  gcpProject: process.env.GOOGLE_CLOUD_PROJECT?.trim() || undefined,
  gcpLocation: process.env.GOOGLE_CLOUD_LOCATION?.trim() || "us-central1",
  gcpCredentials: gcpCredentialsPath(),
  vertexModels: list(process.env.VERTEX_MODEL, "gemini-2.5-flash-lite,gemini-2.5-flash"),
  vertexFastModels: list(process.env.VERTEX_FAST_MODEL, "gemini-2.5-flash-lite"),
  // vertex = try Vertex before the Gemini API key (it answered in 1-2 s in testing)
  preferVertex: process.env.GEMINI_PREFER?.trim().toLowerCase() === "vertex",
  // Human counselors whose replies approve escalations; their mail never opens a student case.
  staffAddresses: (process.env.STAFF_ADDRESSES ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean),
  // Token for the dashboard link; without it, a new random one is printed at every start.
  dashboardToken: process.env.DASHBOARD_TOKEN?.trim() || undefined,
  dryRun: process.env.DRY_RUN === "1",
};

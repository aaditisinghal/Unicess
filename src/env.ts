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
  geminiModels: list(process.env.GEMINI_MODEL, "gemini-3.5-flash,gemini-flash-latest,gemini-2.5-flash"),
  geminiFastModels: list(process.env.GEMINI_FAST_MODEL, "gemini-flash-lite-latest,gemini-3.5-flash-lite"),
  // Human counselors whose replies approve escalations; their mail never opens a student case.
  staffAddresses: (process.env.STAFF_ADDRESSES ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean),
  dryRun: process.env.DRY_RUN === "1",
};

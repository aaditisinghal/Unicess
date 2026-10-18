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

export const env = {
  port: Number(process.env.PORT ?? 3000),
  webhookSecret: required("PRIMITIVE_WEBHOOK_SECRET"),
  // Optional at startup so the webhook can be tested before sending is set up; checked on first send.
  primitiveApiKey: process.env.PRIMITIVE_API_KEY?.trim() || undefined,
  // Optional: without it, ask@ routes by keywords instead of with Claude.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  // Human counselors whose replies approve escalations; their mail never opens a student case.
  staffAddresses: (process.env.STAFF_ADDRESSES ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean),
  dryRun: process.env.DRY_RUN === "1",
};

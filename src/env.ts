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
  primitiveApiKey: required("PRIMITIVE_API_KEY"),
  webhookSecret: required("PRIMITIVE_WEBHOOK_SECRET"),
  domain: required("PRIMITIVE_DOMAIN").toLowerCase(),
  dryRun: process.env.DRY_RUN === "1",
};

// Points the account's webhook endpoint at a new public URL (a tunnel or a host), keeping its rules.
// Quick-tunnel URLs change on every restart, so run this each time the tunnel does.
// Usage: npx tsx scripts/point-webhook.ts https://<public host>
import { PrimitiveApiClient, listEndpoints, updateEndpoint } from "@primitivedotdev/sdk/api";
import { env } from "../src/env";

const base = process.argv[2]?.trim().replace(/\/+$/, "");
if (!base?.startsWith("https://")) throw new Error("Usage: npx tsx scripts/point-webhook.ts https://<public host>");
if (!env.primitiveApiKey) throw new Error("PRIMITIVE_API_KEY is not set in .env");
const client = new PrimitiveApiClient({ apiKey: env.primitiveApiKey }).client;

// The new URL must already answer, or Primitive's deliveries would fail until it does.
const check = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
if (!check?.ok) throw new Error(`${base}/health doesn't answer; start the server and tunnel first`);

const url = `${base}/webhooks/email`;
const listed = await listEndpoints({ client });
const endpoints = (listed.data?.data ?? []) as { id: string; url: string }[];
if (listed.error || endpoints.length === 0) throw new Error(`No webhook endpoint to update: ${JSON.stringify(listed.error ?? "none found")}`);
for (const endpoint of endpoints) {
  const res = await updateEndpoint({ client, path: { id: endpoint.id }, body: { url } });
  if (res.error) throw new Error(`Updating ${endpoint.id} failed: ${JSON.stringify(res.error)}`);
  console.log(`${endpoint.id}: ${endpoint.url}\n  -> ${url}`);
}

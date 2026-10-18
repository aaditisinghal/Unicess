// Checks the Primitive API key and prints the account, its domains and its webhook endpoints.
// Usage: npx tsx scripts/whoami.ts
import { PrimitiveApiClient, getAccount, listDomains, listEndpoints } from "@primitivedotdev/sdk/api";
import { env } from "../src/env";

if (!env.primitiveApiKey) throw new Error("PRIMITIVE_API_KEY is not set in .env");
const api = new PrimitiveApiClient({ apiKey: env.primitiveApiKey });

for (const [label, call] of [
  ["account", getAccount],
  ["domains", listDomains],
  ["endpoints", listEndpoints],
] as const) {
  const { data, error } = await call({ client: api.client });
  console.log(`--- ${label}`);
  console.log(JSON.stringify(error ?? data, null, 2));
}

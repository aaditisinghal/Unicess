import primitive from "@primitivedotdev/sdk";
import { env } from "./env";

let client: ReturnType<typeof primitive.client> | undefined;

export function mail() {
  if (!env.primitiveApiKey) {
    throw new Error("PRIMITIVE_API_KEY is not set: add it to .env to send replies, or set DRY_RUN=1 to log them");
  }
  client ??= primitive.client({ apiKey: env.primitiveApiKey });
  return client;
}

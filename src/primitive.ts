import primitive from "@primitivedotdev/sdk";
import { env } from "./env";

export const mail = primitive.client({ apiKey: env.primitiveApiKey });

// One interface over two model providers: Claude when ANTHROPIC_API_KEY is set, otherwise Gemini.
// "fast" is for routing and one-liners; "smart" writes department answers and reads documents.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env } from "./env";
import { emit } from "./events";

export type Tier = "fast" | "smart";

export const provider: "claude" | "gemini" | null = env.anthropicApiKey ? "claude" : env.geminiApiKey ? "gemini" : null;

const CLAUDE_MODELS: Record<Tier, string> = { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5" };
const GEMINI_MODELS: Record<Tier, string[]> = { fast: env.geminiFastModels, smart: env.geminiModels };

export const modelName = (tier: Tier) =>
  provider === "claude" ? CLAUDE_MODELS[tier] : provider === "gemini" ? GEMINI_MODELS[tier].join(" > ") : "none";

// Each try of one model gets this long, so one slow model can't eat the whole 30 s reply budget.
const ATTEMPT_MS: Record<Tier, number> = { fast: 6_000, smart: 12_000 };

// Gemini models are often briefly over capacity: a busy model gets one quick retry, a slow one is cut off,
// and then the call moves on to the next model in the tier's list.
async function withGeminiFallback<T>(
  tier: Tier,
  signal: AbortSignal | undefined,
  call: (model: string, attemptSignal: AbortSignal) => Promise<T>,
) {
  const models = GEMINI_MODELS[tier];
  let lastError: unknown = new Error(`no Gemini models configured for ${tier}`);
  for (const [i, model] of models.entries()) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal?.aborted) throw signal.reason ?? lastError;
      const timeout = AbortSignal.timeout(ATTEMPT_MS[tier]);
      try {
        return await call(model, signal ? AbortSignal.any([signal, timeout]) : timeout);
      } catch (err) {
        lastError = err;
        if (signal?.aborted) throw err;
        const status = (err as { status?: number }).status;
        const busy = status === 429 || status === 500 || status === 503 || /"code":(429|500|503)/.test(String(err));
        const slow = timeout.aborted;
        if (!busy && !slow) throw err;
        if (busy && attempt === 1) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        const why = slow ? `no answer in ${ATTEMPT_MS[tier] / 1000} s` : `busy (${status ?? "unavailable"})`;
        const next = models[i + 1];
        console.warn(`[llm] ${model} ${why}${next ? `; trying ${next}` : ""}`);
        emit("model_fallback", `${model} ${why}${next ? `; switched to ${next}` : "; no models left"}`);
        break;
      }
    }
  }
  throw lastError;
}

// A PDF or image sent along with the prompt, base64-encoded.
export type InputFile = { mimeType: string; data: string };

type Request = { tier: Tier; system: string; user: string; files?: InputFile[]; signal?: AbortSignal };

// Files go before the text, as both providers recommend.
function claudeContent(req: Request) {
  if (!req.files?.length) return req.user;
  return [
    ...req.files.map((f) =>
      f.mimeType === "application/pdf"
        ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: f.data } }
        : {
            type: "image" as const,
            source: { type: "base64" as const, media_type: f.mimeType as "image/png" | "image/jpeg" | "image/webp", data: f.data },
          },
    ),
    { type: "text" as const, text: req.user },
  ];
}

function geminiContents(req: Request) {
  if (!req.files?.length) return req.user;
  return [
    { role: "user", parts: [...req.files.map((f) => ({ inlineData: { mimeType: f.mimeType, data: f.data } })), { text: req.user }] },
  ];
}

let anthropic: Anthropic | undefined;
let gemini: GoogleGenAI | undefined;

function claudeClient() {
  anthropic ??= new Anthropic({ apiKey: env.anthropicApiKey });
  return anthropic;
}

function geminiClient() {
  gemini ??= new GoogleGenAI({ apiKey: env.geminiApiKey });
  return gemini;
}

function noProvider(): never {
  throw new Error("No model key: set ANTHROPIC_API_KEY or GEMINI_API_KEY in .env");
}

export async function generateJson<S extends z.ZodType>(req: Request & { schema: S }): Promise<z.infer<S>> {
  if (provider === "claude") {
    const response = await claudeClient().beta.messages.parse(
      {
        model: CLAUDE_MODELS[req.tier],
        max_tokens: 8000,
        system: req.system,
        output_config: { effort: "low", format: betaZodOutputFormat(req.schema) },
        messages: [{ role: "user", content: claudeContent(req) }],
        // Sonnet re-runs a safety-classifier decline on a fallback model instead of stalling the reply.
        ...(req.tier === "smart" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal: req.signal },
    );
    if (response.stop_reason === "refusal" || response.parsed_output == null) {
      throw new Error(`no structured output (stop_reason=${response.stop_reason})`);
    }
    return response.parsed_output as z.infer<S>;
  }

  if (provider === "gemini") {
    const { $schema: _, ...jsonSchema } = z.toJSONSchema(req.schema) as Record<string, unknown>;
    const response = await withGeminiFallback(req.tier, req.signal, (model, abortSignal) =>
      geminiClient().models.generateContent({
        model,
        contents: geminiContents(req),
        config: {
          systemInstruction: req.system,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
          abortSignal,
        },
      }),
    );
    if (!response.text) throw new Error(`no output (finish_reason=${response.candidates?.[0]?.finishReason})`);
    return req.schema.parse(JSON.parse(response.text));
  }

  return noProvider();
}

export async function generateText(req: Request): Promise<string> {
  if (provider === "claude") {
    const response = await claudeClient().messages.create(
      {
        model: CLAUDE_MODELS[req.tier],
        max_tokens: 2000,
        output_config: { effort: "low" },
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      },
      { signal: req.signal },
    );
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
    if (!text) throw new Error(`no text (stop_reason=${response.stop_reason})`);
    return text;
  }

  if (provider === "gemini") {
    const response = await withGeminiFallback(req.tier, req.signal, (model, abortSignal) =>
      geminiClient().models.generateContent({
        model,
        contents: req.user,
        config: { systemInstruction: req.system, abortSignal },
      }),
    );
    const text = response.text?.trim();
    if (!text) throw new Error(`no text (finish_reason=${response.candidates?.[0]?.finishReason})`);
    return text;
  }

  return noProvider();
}

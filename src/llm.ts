// One interface over two model providers: Claude when ANTHROPIC_API_KEY is set, otherwise Gemini.
// "fast" is for routing and one-liners; "smart" writes department answers and reads documents.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env } from "./env";

export type Tier = "fast" | "smart";

export const provider: "claude" | "gemini" | null = env.anthropicApiKey ? "claude" : env.geminiApiKey ? "gemini" : null;

const CLAUDE_MODELS: Record<Tier, string> = { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5" };
const GEMINI_MODELS: Record<Tier, string[]> = { fast: env.geminiFastModels, smart: env.geminiModels };

export const modelName = (tier: Tier) =>
  provider === "claude" ? CLAUDE_MODELS[tier] : provider === "gemini" ? GEMINI_MODELS[tier].join(" > ") : "none";

// Gemini models are often briefly over capacity; move to the next model instead of failing the section.
async function withGeminiFallback<T>(tier: Tier, signal: AbortSignal | undefined, call: (model: string) => Promise<T>) {
  const models = GEMINI_MODELS[tier];
  for (const [i, model] of models.entries()) {
    try {
      return await call(model);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const busy = status === 429 || status === 500 || status === 503 || /"code":(429|500|503)/.test(String(err));
      if (!busy || signal?.aborted || i === models.length - 1) throw err;
      console.warn(`[llm] ${model} unavailable (${status ?? "busy"}); trying ${models[i + 1]}`);
    }
  }
  throw new Error("unreachable");
}

type Request = { tier: Tier; system: string; user: string; signal?: AbortSignal };

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
        messages: [{ role: "user", content: req.user }],
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
    const response = await withGeminiFallback(req.tier, req.signal, (model) =>
      geminiClient().models.generateContent({
        model,
        contents: req.user,
        config: {
          systemInstruction: req.system,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
          abortSignal: req.signal,
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
    const response = await withGeminiFallback(req.tier, req.signal, (model) =>
      geminiClient().models.generateContent({
        model,
        contents: req.user,
        config: { systemInstruction: req.system, abortSignal: req.signal },
      }),
    );
    const text = response.text?.trim();
    if (!text) throw new Error(`no text (finish_reason=${response.candidates?.[0]?.finishReason})`);
    return text;
  }

  return noProvider();
}

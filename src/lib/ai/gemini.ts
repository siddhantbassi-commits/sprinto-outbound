import { AiError, aiErrorFromHttp, toAiError } from "./errors";
import type { AiClient, Content, JsonRequest, JsonResponse, JsonSchema, ToolDecl, ToolRequest, ToolTurn, Usage } from "./types";

/**
 * Gemini over plain REST, so there is no SDK to carry and a test can hand in a fake `fetch`.
 * JSON-schema output and function calling are separate requests on purpose: they are reported to clash on some models.
 * Nothing here logs or returns the key, the prompt or the provider's error text.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * The models that may answer, best first. Model names drift, so this list is the one place to change; GEMINI_MODEL
 * (a single name) pins one without a code change.
 * [Checked against Google's model page on 4 Nov 2026: gemini-3.6-flash and gemini-3.5-flash-lite are listed Stable;
 * gemini-3.8-flash is listed only as New, so it is left out. That page does not say which models support JSON-schema
 * output or function calling, so the first live call pins that.]
 */
export const DEFAULT_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-flash-latest"];

export function modelChain(env: { GEMINI_MODEL?: string }): string[] {
  const one = env.GEMINI_MODEL?.trim();
  return one ? [one] : DEFAULT_MODELS;
}

/** A key pasted from wrapped text can carry a hidden newline or space, so all whitespace goes. */
export const cleanKey = (raw: string | undefined): string => (raw ?? "").replace(/\s+/g, "");

type Json = Record<string, unknown>;

const KEPT = ["type", "description", "enum", "minimum", "maximum", "minItems", "maxItems", "nullable", "format"] as const;

/**
 * Trims a JSON Schema to the OpenAPI subset Gemini accepts. `$schema`, `additionalProperties`, `default`, string length
 * limits and the like are dropped. An object with no properties returns undefined, because Gemini rejects an empty OBJECT.
 */
export function toGeminiSchema(schema: JsonSchema): JsonSchema | undefined {
  const out: Json = {};
  for (const k of KEPT) if (schema[k] !== undefined) out[k] = schema[k];
  const props = schema.properties as Record<string, JsonSchema> | undefined;
  if (props) {
    const kept = Object.fromEntries(Object.entries(props).map(([name, p]) => [name, toGeminiSchema(p)]).filter(([, p]) => p !== undefined));
    if (Object.keys(kept).length > 0) out.properties = kept;
    const required = (schema.required as string[] | undefined)?.filter((r) => r in kept);
    if (required?.length) out.required = required;
  }
  if (schema.items) {
    const items = toGeminiSchema(schema.items as JsonSchema);
    if (items) out.items = items;
  }
  return out.type === "object" && !out.properties ? undefined : out;
}

const declarations = (tools: ToolDecl[]) =>
  tools.map((t) => {
    const parameters = toGeminiSchema(t.parameters);
    return { name: t.name, description: t.description, ...(parameters ? { parameters } : {}) };
  });

const BLOCKED = new Set(["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"]);

interface GeminiResponse {
  promptFeedback?: { blockReason?: string };
  candidates?: { content?: { role?: string; parts?: Json[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** Thinking tokens are billed as output, so they count toward the budget. */
export function readUsage(body: GeminiResponse): Usage {
  const u = body.usageMetadata ?? {};
  const promptTokens = num(u.promptTokenCount);
  const outputTokens = num(u.candidatesTokenCount) + num(u.thoughtsTokenCount);
  return { promptTokens, outputTokens, totalTokens: num(u.totalTokenCount) || promptTokens + outputTokens };
}

function firstCandidate(body: GeminiResponse) {
  const blocked = Boolean(body.promptFeedback?.blockReason);
  const candidate = body.candidates?.[0];
  const reason = candidate?.finishReason;
  return { blocked: blocked || (reason !== undefined && BLOCKED.has(reason)), parts: candidate?.content?.parts ?? [], reason };
}

/** A tool turn read from a successful response. Thought summaries are not part of the answer; the content is kept whole. */
export function parseTurn(body: GeminiResponse): Omit<ToolTurn, "model" | "latencyMs"> {
  const { blocked, parts, reason } = firstCandidate(body);
  const calls = parts.flatMap((p) => {
    const fc = p.functionCall as { name?: string; args?: Json } | undefined;
    return fc?.name ? [{ name: fc.name, args: fc.args ?? {} }] : [];
  });
  const text = parts
    .filter((p) => typeof p.text === "string" && p.thought !== true)
    .map((p) => p.text as string)
    .join("");
  const finish: ToolTurn["finish"] = blocked ? "blocked" : calls.length > 0 ? "tool_calls" : reason === "MAX_TOKENS" ? "max_tokens" : reason === "STOP" ? "stop" : "other";
  return { text, calls, finish, content: { role: "model", parts: parts as Content["parts"] }, usage: readUsage(body) };
}

/** A 404, or a 400 that says the model is not supported, means try the next model. */
function modelMissing(status: number, body: unknown): boolean {
  if (status === 404) return true;
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return status === 400 && typeof message === "string" && /model/i.test(message) && /not (found|supported)|unsupported/i.test(message);
}

/** Overloaded and rate-limited answers are per model, so the next model in the chain may well work. Auth and bad requests are not. */
const tryNext = (e: AiError) => e.code === "overloaded" || e.code === "rate_limited";

export interface GeminiOptions {
  apiKey: string;
  models?: string[];
  fetchFn?: typeof fetch;
  now?: () => number;
}

export function createGeminiClient({ apiKey, models = DEFAULT_MODELS, fetchFn = fetch, now = Date.now }: GeminiOptions): AiClient {
  const key = cleanKey(apiKey);
  if (!key) throw new AiError("not_configured");

  /** Runs one request down the model chain under a single time budget. */
  async function call(payload: Json, timeoutMs: number): Promise<{ body: GeminiResponse; model: string; latencyMs: number }> {
    const started = now();
    const signal = AbortSignal.timeout(timeoutMs);
    const body = JSON.stringify(payload);
    let lastError: AiError = new AiError("api_error");
    for (const [i, model] of models.entries()) {
      const last = i === models.length - 1;
      let res: Response;
      try {
        res = await fetchFn(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
          body,
          signal,
        });
      } catch (e) {
        throw toAiError(e);
      }
      const json: unknown = await res.json().catch(() => null);
      if (res.ok) {
        if (!json || typeof json !== "object") throw new AiError("api_error");
        return { body: json as GeminiResponse, model, latencyMs: now() - started };
      }
      lastError = aiErrorFromHttp(res.status, json);
      if (!last && (modelMissing(res.status, json) || tryNext(lastError))) continue;
      throw lastError;
    }
    throw lastError;
  }

  return {
    async generateJson(req: JsonRequest): Promise<JsonResponse> {
      const schema = toGeminiSchema(req.schema);
      const { body, model, latencyMs } = await call(
        {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig: {
            temperature: req.temperature ?? 0,
            maxOutputTokens: req.maxOutputTokens ?? 4096,
            responseMimeType: "application/json",
            ...(schema ? { responseSchema: schema } : {}),
          },
        },
        req.timeoutMs ?? 30_000,
      );
      const { blocked, parts, reason } = firstCandidate(body);
      if (blocked) throw new AiError("blocked");
      const text = parts
        .filter((p) => typeof p.text === "string" && p.thought !== true)
        .map((p) => p.text as string)
        .join("")
        .trim();
      if (!text) throw new AiError("empty");
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new AiError("bad_json", reason === "MAX_TOKENS" ? "The model's answer was cut off before it finished." : undefined);
      }
      return { data, usage: readUsage(body), model, latencyMs };
    },

    async generateTurn(req: ToolRequest): Promise<ToolTurn> {
      const { body, model, latencyMs } = await call(
        {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: req.contents,
          tools: [{ functionDeclarations: declarations(req.tools) }],
          toolConfig: { functionCallingConfig: { mode: req.mode ?? "AUTO" } },
          generationConfig: { temperature: req.temperature ?? 0.2, maxOutputTokens: req.maxOutputTokens ?? 2048 },
        },
        req.timeoutMs ?? 30_000,
      );
      return { ...parseTurn(body), model, latencyMs };
    },
  };
}

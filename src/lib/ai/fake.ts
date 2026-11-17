import { AiError } from "./errors";
import type { AiClient, Content, JsonRequest, JsonResponse, ToolRequest, ToolTurn, Usage } from "./types";

/**
 * The scripted stand-in for Gemini. Each call takes the next prepared answer; asking for more answers than were
 * scripted fails loudly, so a test cannot pass by accident because a call silently went unanswered.
 * It records every request, so a test can check what the model was (and was not) shown.
 */

type Step<T> = T | AiError | ((req: never) => T | AiError | Promise<T | AiError>);

const USAGE: Usage = { promptTokens: 1000, outputTokens: 200, totalTokens: 1200 };

export interface ScriptedAi extends AiClient {
  jsonRequests: JsonRequest[];
  turnRequests: ToolRequest[];
  remaining(): number;
}

export interface JsonStep {
  data: unknown;
  usage?: Usage;
}
export interface TurnStep {
  text?: string;
  calls?: { name: string; args: Record<string, unknown> }[];
  usage?: Usage;
  finish?: ToolTurn["finish"];
}

export function scriptedAi(script: { json?: Step<JsonStep>[]; turns?: Step<TurnStep>[] } = {}): ScriptedAi {
  const json = [...(script.json ?? [])];
  const turns = [...(script.turns ?? [])];
  const jsonRequests: JsonRequest[] = [];
  const turnRequests: ToolRequest[] = [];

  const next = async <T>(queue: Step<T>[], req: unknown, what: string): Promise<T> => {
    const step = queue.shift();
    if (step === undefined) throw new Error(`scriptedAi: unexpected ${what} call (script is empty)`);
    const value = typeof step === "function" ? await (step as (r: unknown) => T | AiError | Promise<T | AiError>)(req) : step;
    if (value instanceof AiError) throw value;
    return value;
  };

  return {
    jsonRequests,
    turnRequests,
    remaining: () => json.length + turns.length,
    async generateJson(req): Promise<JsonResponse> {
      jsonRequests.push(req);
      const s = await next(json, req, "generateJson");
      return { data: s.data, usage: s.usage ?? USAGE, model: "scripted", latencyMs: 1 };
    },
    async generateTurn(req): Promise<ToolTurn> {
      turnRequests.push(req);
      const s = await next(turns, req, "generateTurn");
      const calls = s.calls ?? [];
      const content: Content = {
        role: "model",
        parts: [...(s.text ? [{ text: s.text }] : []), ...calls.map((c) => ({ functionCall: { name: c.name, args: c.args } }))],
      };
      return { text: s.text ?? "", calls, finish: s.finish ?? (calls.length ? "tool_calls" : "stop"), content, usage: s.usage ?? USAGE, model: "scripted", latencyMs: 1 };
    },
  };
}

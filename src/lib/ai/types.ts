/** What the pipeline needs from a language model, and nothing about which vendor provides it. Tests use the scripted fake. */

export type JsonSchema = Record<string, unknown>;

export interface Usage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export const NO_USAGE: Usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };

export interface JsonRequest {
  /** Which step this is (for the trace and the cost view). */
  purpose: string;
  system: string;
  user: string;
  schema: JsonSchema;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface JsonResponse {
  data: unknown;
  usage: Usage;
  model: string;
  latencyMs: number;
}

export interface ToolDecl {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface Part {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  [k: string]: unknown;
}
export interface Content {
  role: "user" | "model";
  parts: Part[];
}

export interface ToolRequest {
  purpose: string;
  system: string;
  contents: Content[];
  tools: ToolDecl[];
  /** "ANY" forces a tool call; "AUTO" lets the model answer in text. */
  mode?: "AUTO" | "ANY";
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface ToolTurn {
  text: string;
  calls: { name: string; args: Record<string, unknown> }[];
  finish: "stop" | "tool_calls" | "max_tokens" | "blocked" | "other";
  /** The model's turn, to be appended to the conversation as it came. */
  content: Content;
  usage: Usage;
  model: string;
  latencyMs: number;
}

export interface AiClient {
  generateJson(req: JsonRequest): Promise<JsonResponse>;
  generateTurn(req: ToolRequest): Promise<ToolTurn>;
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  promptTokens: a.promptTokens + b.promptTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  totalTokens: a.totalTokens + b.totalTokens,
});

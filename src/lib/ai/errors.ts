export type AiErrorCode =
  | "timeout"
  | "rate_limited"
  | "overloaded"
  | "auth"
  | "billing"
  | "api_error"
  | "blocked"
  | "empty"
  | "bad_json"
  | "not_configured"
  | "budget";

/** One plain sentence per failure. None of them repeats provider text, the request or the key. */
export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  timeout: "The model took too long, so the step was stopped.",
  rate_limited: "The model service has reached its usage limit for now.",
  overloaded: "The model service is overloaded.",
  auth: "The model service refused the API key. Ask an admin to check it.",
  billing: "The key is fine, but the Google account behind it has a billing problem (an unpaid balance, or billing is not set up). Fix it on the AI Studio billing page.",
  api_error: "Something went wrong reaching the model service.",
  blocked: "The model declined to answer that.",
  empty: "The model returned nothing.",
  bad_json: "The model's answer was not the structure we asked for.",
  not_configured: "No Gemini API key is set.",
  budget: "The token budget for this step is used up.",
};

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string = AI_ERROR_MESSAGES[code],
  ) {
    super(message);
    this.name = "AiError";
  }
  /** True when trying the same request again could plausibly work. */
  get retryable(): boolean {
    return this.code === "timeout" || this.code === "overloaded" || this.code === "rate_limited" || this.code === "bad_json" || this.code === "empty";
  }
}

interface GeminiErrorBody {
  error?: { status?: string; message?: string; details?: { reason?: string }[] };
}

/** Only the status and reason are kept. The provider's message text is read for one thing, a billing problem, and is never stored or shown. */
export function aiErrorFromHttp(status: number, body: unknown): AiError {
  const e = (body as GeminiErrorBody | null)?.error;
  const word = e?.status;
  const reasons = e?.details?.map((d) => d.reason) ?? [];
  // A refused request that is really about money is not a bad key, and the person needs to be told the difference.
  if ((status === 402 || status === 403) && /billing|outstanding balance|payment/i.test(e?.message ?? "")) return new AiError("billing");
  if (status === 429 || word === "RESOURCE_EXHAUSTED") return new AiError("rate_limited");
  if (status === 401 || status === 403 || word === "PERMISSION_DENIED" || word === "UNAUTHENTICATED" || (status === 400 && reasons.includes("API_KEY_INVALID"))) return new AiError("auth");
  if (status === 503 || status === 500 || status === 504 || word === "UNAVAILABLE") return new AiError("overloaded");
  return new AiError("api_error");
}

export function toAiError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return new AiError("timeout");
  return new AiError("api_error");
}

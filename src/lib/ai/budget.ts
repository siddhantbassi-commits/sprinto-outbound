import { AiError } from "./errors";
import type { Usage } from "./types";

/**
 * Token budgets: one per domain, nested inside one per run. Spending on the child counts against the parent, and a step
 * that would not fit is refused before the model is called, so a runaway loop costs nothing past the limit.
 */
export class TokenBudget {
  private spent = 0;

  constructor(
    readonly limit: number,
    private readonly parent?: TokenBudget,
  ) {
    if (!Number.isFinite(limit) || limit < 0) throw new RangeError("Token budget must be a non-negative number");
  }

  get used(): number {
    return this.spent;
  }

  /** Tokens left, counting the tightest limit up the chain. */
  get left(): number {
    const own = Math.max(0, this.limit - this.spent);
    return this.parent ? Math.min(own, this.parent.left) : own;
  }

  canSpend(estimate: number): boolean {
    return this.left >= estimate;
  }

  /** Throws the budget error when `estimate` would not fit. Called before each model call. */
  assertRoom(estimate: number): void {
    if (!this.canSpend(estimate)) throw new AiError("budget");
  }

  charge(usage: Usage): void {
    this.spent += usage.totalTokens;
    this.parent?.charge(usage);
  }
}

/** A rough size for a prompt before it is sent: about four characters a token for English. Used only for the pre-check. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

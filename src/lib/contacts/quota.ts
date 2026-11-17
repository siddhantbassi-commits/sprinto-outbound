import type { HunterAccount, HunterClient } from "./hunter";

/**
 * Hunter's free credits are the scarcest thing in the build, so the system asks Hunter how many remain rather than
 * trusting a number we wrote down, keeps a reserve, and says before a run starts how many domains it can afford.
 */

export const DEFAULT_RESERVE = 3;
export const ACCOUNT_TTL_MS = 10 * 60_000;

export interface BudgetPlan {
  /** Domains that need a Hunter call (no manual contact, nothing cached). */
  requested: number;
  /** How many of them the credits cover after the reserve. */
  allowed: number;
  /** Requested but not affordable. */
  trimmed: number;
  remaining: number;
  reserve: number;
  message: string;
}

/** What the New run page shows before Run is pressed. */
export function planHunterBudget(input: { remaining: number; reserve?: number; requested: number; cached?: number; manual?: number }): BudgetPlan {
  const reserve = input.reserve ?? DEFAULT_RESERVE;
  const spendable = Math.max(0, Math.floor(input.remaining) - reserve);
  const requested = Math.max(0, input.requested);
  const allowed = Math.min(requested, spendable);
  const trimmed = requested - allowed;
  const free = (input.cached ?? 0) + (input.manual ?? 0);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  let message: string;
  if (requested === 0) message = free > 0 ? "No Hunter credits needed: every domain has a manual contact or a cached result." : "Nothing to look up.";
  else if (trimmed === 0) message = `${plural(requested, "domain")} will use ${plural(requested, "Hunter credit")} of ${input.remaining} left (keeping ${reserve} in reserve).`;
  else message = `Hunter has ${input.remaining} credits left and ${reserve} are kept in reserve, so only ${allowed} of ${requested} domains can be looked up. The other ${trimmed} will wait in the review lane until you add a manual contact or credits renew.`;
  return { requested, allowed, trimmed, remaining: input.remaining, reserve, message };
}

/**
 * The live balance, read from Hunter's account endpoint and cached for ten minutes. Spending is subtracted locally in
 * between, so a burst of searches cannot overshoot a stale number.
 */
export class HunterBudget {
  private account: HunterAccount | null = null;
  private fetchedAt = 0;
  private spent = 0;
  private exhausted = false;

  constructor(
    private readonly client: Pick<HunterClient, "account">,
    private readonly opts: { reserve?: number; ttlMs?: number; now?: () => number } = {},
  ) {}

  private get now() {
    return this.opts.now ?? Date.now;
  }
  get reserve() {
    return this.opts.reserve ?? DEFAULT_RESERVE;
  }

  async snapshot(): Promise<HunterAccount & { spendable: number }> {
    const stale = !this.account || this.now() - this.fetchedAt > (this.opts.ttlMs ?? ACCOUNT_TTL_MS);
    if (stale) {
      this.account = await this.client.account();
      this.fetchedAt = this.now();
      this.spent = 0;
      this.exhausted = false;
    }
    const acct = this.account as HunterAccount;
    const remaining = this.exhausted ? 0 : Math.max(0, acct.remaining - this.spent);
    return { ...acct, remaining, spendable: Math.max(0, Math.floor(remaining) - this.reserve) };
  }

  async canSpend(credits = 1): Promise<boolean> {
    return (await this.snapshot()).spendable >= credits;
  }

  record(credits: number) {
    this.spent += Math.max(0, credits);
  }

  /** Hunter said no more: stop asking until the balance is re-read. */
  markExhausted() {
    this.exhausted = true;
  }
}

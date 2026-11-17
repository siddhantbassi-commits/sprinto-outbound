import { HANDLERS, TransientError, type PipelineDeps, type StepResult } from "./pipeline";
import type { ProspectRow } from "./store";

/**
 * One tick of the worker: look after the housekeeping, then claim and run prospects until the queue is empty or the time
 * is used. Every prospect advances by one step per claim, so a step never runs long and a crash loses at most one step.
 */

export interface TickOptions {
  source: "cron" | "browser";
  /** Most steps to run in this tick. */
  maxSteps?: number;
  /** Stop claiming new work after this long. */
  budgetMs?: number;
}

export interface TickResult {
  processed: number;
  advanced: number;
  parked: number;
  sent: number;
  retried: number;
  failed: number;
  lostLease: number;
  swept: number;
  errors: string[];
}

const isLeaseLost = (e: unknown) => e instanceof Error && /lease_lost/.test(e.message);

/** Runs one claimed prospect through its step and records the result. Never throws for an ordinary failure. */
export async function runClaimed(p: ProspectRow, deps: PipelineDeps): Promise<"advanced" | "parked" | "done" | "retried" | "failed" | "lost"> {
  const handler = HANDLERS[p.step as keyof typeof HANDLERS];
  if (!handler) {
    await deps.store.fail(p.id, p.step, `No handler for step ${p.step}`, false).catch(() => undefined);
    return "failed";
  }
  const started = deps.now();
  let result: StepResult;
  try {
    result = await handler(p, deps);
  } catch (e) {
    if (isLeaseLost(e)) return "lost";
    const message = e instanceof Error ? e.message : "The step failed";
    // Only a transient failure is worth the retries; anything else (a refused key, a bug) fails once with its reason.
    const retryable = e instanceof TransientError;
    try {
      await deps.store.fail(p.id, p.step, message, retryable);
    } catch (inner) {
      if (isLeaseLost(inner)) return "lost";
      throw inner;
    }
    return retryable ? "retried" : "failed";
  }

  const latencyMs = deps.now() - started;
  try {
    if (result.kind === "advance") {
      await deps.store.advance(p.id, p.step, { output: result.output, model: result.model, promptVersion: result.promptVersion, tokens: result.tokens, latencyMs });
      return "advanced";
    }
    if (result.kind === "park") {
      await deps.store.park(p.id, p.step, result.lane, result.reason, { output: result.output, model: result.model, promptVersion: result.promptVersion, tokens: result.tokens, latencyMs });
      return "parked";
    }
    return "done";
  } catch (e) {
    if (isLeaseLost(e)) return "lost";
    throw e;
  }
}

export async function tick(deps: PipelineDeps, opts: TickOptions): Promise<TickResult> {
  const out: TickResult = { processed: 0, advanced: 0, parked: 0, sent: 0, retried: 0, failed: 0, lostLease: 0, swept: 0, errors: [] };
  const started = deps.now();
  const maxSteps = opts.maxSteps ?? 25;
  const budgetMs = opts.budgetMs ?? 4 * 60_000;

  // Housekeeping first: a send nobody reported on becomes 'unknown', and old personal data is blanked.
  try {
    out.swept = await deps.store.sweepStuckSends();
    await deps.store.retention();
  } catch (e) {
    out.errors.push(`Housekeeping failed: ${(e as Error).message}`);
  }

  while (out.processed < maxSteps && deps.now() - started < budgetMs) {
    let p: ProspectRow | null;
    try {
      p = await deps.store.claim();
    } catch (e) {
      out.errors.push(`Could not claim work: ${(e as Error).message}`);
      break;
    }
    if (!p) break;
    out.processed += 1;
    try {
      const r = await runClaimed(p, deps);
      if (r === "advanced") out.advanced += 1;
      else if (r === "parked") out.parked += 1;
      else if (r === "retried") out.retried += 1;
      else if (r === "failed") out.failed += 1;
      else if (r === "lost") out.lostLease += 1;
    } catch (e) {
      out.errors.push(`${p.domain}: ${(e as Error).message}`);
      await deps.store.release(p.id).catch(() => undefined);
    }
  }

  try {
    await deps.store.recordTick(opts.source, out.processed);
  } catch (e) {
    out.errors.push(`Could not record the tick: ${(e as Error).message}`);
  }
  return out;
}

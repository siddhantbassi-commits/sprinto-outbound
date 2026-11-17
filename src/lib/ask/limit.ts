/**
 * Keeps Ask from running away: a few questions per person per window, and only one at a time per person. This lives in
 * the server's memory, so on a serverless host each instance counts for itself. That is a speed bump against a double
 * click or a loop, not a billing guarantee; the per-question token budget is the hard ceiling.
 */
export interface GuardOptions {
  max: number;
  windowMs: number;
  now?: () => number;
}

export type Entry = { ok: true; release: () => void } | { ok: false; reason: string; retryInMs: number };

export function createGuard({ max, windowMs, now = Date.now }: GuardOptions) {
  const hits = new Map<string, number[]>();
  const busy = new Set<string>();
  return {
    enter(key: string): Entry {
      if (busy.has(key)) return { ok: false, reason: "Your last question is still being answered. Wait for it to finish.", retryInMs: 2000 };
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= max) {
        const retryInMs = windowMs - (t - recent[0]!);
        hits.set(key, recent);
        return { ok: false, reason: `That is ${max} questions in ${Math.round(windowMs / 60_000)} minutes. Try again in about ${Math.max(1, Math.ceil(retryInMs / 60_000))} minute${retryInMs > 60_000 ? "s" : ""}.`, retryInMs };
      }
      recent.push(t);
      hits.set(key, recent);
      busy.add(key);
      let released = false;
      return {
        ok: true,
        release: () => {
          if (!released) {
            released = true;
            busy.delete(key);
          }
        },
      };
    },
  };
}

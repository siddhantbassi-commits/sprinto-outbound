import { AiError } from "@/lib/ai/errors";
import type { AiClient, JsonRequest, ToolRequest } from "@/lib/ai/types";
import { HunterError, type HunterClient } from "@/lib/contacts/hunter";
import type { FetchDeps } from "@/lib/scrape/fetch";
import { normaliseDomain } from "@/lib/scrape/url-guard";
import { DEMO_COMPANIES, DEMO_DISCOVERABLE } from "./companies";

/**
 * "Live research" for the public demo. The eight sample companies stay scripted, so they behave the same every time. Any other
 * company a visitor pastes is read for real: its real pages, the real model. Hunter, Gmail and the database stay pretend,
 * so a real company is never emailed and no contact is looked up. Because a stranger can start these, they are capped three ways:
 * companies per run, companies per visitor per hour, and tokens per day for the whole demo.
 */

const SAMPLE = new Set([...DEMO_COMPANIES, ...DEMO_DISCOVERABLE].map((c) => c.domain));
const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");

export const isSampleHost = (host: string): boolean => SAMPLE.has(bare(host));

/** The company a prompt is about: the page marker the extractor sends, or the "Company: name (domain)" line of the pitch prompts. */
export function domainOfPrompt(text: string): string | null {
  const m = /\| \w+ page: https?:\/\/([a-z0-9.-]+)\//i.exec(text) ?? /^Company: .+? \(([a-z0-9.-]+)\)/m.exec(text);
  return m ? bare(m[1] as string) : null;
}

/**
 * Sends a request to the real model only when it is plainly about a company that is not a sample. Anything unclear stays on the
 * scripted model, which costs nothing, so a mistake here can never spend tokens by accident.
 */
export function routeAi(scripted: AiClient, real: AiClient): AiClient {
  const pick = (text: string) => {
    const d = domainOfPrompt(text);
    return d && !isSampleHost(d) ? real : scripted;
  };
  const turnText = (req: ToolRequest) => req.contents.flatMap((c) => c.parts.map((p) => p.text ?? "")).join("\n");
  return {
    generateJson: (req: JsonRequest) => pick(`${req.user}`).generateJson(req),
    generateTurn: (req: ToolRequest) => pick(turnText(req)).generateTurn(req),
  };
}

/** Pretend pages for the sample companies, the real internet (through the same address guard) for everything else. */
export function routeFetch(scripted: FetchDeps, real: FetchDeps): FetchDeps {
  return {
    resolve: (host) => (isSampleHost(host) ? scripted.resolve(host) : real.resolve(host)),
    transport: (req) => (isSampleHost(req.url.hostname) ? scripted.transport(req) : real.transport(req)),
    userAgent: real.userAgent,
  };
}

export const LIVE_MESSAGES = {
  daily: "The public demo has used up its live research for today, so a new company cannot be read right now. The sample companies still work, and the live research resets tomorrow.",
  tokens: "The public demo's daily limit on live research has been reached. Try again tomorrow, or use the sample companies.",
  hunter: "The public demo's daily limit on contact lookups has been reached. Try again tomorrow, or add a hand-picked contact.",
};

/** Hunter credits the demo never touches, so the owner's own allowance is not drained by visitors. */
export const KEEP_CREDITS = 15;

const DAY_MS = 86_400_000;
const utcDay = (t: number) => Math.floor(t / DAY_MS);

/** A token allowance for the whole demo that starts again each UTC day. In memory: the demo runs as one process. */
export function createTokenCap(dailyTokens: number, now: () => number = Date.now) {
  let day = utcDay(now());
  let used = 0;
  const roll = () => {
    const d = utcDay(now());
    if (d !== day) {
      day = d;
      used = 0;
    }
  };
  return {
    check() {
      roll();
      if (used >= dailyTokens) throw new AiError("budget", LIVE_MESSAGES.tokens);
    },
    add(tokens: number) {
      roll();
      used += Math.max(0, tokens);
    },
    get used() {
      roll();
      return used;
    },
  };
}

export type TokenCap = ReturnType<typeof createTokenCap>;

/** Counts what the real model spends and refuses the next call once the day's allowance is gone. */
export function cappedAi(inner: AiClient, cap: TokenCap): AiClient {
  return {
    async generateJson(req) {
      cap.check();
      const r = await inner.generateJson(req);
      cap.add(r.usage.totalTokens);
      return r;
    },
    async generateTurn(req) {
      cap.check();
      const r = await inner.generateTurn(req);
      cap.add(r.usage.totalTokens);
      return r;
    },
  };
}

/** A count that starts again each UTC day. */
export function createDailyCounter(limit: number, now: () => number = Date.now) {
  let day = utcDay(now());
  let used = 0;
  return {
    take(n = 1): boolean {
      const d = utcDay(now());
      if (d !== day) {
        day = d;
        used = 0;
      }
      if (used + n > limit) return false;
      used += n;
      return true;
    },
    get used() {
      return used;
    },
  };
}

export type DailyCounter = ReturnType<typeof createDailyCounter>;

const quota = () => {
  const e = new HunterError("quota");
  e.message = LIVE_MESSAGES.hunter;
  return e;
};

/**
 * Real Hunter for companies that are not samples, behind a daily cap on the paid calls (a contact search or an address check).
 * Discovering companies is free and uncapped. The balance it reports leaves KEEP_CREDITS untouched. Sample companies keep the stand-in.
 */
export function liveHunter(scripted: HunterClient, real: HunterClient, counter: DailyCounter): HunterClient {
  const verify = real.verify;
  return {
    account: async () => {
      const a = await real.account();
      return { ...a, remaining: Math.max(0, a.remaining - KEEP_CREDITS) };
    },
    domainSearch: async (domain, opts) => {
      if (isSampleHost(domain)) return scripted.domainSearch(domain, opts);
      if (!counter.take()) throw quota();
      return real.domainSearch(domain, opts);
    },
    ...(verify
      ? {
          verify: async (email: string) => {
            const host = email.split("@")[1] ?? "";
            if (isSampleHost(host) && scripted.verify) return scripted.verify(email);
            if (!counter.take()) throw quota();
            return verify.call(real, email);
          },
        }
      : {}),
    ...(real.discover ? { discover: real.discover.bind(real) } : {}),
  };
}

export const LIVE_LIMITS = { perRun: 5, perVisitorPerHour: 8, perDay: 40 } as const;

export type GateResult = { ok: true } | { ok: false; message: string };

/** Limits how many real companies a visitor can start. Sample companies are free and never counted. */
export function createLiveGate(limits: { perRun: number; perVisitorPerHour: number; perDay: number } = LIVE_LIMITS, now: () => number = Date.now) {
  const byVisitor = new Map<string, number[]>();
  let today: number[] = [];
  return {
    check(visitor: string, domains: string[]): GateResult {
      const fresh = [...new Set(domains.map((d) => normaliseDomain(d)).filter((r) => r.ok).map((r) => (r as { domain: string }).domain))].filter((d) => !isSampleHost(d));
      if (fresh.length === 0) return { ok: true };
      const t = now();
      if (fresh.length > limits.perRun) return { ok: false, message: `The public demo reads at most ${limits.perRun} new companies in one run. You asked for ${fresh.length}. Remove some, or add the rest in another run.` };
      today = today.filter((x) => t - x < DAY_MS);
      if (today.length + fresh.length > limits.perDay) return { ok: false, message: LIVE_MESSAGES.daily };
      const mine = (byVisitor.get(visitor) ?? []).filter((x) => t - x < 3_600_000);
      if (mine.length + fresh.length > limits.perVisitorPerHour) {
        const wait = Math.max(1, Math.ceil((3_600_000 - (t - mine[0]!)) / 60_000));
        return { ok: false, message: `That is more than ${limits.perVisitorPerHour} new companies in an hour from your connection. Try again in about ${wait} minute${wait === 1 ? "" : "s"}, or use the sample companies.` };
      }
      for (let i = 0; i < fresh.length; i += 1) {
        mine.push(t);
        today.push(t);
      }
      byVisitor.set(visitor, mine);
      return { ok: true };
    },
  };
}

// ---- one allowance and one gate per server process, shared by every request ----
const KEY = Symbol.for("sprinto-outbound.live");
type Shared = { cap: TokenCap; capTokens: number; gate: ReturnType<typeof createLiveGate>; hunter: DailyCounter; capHunter: number };
type G = typeof globalThis & { [KEY]?: Shared };

export function liveShared(limits: { dailyTokens: number; dailyHunter: number }): Shared {
  const g = globalThis as G;
  if (!g[KEY] || g[KEY].capTokens !== limits.dailyTokens || g[KEY].capHunter !== limits.dailyHunter) {
    g[KEY] = { cap: createTokenCap(limits.dailyTokens), capTokens: limits.dailyTokens, gate: createLiveGate(), hunter: createDailyCounter(limits.dailyHunter), capHunter: limits.dailyHunter };
  }
  return g[KEY];
}

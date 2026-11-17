import { computeImpact, type Impact, type ImpactInput, type Rate } from "@/lib/app/impact";

/**
 * Live quality readings: how the system is behaving on real work, this week against last week.
 *
 * The rule that matters most: a number built on too few cases is never shown as fine. Each reading has a minimum sample;
 * below it the status is "not enough data" and no colour, trend or verdict is offered, because three companies cannot
 * tell you a rate. The overall status counts how many readings could not be judged, so a quiet system never reads as
 * a healthy one.
 */

export type Status = "good" | "watch" | "bad" | "info" | "not_enough";
export type Direction = "lower" | "higher" | "drift" | "info";
export type Unit = "percent" | "ms" | "tokens" | "count" | "minutes" | "text";

export interface Rule {
  direction: Direction;
  /** Smallest sample (the denominator) that can be judged. */
  minN: number;
  /** For lower-is-better the value at which it is a watch / bad; for higher-is-better the value below which it is. For drift, the swing in points. */
  watch: number;
  bad: number;
  noun: string;
}

/** Rates are fractions (0.05 is 5%). The numbers are starting points to be tuned against real weeks, and are shown on the page. */
export const RULES = {
  groundingFailure: { direction: "lower", minN: 20, watch: 0.05, bad: 0.15, noun: "quotes checked" },
  scrapeFailure: { direction: "lower", minN: 10, watch: 0.2, bad: 0.4, noun: "sites tried" },
  thinPage: { direction: "lower", minN: 20, watch: 0.15, bad: 0.3, noun: "pages read" },
  contactHit: { direction: "higher", minN: 10, watch: 0.5, bad: 0.25, noun: "qualified companies" },
  firstPassLint: { direction: "higher", minN: 10, watch: 0.7, bad: 0.5, noun: "drafts" },
  retryRate: { direction: "lower", minN: 30, watch: 0.1, bad: 0.25, noun: "steps run" },
  qualification: { direction: "drift", minN: 10, watch: 0.2, bad: 0.35, noun: "companies researched" },
  latency: { direction: "info", minN: 5, watch: 0, bad: 0, noun: "companies" },
  tokens: { direction: "info", minN: 5, watch: 0, bad: 0, noun: "companies" },
} as const satisfies Record<string, Rule>;

/**
 * Rates counted per quote or per page also need this many companies behind them. Twenty quotes from three sites are not
 * twenty independent checks: one odd site can account for all of them.
 */
export const MIN_COMPANIES = 8;

/** The heartbeat is judged by age, not by sample. */
export const HEARTBEAT = { watchMinutes: 20, badMinutes: 90 } as const;

export interface TraceEvent {
  prospect_id: string;
  step: string;
  status: string;
  latency_ms: number | null;
  model: string | null;
  prompt_version: string | null;
  tokens: number | null;
  created_at: string | Date;
}

export interface LiveInput {
  now: number;
  days: number;
  impact: Omit<ImpactInput, "range" | "assumptions">;
  events: TraceEvent[];
  lastTick: string | Date | null;
  /** Companies still moving through the queue right now. */
  activeNow: number;
  /** Companies whose send result is unknown right now. */
  unknownNow: number;
}

export interface Reading {
  key: string;
  label: string;
  help: string;
  unit: Unit;
  value: number | null;
  previous: number | null;
  /** Change from the previous window, only when both windows were big enough. */
  delta: number | null;
  n: number;
  minN: number;
  noun: string;
  status: Status;
  /** One line saying why it has this status, in words. */
  why: string;
  /** For text readings. */
  text?: string;
}

export interface Live {
  days: number;
  readings: Reading[];
  overall: Status;
  judged: number;
  total: number;
  models: string[];
  promptVersions: string[];
  changed: { models: string[]; promptVersions: string[] };
}

const DAY = 86_400_000;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const RANK: Record<Status, number> = { good: 0, info: 0, not_enough: 0, watch: 1, bad: 2 };

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i]!;
}

/** Decides a status from a value and its sample. Below the minimum sample the answer is always "not_enough". */
export function judge(rule: Rule, rawValue: number | null, n: number, rawPrevious: number | null, previousN: number): { status: Status; why: string; delta: number | null } {
  // Rounded so that 0.7 - 0.5 is 0.2 and not 0.19999999999999996, which would slip under a line set at exactly 0.2.
  const r4 = (x: number | null) => (x === null ? null : Math.round(x * 10_000) / 10_000);
  const value = r4(rawValue);
  const previous = r4(rawPrevious);
  if (value === null || n < rule.minN) return { status: "not_enough", why: `Only ${n} ${rule.noun}; at least ${rule.minN} are needed before this means anything.`, delta: null };
  const comparable = previous !== null && previousN >= rule.minN;
  const delta = comparable ? r4(value - previous) : null;
  if (rule.direction === "info") return { status: "info", why: "Shown for information; there is no right or wrong figure.", delta };
  if (rule.direction === "lower") {
    if (value >= rule.bad) return { status: "bad", why: `${pct(value)} is at or above ${pct(rule.bad)}.`, delta };
    if (value >= rule.watch) return { status: "watch", why: `${pct(value)} is at or above ${pct(rule.watch)}.`, delta };
    return { status: "good", why: `${pct(value)} is below ${pct(rule.watch)}.`, delta };
  }
  if (rule.direction === "higher") {
    if (value < rule.bad) return { status: "bad", why: `${pct(value)} is below ${pct(rule.bad)}.`, delta };
    if (value < rule.watch) return { status: "watch", why: `${pct(value)} is below ${pct(rule.watch)}.`, delta };
    return { status: "good", why: `${pct(value)} is at or above ${pct(rule.watch)}.`, delta };
  }
  // Drift: neither high nor low is wrong, but a sudden swing means something upstream changed.
  if (delta === null) return { status: "info", why: "No earlier week with enough data to compare against.", delta };
  const swing = Math.abs(delta);
  if (swing >= rule.bad) return { status: "bad", why: `Moved ${Math.round(swing * 100)} points from the week before.`, delta };
  if (swing >= rule.watch) return { status: "watch", why: `Moved ${Math.round(swing * 100)} points from the week before.`, delta };
  return { status: "good", why: `Within ${Math.round(rule.watch * 100)} points of the week before.`, delta };
}

export function computeLive(i: LiveInput): Live {
  const span = i.days * DAY;
  const cur = { key: "7" as const, label: "now", from: i.now - span, to: i.now };
  const prev = { key: "7" as const, label: "before", from: i.now - 2 * span, to: i.now - span - 1 };
  const now = computeImpact({ ...i.impact, range: cur, assumptions: { manualMinutes: 0, reviewMinutesPerEmail: 0, reviewMinutesPerDecision: 0 } });
  const before = computeImpact({ ...i.impact, range: prev, assumptions: { manualMinutes: 0, reviewMinutesPerEmail: 0, reviewMinutesPerDecision: 0 } });

  const within = (e: TraceEvent, from: number, to: number) => {
    const ms = new Date(e.created_at).getTime();
    return !Number.isNaN(ms) && ms >= from && ms <= to;
  };
  const evNow = i.events.filter((e) => within(e, cur.from, cur.to));
  const evPrev = i.events.filter((e) => within(e, prev.from, prev.to));

  const readings: Reading[] = [];
  const fromRate = (key: keyof typeof RULES, label: string, help: string, pick: (x: Impact) => Rate, perItem = false) => {
    const rule = RULES[key];
    const a = pick(now);
    const b = pick(before);
    let j = judge(rule, a.value, a.denominator, b.value, b.denominator);
    if (perItem && j.status !== "not_enough" && now.researched < MIN_COMPANIES) j = { status: "not_enough", why: `${a.denominator} ${rule.noun}, but from only ${now.researched} ${now.researched === 1 ? "company" : "companies"}; at least ${MIN_COMPANIES} are needed, because one odd site can account for them all.`, delta: null };
    readings.push({ key, label, help, unit: "percent", value: a.value, previous: b.value, delta: j.delta, n: a.denominator, minN: rule.minN, noun: rule.noun, status: j.status, why: j.why });
  };
  fromRate("groundingFailure", "Quotes that were not on the page", "Lower is better. A rising figure means the model is inventing quotes.", (x) => x.rates.groundingFailure, true);
  fromRate("scrapeFailure", "Sites that could not be read", "Blocked, missing or JavaScript-only. A jump usually means a change on our side.", (x) => x.rates.scrapeFailure);
  fromRate("thinPage", "Pages with too little text", "A rise suggests more JavaScript-only sites or a broken page reader.", (x) => x.rates.thinPage, true);
  fromRate("qualification", "Researched companies that qualified", "Neither high nor low is wrong. A sudden swing means the reading or the rubric changed.", (x) => x.rates.qualification);
  fromRate("contactHit", "Qualified companies with a person found", "Limited by Hunter's coverage and credits.", (x) => x.rates.contactHit);
  fromRate("firstPassLint", "Drafts that passed every check first time", "Higher means fewer repairs. A fall means the drafting prompt or the model changed.", (x) => x.rates.firstPassLint);

  // Steps that had to retry or failed, as a share of steps run.
  const real = (e: TraceEvent) => e.status !== "info";
  const rate = (evs: TraceEvent[]) => {
    const all = evs.filter(real);
    return { n: all.length, v: all.length ? all.filter((e) => e.status === "retry" || e.status === "error").length / all.length : null };
  };
  const rn = rate(evNow);
  const rp = rate(evPrev);
  let rj = judge(RULES.retryRate, rn.v, rn.n, rp.v, rp.n);
  const stepCompanies = new Set(evNow.filter(real).map((e) => e.prospect_id)).size;
  if (rj.status !== "not_enough" && stepCompanies < MIN_COMPANIES) rj = { status: "not_enough", why: `${rn.n} steps, but from only ${stepCompanies} ${stepCompanies === 1 ? "company" : "companies"}; at least ${MIN_COMPANIES} are needed, because one odd site can account for them all.`, delta: null };
  readings.push({ key: "retryRate", label: "Steps that retried or failed", help: "Lower is better. Retries are normal and bounded; a climb means a service is struggling.", unit: "percent", value: rn.v, previous: rp.v, delta: rj.delta, n: rn.n, minN: RULES.retryRate.minN, noun: RULES.retryRate.noun, status: rj.status, why: rj.why });

  // Cost and speed per company, from the trace.
  const perCompany = (evs: TraceEvent[], pick: (e: TraceEvent) => number) => {
    const m = new Map<string, number>();
    for (const e of evs) m.set(e.prospect_id, (m.get(e.prospect_id) ?? 0) + pick(e));
    return [...m.values()].sort((a, b) => a - b);
  };
  const lat = perCompany(evNow, (e) => Number(e.latency_ms ?? 0));
  const latP = perCompany(evPrev, (e) => Number(e.latency_ms ?? 0));
  const lj = judge(RULES.latency, lat.length ? quantile(lat, 0.5) : null, lat.length, latP.length ? quantile(latP, 0.5) : null, latP.length);
  readings.push({ key: "latencyP50", label: "Machine time per company (typical)", help: "The middle company. Time spent by the system, not a person waiting.", unit: "ms", value: lat.length ? quantile(lat, 0.5) : null, previous: latP.length ? quantile(latP, 0.5) : null, delta: lj.delta, n: lat.length, minN: RULES.latency.minN, noun: RULES.latency.noun, status: lj.status, why: lj.why });
  const l95 = judge(RULES.latency, lat.length ? quantile(lat, 0.95) : null, lat.length, latP.length ? quantile(latP, 0.95) : null, latP.length);
  readings.push({ key: "latencyP95", label: "Machine time per company (slowest 1 in 20)", help: "Shows the long tail that an average hides.", unit: "ms", value: lat.length ? quantile(lat, 0.95) : null, previous: latP.length ? quantile(latP, 0.95) : null, delta: l95.delta, n: lat.length, minN: RULES.latency.minN, noun: RULES.latency.noun, status: l95.status, why: l95.why });
  const tok = perCompany(evNow, (e) => Number(e.tokens ?? 0));
  const tokP = perCompany(evPrev, (e) => Number(e.tokens ?? 0));
  const tj = judge(RULES.tokens, tok.length ? quantile(tok, 0.5) : null, tok.length, tokP.length ? quantile(tokP, 0.5) : null, tokP.length);
  readings.push({ key: "tokens", label: "Model tokens per company (typical)", help: "A rise with the same companies means longer prompts or more retries.", unit: "tokens", value: tok.length ? quantile(tok, 0.5) : null, previous: tokP.length ? quantile(tokP, 0.5) : null, delta: tj.delta, n: tok.length, minN: RULES.tokens.minN, noun: RULES.tokens.noun, status: tj.status, why: tj.why });

  // Which models and prompts did the work, and did that change?
  const setOf = (evs: TraceEvent[], f: (e: TraceEvent) => string | null) => [...new Set(evs.map(f).filter((x): x is string => !!x))].sort();
  const models = setOf(evNow, (e) => e.model);
  const promptVersions = setOf(evNow, (e) => e.prompt_version);
  const pm = setOf(evPrev, (e) => e.model);
  const pp = setOf(evPrev, (e) => e.prompt_version);
  const changed = { models: models.filter((m) => pm.length > 0 && !pm.includes(m)), promptVersions: promptVersions.filter((v) => pp.length > 0 && !pp.includes(v)) };
  const comparable = models.length > 0 && pm.length > 0;
  const moved = changed.models.length + changed.promptVersions.length > 0;
  readings.push({
    key: "versions",
    label: "Model and prompt in use",
    help: "When either changes, this week's numbers are not comparable with last week's. Run the golden set.",
    unit: "text",
    value: null,
    previous: null,
    delta: null,
    n: models.length,
    minN: 0,
    noun: "models seen",
    status: !comparable ? "not_enough" : moved ? "watch" : "good",
    why: !comparable ? "No model calls in one of the two weeks, so a change cannot be seen." : moved ? `New since last week: ${[...changed.models, ...changed.promptVersions].join(", ")}. Run the golden set before trusting these numbers.` : "The same model and prompt versions as last week.",
    text: models.length ? `${models.join(", ")} · prompts ${promptVersions.join(", ") || "none recorded"}` : "No model calls in this period",
  });

  // Things that are judged by state, not by sample.
  readings.push({
    key: "unknownSends",
    label: "Sends whose result is unknown",
    help: "The send step could not tell whether Gmail accepted the message. A person must check; it is never retried by itself.",
    unit: "count",
    value: i.unknownNow,
    previous: null,
    delta: null,
    n: i.unknownNow,
    minN: 0,
    noun: "sends",
    status: i.unknownNow > 0 ? "bad" : "good",
    why: i.unknownNow > 0 ? `${i.unknownNow} waiting on a person.` : "None waiting.",
  });

  const ageMin = i.lastTick === null ? null : (i.now - new Date(i.lastTick).getTime()) / 60_000;
  let hb: { status: Status; why: string };
  if (ageMin === null) hb = i.activeNow > 0 ? { status: "bad", why: `The worker has never run and ${i.activeNow} ${i.activeNow === 1 ? "company is" : "companies are"} waiting.` } : { status: "not_enough", why: "The worker has not run yet, and nothing is waiting." };
  else if (i.activeNow === 0) hb = { status: "good", why: "Nothing is waiting, so a quiet worker is expected." };
  else if (ageMin <= HEARTBEAT.watchMinutes) hb = { status: "good", why: `Last ran ${Math.round(ageMin)} minutes ago.` };
  else if (ageMin <= HEARTBEAT.badMinutes) hb = { status: "watch", why: `Last ran ${Math.round(ageMin)} minutes ago with ${i.activeNow} waiting.` };
  else hb = { status: "bad", why: `Last ran ${Math.round(ageMin)} minutes ago with ${i.activeNow} waiting.` };
  readings.push({ key: "heartbeat", label: "Worker heartbeat", help: "The queue is only moving if the worker is running.", unit: "minutes", value: ageMin === null ? null : Math.round(ageMin), previous: null, delta: null, n: i.activeNow, minN: 0, noun: "waiting", ...hb });

  const judged = readings.filter((r) => r.status !== "not_enough" && r.status !== "info").length;
  const worst = readings.reduce<Status>((w, r) => (RANK[r.status] > RANK[w] ? r.status : w), "good");
  // Healthy only if most readings could actually be judged: a quiet system must not look like a good one.
  const unjudged = readings.filter((r) => r.status === "not_enough").length;
  const overall: Status = judged === 0 || (worst === "good" && unjudged > judged) ? "not_enough" : worst;
  return { days: i.days, readings, overall, judged, total: readings.length, models, promptVersions, changed };
}

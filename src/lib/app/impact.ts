/**
 * The Impact view's numbers. A pure function over rows already read, so each figure and its working can be tested exactly.
 *
 * What it will and will not claim:
 *  - Counts and rates are measured from the trace, the facts, the drafts and the usage ledger.
 *  - "Time saved" is NOT a measurement. It is the manual minutes a person would have spent (a baseline an admin sets) minus
 *    the minutes a person still spends (review times an admin sets). The working is returned line by line, with the
 *    assumptions beside it, and the caller is told when too few companies make a rate meaningless.
 *  - Replies and bounces are counted only if someone recorded them; in test mode nobody was mailed.
 */

export interface Assumptions {
  /** Minutes a person would take to research one company and write to it by hand. */
  manualMinutes: number;
  reviewMinutesPerEmail: number;
  reviewMinutesPerDecision: number;
}

export type RangeKey = "7" | "30" | "all";

export interface Range {
  key: RangeKey;
  label: string;
  /** Epoch milliseconds; null means from the beginning. */
  from: number | null;
  to: number;
}

export function rangeFor(key: string | undefined, now: number): Range {
  const days = key === "7" ? 7 : key === "all" ? null : 30;
  const k: RangeKey = key === "7" ? "7" : key === "all" ? "all" : "30";
  return { key: k, label: days === null ? "All time" : `Last ${days} days`, from: days === null ? null : now - days * 86_400_000, to: now };
}

export interface ProspectRow {
  id: string;
  lane: string;
  lane_reason: string | null;
  verdict: string | null;
  created_at: string | Date;
}
export interface EventRow {
  prospect_id: string;
  step: string;
  status: string;
  latency_ms: number | null;
}
export interface DraftEventRow {
  prospect_id: string;
  status: string;
  output: { attempts?: { n: number; failed: string[] }[] } | null;
}
export interface FactsRow {
  prospect_id: string;
  pass: number;
  grounding: { checked?: number; failures?: string[] } | null;
}
export interface PageRow {
  prospect_id: string;
  thin: boolean;
}
export interface UsageRow {
  prospect_id: string | null;
  kind: string;
  units: number | string;
}
export interface DecisionRow {
  prospect_id: string | null;
  kind: string;
  created_at: string | Date;
}

export interface ImpactInput {
  range: Range;
  assumptions: Assumptions;
  prospects: ProspectRow[];
  events: EventRow[];
  draftEvents: DraftEventRow[];
  facts: FactsRow[];
  pages: PageRow[];
  usage: UsageRow[];
  decisions: DecisionRow[];
}

export interface Stage {
  key: string;
  label: string;
  count: number;
}
export interface Dropoff {
  lane: string;
  count: number;
  /** The most common reasons, with digits folded so "scored 38" and "scored 41" group together. */
  reasons: { text: string; count: number }[];
}
export interface Rate {
  /** Null when there is nothing to divide by. */
  value: number | null;
  numerator: number;
  denominator: number;
}
export interface TimeLine {
  label: string;
  minutes: number;
  note: string;
}

export interface Impact {
  range: Range;
  domains: number;
  researched: number;
  qualified: number;
  contactFound: number;
  drafted: number;
  sent: number;
  funnel: Stage[];
  dropoffs: Dropoff[];
  rates: {
    qualification: Rate;
    contactHit: Rate;
    firstPassLint: Rate;
    sendThrough: Rate;
    groundingFailure: Rate;
    thinPage: Rate;
    scrapeFailure: Rate;
  };
  usage: { tokens: number; tokensPerCompany: number | null; hunterCredits: number; creditsPerContact: number | null; sends: number };
  time: {
    lines: TimeLine[];
    baselineMinutes: number;
    humanMinutes: number;
    savedMinutes: number;
    machineMinutes: number;
    decisions: number;
  };
  replies: { replies: number; bounces: number; recorded: boolean };
  notes: string[];
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const rate = (numerator: number, denominator: number): Rate => ({ value: denominator > 0 ? numerator / denominator : null, numerator, denominator });
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Digits folded, so reasons that differ only by a number are counted together. */
export const normaliseReason = (s: string | null) => (s ?? "No reason recorded").replace(/\d+(\.\d+)?/g, "#").replace(/\s+/g, " ").trim().slice(0, 90);

export function computeImpact(i: ImpactInput): Impact {
  const inRange = (t: string | Date) => {
    const ms = new Date(t).getTime();
    return !Number.isNaN(ms) && (i.range.from === null || ms >= i.range.from) && ms <= i.range.to;
  };
  const prospects = i.prospects.filter((p) => inRange(p.created_at));
  const ids = new Set(prospects.map((p) => p.id));
  const mine = <T extends { prospect_id: string | null }>(rows: T[]) => rows.filter((r) => r.prospect_id !== null && ids.has(r.prospect_id));

  const events = mine(i.events);
  const okStep = (step: string) => new Set(events.filter((e) => e.step === step && e.status === "ok").map((e) => e.prospect_id));
  const read = okStep("scrape");
  const qualifiedSet = okStep("qualify");
  const contactSet = okStep("contact");
  const draftedSet = okStep("draft");
  const sentSet = new Set(prospects.filter((p) => p.lane === "sent").map((p) => p.id));

  const skipped = prospects.filter((p) => p.lane === "skipped" && !read.has(p.id)).length;
  const researched = read.size;

  const funnel: Stage[] = [
    { key: "added", label: "Domains added", count: prospects.length },
    { key: "read", label: "Site read", count: researched },
    { key: "qualified", label: "Qualified", count: qualifiedSet.size },
    { key: "contact", label: "Person found", count: contactSet.size },
    { key: "drafted", label: "Email drafted", count: draftedSet.size },
    { key: "sent", label: "Sent to the test inbox", count: sentSet.size },
  ];

  // Where the rest went, with the most common reasons for each lane.
  const byLane = new Map<string, ProspectRow[]>();
  for (const p of prospects) if (p.lane !== "sent" && p.lane !== "active") byLane.set(p.lane, [...(byLane.get(p.lane) ?? []), p]);
  const dropoffs: Dropoff[] = [...byLane.entries()]
    .map(([lane, rows]) => {
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(normaliseReason(r.lane_reason), (counts.get(normaliseReason(r.lane_reason)) ?? 0) + 1);
      return { lane, count: rows.length, reasons: [...counts.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)).slice(0, 3) };
    })
    .sort((a, b) => b.count - a.count || a.lane.localeCompare(b.lane));

  // First-pass lint: of the drafts that were attempted, how many passed all twelve checks the first time.
  const drafts = mine(i.draftEvents).filter((d) => (d.output?.attempts?.length ?? 0) > 0);
  const firstPass = drafts.filter((d) => (d.output?.attempts?.[0]?.failed.length ?? 1) === 0).length;

  // Quote check: the failures and checks of each prospect's last extraction pass.
  const lastFacts = new Map<string, FactsRow>();
  for (const f of mine(i.facts)) if (!lastFacts.has(f.prospect_id) || f.pass > (lastFacts.get(f.prospect_id) as FactsRow).pass) lastFacts.set(f.prospect_id, f);
  let checked = 0;
  let failures = 0;
  for (const f of lastFacts.values()) {
    checked += num(f.grounding?.checked);
    failures += f.grounding?.failures?.length ?? 0;
  }

  const pages = mine(i.pages);
  const scrapeAttempted = prospects.length - skipped;
  const scrapeFailed = scrapeAttempted - researched;

  const usage = mine(i.usage);
  const sum = (kind: string) => usage.filter((u) => u.kind === kind).reduce((n, u) => n + num(u.units), 0);
  const tokens = Math.round(sum("gemini_tokens"));
  const credits = sum("hunter_credits");

  // Person time.
  const decisions = i.decisions.filter((d) => d.prospect_id !== null && ids.has(d.prospect_id) && inRange(d.created_at));
  const a = i.assumptions;
  const baseline = researched * a.manualMinutes;
  const reviewEmails = sentSet.size * a.reviewMinutesPerEmail;
  const reviewDecisions = decisions.length * a.reviewMinutesPerDecision;
  const human = reviewEmails + reviewDecisions;
  const machineMs = events.reduce((n, e) => n + num(e.latency_ms), 0);
  const lines: TimeLine[] = [
    { label: "By hand, the manual way", minutes: round1(baseline), note: `${researched} companies researched × ${a.manualMinutes} min each, the baseline set in Settings` },
    { label: "Reading each email before it goes", minutes: round1(-reviewEmails), note: `${sentSet.size} emails × ${a.reviewMinutesPerEmail} min` },
    { label: "Decisions made by people", minutes: round1(-reviewDecisions), note: `${decisions.length} decisions × ${a.reviewMinutesPerDecision} min` },
  ];

  const notes = [
    "The manual baseline and the review times are assumptions an admin sets in Settings. They are not measurements, so treat “time saved” as an estimate with its working shown.",
  ];
  if (researched < 5) notes.push(`Only ${researched} ${researched === 1 ? "company has" : "companies have"} been researched in this period, so the rates below can swing a lot on a single company.`);
  const replies = i.decisions.filter((d) => d.prospect_id !== null && ids.has(d.prospect_id) && d.kind === "mark_reply").length;
  const bounces = i.decisions.filter((d) => d.prospect_id !== null && ids.has(d.prospect_id) && d.kind === "mark_bounce").length;
  notes.push("Reply rate is not measured: in test mode every email goes to your own inbox, so there is nobody to reply.");

  return {
    range: i.range,
    domains: prospects.length,
    researched,
    qualified: qualifiedSet.size,
    contactFound: contactSet.size,
    drafted: draftedSet.size,
    sent: sentSet.size,
    funnel,
    dropoffs,
    rates: {
      qualification: rate(qualifiedSet.size, researched),
      contactHit: rate(contactSet.size, qualifiedSet.size),
      firstPassLint: rate(firstPass, drafts.length),
      sendThrough: rate(sentSet.size, qualifiedSet.size),
      groundingFailure: rate(failures, checked),
      thinPage: rate(pages.filter((p) => p.thin).length, pages.length),
      scrapeFailure: rate(scrapeFailed, scrapeAttempted),
    },
    usage: { tokens, tokensPerCompany: researched > 0 ? Math.round(tokens / researched) : null, hunterCredits: round1(credits), creditsPerContact: contactSet.size > 0 ? round1(credits / contactSet.size) : null, sends: Math.round(sum("gmail_send")) },
    time: { lines, baselineMinutes: round1(baseline), humanMinutes: round1(human), savedMinutes: round1(baseline - human), machineMinutes: Math.round((machineMs / 60_000) * 100) / 100, decisions: decisions.length },
    replies: { replies, bounces, recorded: replies + bounces > 0 },
    notes,
  };
}

const pct = (r: Rate) => (r.value === null ? "not enough data" : `${Math.round(r.value * 100)}% (${r.numerator} of ${r.denominator})`);
export const hours = (minutes: number) => (Math.abs(minutes) >= 90 ? `${round1(minutes / 60)} hours` : Math.abs(minutes) > 0 && Math.abs(minutes) < 1 ? "under a minute" : `${Math.round(minutes)} minutes`);

/** The weekly report as plain text, to paste into an email or a chat. The same numbers, the same working, the same caveats. */
export function renderReport(x: Impact, when: { from: string; to: string }): string {
  const lines = [
    `Sprinto Outbound: ${x.range.label.toLowerCase()} (${when.from} to ${when.to})`,
    "",
    `Companies added: ${x.domains}`,
    `Researched (site read): ${x.researched}`,
    `Qualified: ${x.qualified}, which is ${pct(x.rates.qualification)} of those researched`,
    `Person found: ${x.contactFound}, which is ${pct(x.rates.contactHit)} of those qualified`,
    `Emails drafted: ${x.drafted}`,
    `Sent to the test inbox: ${x.sent}`,
    "",
    "Time saved (an estimate; the working is below)",
    ...x.time.lines.map((l) => `  ${l.minutes >= 0 ? "+" : "-"} ${hours(Math.abs(l.minutes))}: ${l.label}, ${l.note}`),
    `  = ${hours(x.time.savedMinutes)} saved`,
    `  Machine time, with no person waiting: ${hours(x.time.machineMinutes)}`,
    "",
    "Quality",
    `  Drafts that passed all 12 checks first time: ${pct(x.rates.firstPassLint)}`,
    `  Quotes the model gave that were not on the page: ${pct(x.rates.groundingFailure)}`,
    `  Sites that could not be read: ${pct(x.rates.scrapeFailure)}`,
    "",
    "Cost",
    `  Model tokens: ${x.usage.tokens.toLocaleString("en-GB")}${x.usage.tokensPerCompany === null ? "" : ` (${x.usage.tokensPerCompany.toLocaleString("en-GB")} per company researched)`}`,
    `  Hunter credits: ${x.usage.hunterCredits}${x.usage.creditsPerContact === null ? "" : ` (${x.usage.creditsPerContact} per person found)`}`,
  ];
  if (x.dropoffs.length) {
    lines.push("", "Where the rest went");
    for (const d of x.dropoffs) lines.push(`  ${d.lane.replace("_", " ")}: ${d.count}${d.reasons[0] ? `, mostly “${d.reasons[0].text}”` : ""}`);
  }
  lines.push("", "Notes", ...x.notes.map((n) => `  - ${n}`));
  return lines.join("\n");
}

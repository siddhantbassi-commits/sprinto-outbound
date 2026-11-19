"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MAX_INPUT_CHARS, parseList, type ParsedList } from "@/lib/app/list";
import { activeSuppressions, currentSettings } from "@/lib/app/queries";
import { guestSerial, guestStartVerdict, guestUsage } from "@/lib/app/guest-load";
import { getSession, hunterBalance } from "@/lib/app/runtime";
import { liveShared } from "@/lib/demo/live";
import { planHunterBudget, type BudgetPlan } from "@/lib/contacts/quota";
import { parseHintInput } from "@/lib/icp/hints";
import { PROMPT_VERSIONS } from "@/lib/versions";

export interface CheckResult {
  ok: boolean;
  message?: string;
  list?: ParsedList;
  source?: "paste" | "csv";
  suppressed?: string[];
  recent?: string[];
  manual?: string[];
  plan?: BudgetPlan | null;
  hunterError?: string;
  maxRun?: number;
}

const MAX_FILE_BYTES = 1_000_000;

/** Reads a pasted list or an uploaded CSV and says, before anything runs, what would happen to each domain and what it would cost. */
export async function checkList(_prev: CheckResult | null, formData: FormData): Promise<CheckResult> {
  const s = await getSession();
  if (!s || (s.user.role !== "operator" && s.user.role !== "admin")) return { ok: false, message: "Only an operator or admin can start a run." };

  let text = String(formData.get("domains") ?? "");
  let source: "paste" | "csv" = "paste";
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { ok: false, message: "That file is over 1 MB. A list of domains should be far smaller." };
    if (!/\.(csv|txt)$/i.test(file.name) && !/^text\//.test(file.type)) return { ok: false, message: "Upload a .csv or .txt file." };
    text = await file.text();
    source = "csv";
  }
  if (!text.trim()) return { ok: false, message: "Paste some domains or choose a file first." };

  const list = parseList(text.slice(0, MAX_INPUT_CHARS));
  const [settings, suppressions] = await Promise.all([currentSettings(s.db), activeSuppressions(s.db)]);
  const blocked = new Set(suppressions.filter((x) => x.kind === "domain").map((x) => x.value));
  const suppressed = list.valid.filter((d) => blocked.has(d));

  const cooldown = settings?.mail_cooldown_days ?? 30;
  const sentRows = await s.db.select("emails", {}, { order: "created_at", ascending: false, limit: 1000 });
  const cutoff = Date.now() - cooldown * 86_400_000;
  const mailed = new Set(sentRows.filter((e) => ["sending", "sent", "unknown"].includes(String(e.status)) && e.sending_at && new Date(e.sending_at as string).getTime() > cutoff).map((e) => String(e.domain)));
  const recent = list.valid.filter((d) => mailed.has(d));

  const manualRows = await s.db.select("manual_contacts", {}, { limit: 1000 });
  const manual = new Set(manualRows.map((m) => String(m.domain)));
  const cacheRows = await s.db.select("hunter_cache", {}, { order: "fetched_at", ascending: false, limit: 1000 });
  const cached = new Set(cacheRows.filter((c) => c.response && new Date(c.fetched_at as string).getTime() > Date.now() - 30 * 86_400_000).map((c) => String(c.domain)));

  const going = list.valid.filter((d) => !blocked.has(d) && !mailed.has(d));
  const needHunter = going.filter((d) => !manual.has(d) && !cached.has(d));
  const balance = await hunterBalance();
  const plan = balance && balance.remaining !== undefined ? planHunterBudget({ remaining: balance.remaining, reserve: settings?.hunter_reserve ?? 3, requested: needHunter.length, cached: going.filter((d) => cached.has(d)).length, manual: going.filter((d) => manual.has(d)).length }) : null;

  return { ok: true, list, source, suppressed, recent, manual: going.filter((d) => manual.has(d)), plan, hunterError: balance && "error" in balance ? balance.error : undefined, maxRun: settings?.max_run_size };
}

export interface StartResult {
  message: string;
}

export async function startRun(_prev: StartResult | null, formData: FormData): Promise<StartResult> {
  const s = await getSession();
  if (!s || (s.user.role !== "operator" && s.user.role !== "admin")) return { message: "Only an operator or admin can start a run." };
  let domains: string[];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("domains") ?? "[]"));
    domains = Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === "string").slice(0, 1000) : [];
  } catch {
    return { message: "The list could not be read. Check it again." };
  }
  // A public demo that reads real companies limits how many a visitor can start; the sample companies are free and never counted.
  if (s.env.live) {
    const h = await headers();
    const visitor = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
    const verdict = liveShared(s.env.live).gate.check(visitor, domains);
    if (!verdict.ok) return { message: verdict.message };
  }
  const wanted = formData.get("source");
  const source = wanted === "csv" ? "csv" : wanted === "discover" ? "discover" : "paste";
  const note = String(formData.get("note") ?? "").trim().slice(0, 120);
  const begin = async (): Promise<{ id: string } | { message: string }> => {
    // A guest may start runs like an admin, within the daily caps; a signed-in person is never limited here.
    const allowed = await guestStartVerdict(s, new Set(domains.map((d) => d.toLowerCase().trim())).size);
    if (!allowed.ok) return { message: allowed.message };
    let made: string;
    try {
      // The database re-checks every domain, the run-size cap, the sign-off and the suppression list; nothing here is trusted.
      const [row] = await s.db.rpc("create_run", { p_domains: domains, p_source: source, p_note: note, p_prompt_versions: PROMPT_VERSIONS });
      made = String(Object.values(row ?? {})[0]);
    } catch (e) {
      return { message: e instanceof Error ? e.message : "The run could not be started." };
    }
    // Checked again now that the run exists: if several requests at once (on different servers) each passed the first check, the ones
    // that took the total over the day's limit are paused here, before any of their companies is read.
    if (s.guest && s.env.guest) {
      const after = await guestUsage(s);
      if (after.companiesToday > s.env.guest.dailyCompanies) {
        await s.db.insert("decisions", { run_id: made, kind: "pause_run", reason: "Paused: the guest allowance for today was passed by requests at the same time" }).catch(() => undefined);
        return { message: "The guest allowance of researched companies for today was reached by requests made at the same moment, so this run was paused before it started. It starts again tomorrow (UTC)." };
      }
    }
    return { id: made };
  };
  const began = s.guest ? await guestSerial("start", begin) : await begin();
  if ("message" in began) return { message: began.message };
  const id = began.id;
  // A run chosen from Discover also carries the size band each company was found under, so size is not "unknown" for a site that
  // never states it. The scorer labels it as Hunter's and a size the site states always wins. If this fails the run still goes
  // ahead and each company is judged from its site alone.
  if (source === "discover") {
    let raw: unknown = null;
    try {
      raw = JSON.parse(String(formData.get("hints") ?? "null"));
    } catch {
      /* no usable hints */
    }
    const hints = parseHintInput(raw, domains.map((d) => d.toLowerCase().trim()));
    if (hints.length) await s.db.rpc("set_prospect_hints", { p_run: id, p_hints: hints }).catch(() => undefined);
  }
  redirect(`/runs/${id}`);
}

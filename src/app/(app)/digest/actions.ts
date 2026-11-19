"use server";
import { revalidatePath } from "next/cache";
import { digestSetup, getSession } from "@/lib/app/runtime";
import { defaultCriteria, normaliseCriteria } from "@/lib/discovery/criteria";
import { loadSearch, runDigest } from "@/lib/digest/run";
import { ICP_V1 } from "@/lib/icp/config";
import { guestCooldown } from "@/lib/app/guest";

export interface DigestResult {
  ok: boolean;
  message: string;
}

const allowed = async () => {
  const s = await getSession();
  return s && (s.user.role === "operator" || s.user.role === "admin") ? s : null;
};
const refresh = () => {
  revalidatePath("/digest");
  revalidatePath("/discover");
};

/** Saves the criteria from Discover as the weekly search, switched on. Each save is a new permanent version, with who made it. */
export async function saveDigestSearch(_prev: DigestResult | null, formData: FormData): Promise<DigestResult> {
  const s = await allowed();
  if (!s) return { ok: false, message: "Only an operator or admin can change the weekly search." };
  let raw: unknown = null;
  try {
    raw = JSON.parse(String(formData.get("criteria") ?? "null"));
  } catch {
    /* an unreadable form falls back to the defaults */
  }
  const criteria = normaliseCriteria(raw, defaultCriteria(ICP_V1));
  try {
    await s.db.rpc("set_digest_search", { p_criteria: criteria, p_enabled: true, p_reason: "Saved from Discover" });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "That could not be saved." };
  }
  refresh();
  return { ok: true, message: "Saved. The digest will run every Monday morning, and you can run it now from the Weekly digest page." };
}

/** Switches the weekly job on or off without losing the criteria. */
export async function setDigestEnabled(_prev: DigestResult | null, formData: FormData): Promise<DigestResult> {
  const s = await allowed();
  if (!s) return { ok: false, message: "Only an operator or admin can change the weekly search." };
  const search = await loadSearch(s.db);
  if (!search) return { ok: false, message: "Save a search from Discover first." };
  const on = formData.get("enabled") === "on";
  try {
    await s.db.rpc("set_digest_search", { p_criteria: search.criteria, p_enabled: on, p_reason: on ? "Switched the weekly digest on" : "Switched the weekly digest off" });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "That could not be changed." };
  }
  refresh();
  return { ok: true, message: on ? "The weekly digest is on." : "The weekly digest is off." };
}

/** Runs the saved search now, even if one ran recently or the weekly job is switched off. Free: it only reads. */
export async function runDigestNow(): Promise<DigestResult> {
  const s = await allowed();
  if (!s) return { ok: false, message: "Only an operator or admin can run the digest." };
  // A guest runs this at most once an hour: it emails the owner, so a public link must not be able to repeat it.
  if (s.guest) {
    const [last] = await s.db.select("digests", {}, { order: "created_at", ascending: false, limit: 1 });
    const gate = guestCooldown(last?.created_at as string | undefined, Date.now(), 60, "The digest");
    if (!gate.ok) return { ok: false, message: gate.message };
  }
  const setup = await digestSetup();
  if (!setup.ok) return { ok: false, message: setup.reason };
  try {
    const r = await runDigest({ db: s.db, hunter: setup.hunter, fetchDeps: setup.fetchDeps, gmail: setup.gmail, appUrl: setup.appUrl, trigger: "browser", force: true });
    refresh();
    if (r.status === "skipped") return { ok: false, message: r.reason === "no_search" ? "Save a search from Discover first." : "The digest was not run." };
    const n = r.digest.found.length;
    if (r.digest.problems.length && n === 0) return { ok: false, message: r.digest.problems[0]! };
    const mail = r.digest.email_status === "sent" ? " and emailed to you" : "";
    return { ok: true, message: n === 0 ? "Nothing new since the last digest." : `${n} new ${n === 1 ? "company" : "companies"} found${mail}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The digest could not run." };
  }
}

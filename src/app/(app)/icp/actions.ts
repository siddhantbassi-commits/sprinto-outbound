"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseList } from "@/lib/app/list";
import { icpVersions, replaySubjects, type IcpVersionRow } from "@/lib/app/queries";
import { getSession, type AppSession } from "@/lib/app/runtime";
import type { IcpConfig } from "@/lib/icp/config";
import { parseConfigForm } from "@/lib/icp/edit";
import { replay, type Mover, type ReplayResult } from "@/lib/icp/replay";

export interface ReplayState {
  ok: boolean;
  message?: string;
  errors?: string[];
  result?: ReplayResult;
  /** Movers are capped for the page; the full count is in result.movers.length. */
  movers?: Mover[];
  baseVersion?: number;
  changed?: number;
}

export interface SaveState {
  ok: boolean;
  message: string;
}

const MAX_SHOWN = 200;

async function admin(): Promise<AppSession | null> {
  const s = await getSession();
  return s && s.user.role === "admin" ? s : null;
}

type Draft =
  | { kind: "gone"; message: string }
  | { kind: "invalid"; errors: string[] }
  | { kind: "ok"; base: IcpVersionRow; config: IcpConfig; blocklist: string[] };

/** Reads the draft out of the form: the base version it was started from, every weight, and the extra blocklist. */
async function draftFrom(s: AppSession, f: FormData): Promise<Draft> {
  const { versions } = await icpVersions(s.db);
  const base = versions.find((v) => v.id === String(f.get("base") ?? ""));
  if (!base) return { kind: "gone", message: "The version this draft started from no longer exists. Reload the page." };
  const parsed = parseConfigForm((n) => (f.get(n) === null ? null : String(f.get(n))), base.config);
  if (!parsed.ok) return { kind: "invalid", errors: parsed.errors };
  return { kind: "ok", base, config: parsed.config, blocklist: parseList(String(f.get("blocklist") ?? "")).valid };
}

/** Re-scores every stored company under the draft. Reads only; saves nothing. */
export async function runReplay(_prev: ReplayState | null, f: FormData): Promise<ReplayState> {
  const s = await admin();
  if (!s) return { ok: false, message: "Only an admin can replay the ICP." };
  const d = await draftFrom(s, f);
  if (d.kind === "gone") return { ok: false, message: d.message };
  if (d.kind === "invalid") return { ok: false, errors: d.errors };
  const subjects = await replaySubjects(s.db);
  const result = replay(subjects, { config: d.base.config, blocklist: d.base.blocklist?.domains ?? [] }, { config: d.config, blocklist: d.blocklist });
  const changed = JSON.stringify(d.config) !== JSON.stringify(d.base.config) || JSON.stringify(d.blocklist) !== JSON.stringify(d.base.blocklist?.domains ?? []);
  return { ok: true, result: { ...result, movers: [] }, movers: result.movers.slice(0, MAX_SHOWN), baseVersion: d.base.version, changed: result.movers.length, message: changed ? undefined : "The draft is the same as the version it started from, so nothing can move." };
}

/** Saves the draft as a new version. It cannot be used until it is signed off, so saving changes nothing in practice. */
export async function saveVersion(_prev: SaveState | null, f: FormData): Promise<SaveState> {
  const s = await admin();
  if (!s) return { ok: false, message: "Only an admin can save an ICP version." };
  const reason = String(f.get("reason") ?? "").trim().slice(0, 300);
  if (reason.length < 3) return { ok: false, message: "Say why you are changing it (at least 3 characters)." };
  const d = await draftFrom(s, f);
  if (d.kind === "gone") return { ok: false, message: d.message };
  if (d.kind === "invalid") return { ok: false, message: d.errors.join(" ") };
  if (JSON.stringify(d.config) === JSON.stringify(d.base.config) && JSON.stringify(d.blocklist) === JSON.stringify(d.base.blocklist?.domains ?? [])) return { ok: false, message: "Nothing has changed from the version it started from." };
  try {
    const { versions } = await icpVersions(s.db);
    const next = Math.max(...versions.map((v) => v.version)) + 1;
    await s.db.insert("icp_versions", { config: { ...d.config, version: next }, blocklist: { domains: d.blocklist }, reason });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "That did not work." };
  }
  revalidatePath("/icp");
  redirect("/icp?saved=1");
}

export async function signOff(_prev: SaveState | null, f: FormData): Promise<SaveState> {
  const s = await admin();
  if (!s) return { ok: false, message: "Only an admin can sign off an ICP version." };
  if (f.get("understood") !== "on") return { ok: false, message: "Tick the box to confirm you have read the rubric." };
  try {
    await s.db.insert("icp_signoffs", { icp_version_id: String(f.get("version") ?? ""), note: String(f.get("note") ?? "").slice(0, 300) });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "That did not work." };
  }
  revalidatePath("/icp");
  revalidatePath("/settings");
  return { ok: true, message: "Signed off. New runs will use this version." };
}

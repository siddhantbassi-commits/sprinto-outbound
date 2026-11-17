"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/app/runtime";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** Pausing and resuming are decisions: recorded with a reason and the person's name, never silent. */
export async function pauseOrResume(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const s = await getSession();
  if (!s || (s.user.role !== "operator" && s.user.role !== "admin")) return { ok: false, message: "Only an operator or admin can do that." };
  const runId = String(formData.get("run") ?? "");
  const kind = formData.get("kind") === "resume_run" ? "resume_run" : "pause_run";
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) return { ok: false, message: "Give a short reason (at least 3 characters)." };
  try {
    await s.db.insert("decisions", { run_id: runId, kind, reason: reason.slice(0, 300) });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "That did not work." };
  }
  revalidatePath(`/runs/${runId}`);
  revalidatePath("/");
  return { ok: true, message: kind === "pause_run" ? "Paused. No new step will start for this run." : "Resumed." };
}

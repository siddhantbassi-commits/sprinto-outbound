"use server";
import { revalidatePath } from "next/cache";
import { getSession, goldenSetup } from "@/lib/app/runtime";
import { runAndRecord } from "@/lib/quality/record";

export interface GoldenState {
  ok: boolean;
  message: string;
}

/** Runs the golden set now and keeps the result. Operators and admins only: it spends model calls. */
export async function runGoldenNow(): Promise<GoldenState> {
  const s = await getSession();
  if (!s || (s.user.role !== "operator" && s.user.role !== "admin")) return { ok: false, message: "Only an operator or admin can run the golden set." };
  const setup = goldenSetup();
  if (!setup.ok) return { ok: false, message: setup.reason };
  try {
    const r = await runAndRecord({ db: s.db, ai: setup.ai, source: setup.source, trigger: "manual" });
    if (!r.ok) return { ok: false, message: r.reason };
    revalidatePath("/quality");
    const x = r.run.summary;
    return { ok: x.status === "pass", message: x.status === "pass" ? "The golden set passed." : `The golden set ${x.status === "warn" ? "raised a warning" : "failed"}. ${x.reasons.join(" ")}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The golden set could not be run." };
  }
}

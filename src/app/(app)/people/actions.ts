"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/app/runtime";

export interface ActionResult { ok: boolean; message: string }

export async function changeRole(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  const s = await getSession();
  if (!s || s.user.role !== "admin" || s.guest) return { ok: false, message: "Only the owner can change roles." };
  const user = String(f.get("user") ?? "");
  const role = String(f.get("role") ?? "");
  if (!["pending", "viewer", "operator", "admin", "worker"].includes(role)) return { ok: false, message: "That is not a role." };
  try {
    await s.db.rpc("set_user_role", { p_user: user, p_role: role });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "That did not work." };
  }
  revalidatePath("/people");
  return { ok: true, message: "Saved." };
}

"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readEnv } from "@/lib/env";

/** Demo mode only: act as a different kind of person, to see what each role can and cannot do. */
export async function setDemoRole(formData: FormData) {
  if (readEnv().mode !== "demo") return;
  const role = String(formData.get("role") ?? "");
  if (!["admin", "operator", "viewer", "pending"].includes(role)) return;
  (await cookies()).set("demo_role", role, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
  redirect("/");
}

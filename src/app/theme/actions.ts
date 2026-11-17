"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

/** Remembers light, dark or "follow my computer" in a plain cookie, so the first paint is already the right theme. */
export async function setTheme(formData: FormData): Promise<void> {
  const v = String(formData.get("theme") ?? "");
  const store = await cookies();
  if (v === "light" || v === "dark") store.set("theme", v, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  else store.delete("theme");
  revalidatePath("/", "layout");
}

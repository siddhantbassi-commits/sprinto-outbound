"use server";
import { revalidatePath } from "next/cache";
import { getSession, type AppSession } from "@/lib/app/runtime";
import { isPlainAddress } from "@/lib/email/mime";
import { PLACEHOLDER, type SprintoFactsFile } from "@/lib/pitch/sprinto-facts";
import { pinGuestSettings } from "@/lib/app/guest";

export interface ActionResult { ok: boolean; message: string }

const err = (e: unknown) => (e instanceof Error ? e.message : "That did not work.");
const text = (f: FormData, k: string, max = 300) => String(f.get(k) ?? "").trim().slice(0, max);
const int = (f: FormData, k: string) => Number.parseInt(String(f.get(k) ?? ""), 10);

async function as(role: "admin" | "operator"): Promise<AppSession | null> {
  const s = await getSession();
  if (!s) return null;
  return role === "admin" ? (s.user.role === "admin" ? s : null) : s.user.role === "admin" || s.user.role === "operator" ? s : null;
}
const done = (path: string, message: string): ActionResult => (revalidatePath(path), { ok: true, message });

/** A change to the settings is a new row with a reason. The database checks every range; this only turns the form into a row. */
export async function saveSettings(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  const s = await as("admin");
  if (!s) return { ok: false, message: "Only an admin can change settings." };
  const reason = text(f, "reason");
  if (reason.length < 3) return { ok: false, message: "Say why you are changing it (at least 3 characters)." };
  const testTo = text(f, "test_to", 254);
  if (testTo && !isPlainAddress(testTo)) return { ok: false, message: "The test address must be one plain email address." };
  const row = {
    test_to: testTo || null, sender_name: text(f, "sender_name", 60), sender_title: text(f, "sender_title", 80), postal_address: text(f, "postal_address", 200),
    daily_send_cap: int(f, "daily_send_cap"), max_run_size: int(f, "max_run_size"), max_parallel: int(f, "max_parallel"), hunter_reserve: int(f, "hunter_reserve"),
    tokens_per_domain: int(f, "tokens_per_domain"), tokens_per_run: int(f, "tokens_per_run"), mail_cooldown_days: int(f, "mail_cooldown_days"),
    minutes_saved_per_email: Number(String(f.get("minutes_saved_per_email") ?? "")), review_minutes_per_email: Number(String(f.get("review_minutes_per_email") ?? "")), review_minutes_per_decision: Number(String(f.get("review_minutes_per_decision") ?? "")), reason,
    // A checkbox that is not ticked is absent from the form, so absence means off. Approval is on unless a person turns it off here.
    require_approval: f.get("require_approval") === "on",
  };
  if (Object.values(row).some((v) => typeof v === "number" && !Number.isFinite(v))) return { ok: false, message: "Every number needs a value." };
  try {
    // A guest may change the sender and the wording, but not what can be spent or where mail goes: those stay at the owner's values.
    let final: typeof row = row;
    if (s.guest) {
      const [previous] = await s.db.select("settings_versions", {}, { order: "created_at", ascending: false, limit: 1 });
      final = pinGuestSettings(row, previous ?? null) as typeof row;
    }
    await s.db.insert("settings_versions", final);
  } catch (e) {
    return { ok: false, message: err(e) };
  }
  return done("/settings", "Saved as a new version. Future runs use it.");
}

async function latestFile(s: AppSession): Promise<SprintoFactsFile> {
  const [row] = await s.db.select("sprinto_facts_versions", {}, { order: "version", ascending: false, limit: 1 });
  return row!.content as SprintoFactsFile;
}

/** A claim about Sprinto can be used in an email only after a person has checked it against its source and put their name to it. */
export async function verifyClaim(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  const s = await as("admin");
  if (!s) return { ok: false, message: "Only an admin can verify a claim." };
  if (f.get("checked") !== "on") return { ok: false, message: "Tick the box to confirm you checked it against its source." };
  const id = text(f, "claim_id", 20);
  try {
    const file = await latestFile(s);
    if (!file.items.some((i) => i.id === id)) return { ok: false, message: "That claim no longer exists." };
    const items = file.items.map((i) => (i.id === id ? { ...i, verifiedBy: s.user.email, verifiedAt: new Date().toISOString().slice(0, 10) } : i));
    await s.db.insert("sprinto_facts_versions", { content: { ...file, items }, reason: `Verified ${id}` });
  } catch (e) {
    return { ok: false, message: err(e) };
  }
  return done("/settings", "Verified, with your name and today's date.");
}

export async function addClaim(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  const s = await as("admin");
  if (!s) return { ok: false, message: "Only an admin can add a claim." };
  const claim = text(f, "claim", 300);
  const source = text(f, "source", 300);
  const kind = ["audience", "frameworks", "proof"].includes(text(f, "kind", 20)) ? text(f, "kind", 20) : "proof";
  if (claim.length < 10 || PLACEHOLDER.test(claim)) return { ok: false, message: "Write the claim as one plain sentence." };
  if (source.length < 5) return { ok: false, message: "Say where it can be checked (a web address or document)." };
  try {
    const file = await latestFile(s);
    const n = file.items.reduce((m, i) => Math.max(m, Number(i.id.replace(/\D/g, "")) || 0), 0) + 1;
    const items = [...file.items, { id: `F${n}`, kind, claim, sourceUrl: source, verifiedBy: null, verifiedAt: null }];
    await s.db.insert("sprinto_facts_versions", { content: { ...file, items }, reason: `Added claim F${n}, not yet verified` });
  } catch (e) {
    return { ok: false, message: err(e) };
  }
  return done("/settings", "Added. It cannot be used in an email until it is verified.");
}

export async function addSuppression(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  const s = await as("operator");
  if (!s) return { ok: false, message: "Only an operator or admin can do that." };
  const kind = f.get("kind") === "address" ? "address" : "domain";
  const value = text(f, "value", 254).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (value.length < 3 || /\s/.test(value)) return { ok: false, message: "Enter a domain or an email address." };
  if (kind === "address" && !isPlainAddress(value)) return { ok: false, message: "That is not a plain email address." };
  if (text(f, "reason").length < 3) return { ok: false, message: "Give a short reason (at least 3 characters)." };
  try {
    await s.db.insert("suppressions", { kind, value, action: "add", reason: text(f, "reason") });
  } catch (e) {
    return { ok: false, message: err(e) };
  }
  return done("/settings", `${value} will not be contacted.`);
}

export async function liftSuppression(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  const s = await as("operator");
  if (!s) return { ok: false, message: "Only an operator or admin can do that." };
  // A do-not-contact entry protects someone's wishes, so only the owner may lift one.
  if (s.guest) return { ok: false, message: "Only the owner can lift a do-not-contact entry." };
  if (text(f, "reason").length < 3) return { ok: false, message: "Give a short reason (at least 3 characters)." };
  try {
    await s.db.insert("suppressions", { kind: text(f, "kind", 10) === "address" ? "address" : "domain", value: text(f, "value", 254), action: "lift", reason: text(f, "reason") });
  } catch (e) {
    return { ok: false, message: err(e) };
  }
  return done("/settings", "Lifted. The history keeps both rows.");
}

export async function addManualContact(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  const s = await as("operator");
  if (!s) return { ok: false, message: "Only an operator or admin can do that." };
  const domain = text(f, "domain", 253).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const email = text(f, "email", 254);
  const first = text(f, "first_name", 40);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { ok: false, message: "Enter the company's domain." };
  if (!isPlainAddress(email)) return { ok: false, message: "Enter one plain email address." };
  if (!/^\p{L}[\p{L}'’. -]{0,39}$/u.test(first)) return { ok: false, message: "Enter a first name (letters only)." };
  if (text(f, "position", 80).length < 2) return { ok: false, message: "Enter the person's job title." };
  try {
    await s.db.insert("manual_contacts", { domain, first_name: first, last_name: text(f, "last_name", 60) || null, position: text(f, "position", 80), email });
  } catch (e) {
    return { ok: false, message: err(e) };
  }
  return done("/settings", "Saved. It will be used the next time this domain is looked up.");
}

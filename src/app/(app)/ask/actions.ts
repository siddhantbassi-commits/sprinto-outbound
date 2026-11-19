"use server";
import { ask, type Evidence } from "@/lib/ask/ask";
import type { Unsupported } from "@/lib/ask/check";
import { createGuard } from "@/lib/ask/limit";
import { countToday, guestMayAsk } from "@/lib/app/guest";
import { guestSerial } from "@/lib/app/guest-load";
import { askSetup, getSession } from "@/lib/app/runtime";

export interface AskItem {
  id: number;
  question: string;
  ok: boolean;
  /** The answer, or the plain reason there is none. */
  text: string;
  evidence: Evidence[];
  unsupported: Unsupported;
  model: string;
  tokens: number;
  standIn: boolean;
}
export interface AskState {
  history: AskItem[];
  /** A problem with the request itself (not signed in, rate limit), shown above the form. */
  notice?: string;
}

const MAX_HISTORY = 10;
const guard = createGuard({ max: 10, windowMs: 10 * 60_000 });
let counter = 0;

/** Answers one question, read-only, as the signed-in person. Anyone approved may ask; a person awaiting approval may not. */
export async function askQuestion(prev: AskState | null, f: FormData): Promise<AskState> {
  const history = prev?.history ?? [];
  const s = await getSession();
  if (!s || s.user.role === "pending") return { history, notice: "You need to be approved before you can ask questions." };
  const setup = askSetup();
  if (!setup.ok) return { history, notice: setup.reason };

  // A guest's questions are counted in the database, so the daily limit holds across servers. It fails closed: if the count cannot be
  // read or written (for example before the table exists), the question is not asked.
  if (s.guest) {
    const refused = await guestSerial("ask", async (): Promise<string | null> => {
      try {
        const rows = await s.db.select("ask_log", {}, { order: "created_at", ascending: false, limit: 300 });
        const verdict = guestMayAsk(countToday(rows, s.user.id, Date.now()));
        if (!verdict.ok) return verdict.message;
        await s.db.rpc("log_ask", { p_tokens: 0 });
        return null;
      } catch {
        return "Ask is paused for guests right now, so nothing was spent. Everything researched is still open to read.";
      }
    });
    if (refused) return { history, notice: refused };
  }

  const entry = guard.enter(s.user.id);
  if (!entry.ok) return { history, notice: entry.reason };
  try {
    const question = String(f.get("question") ?? "");
    const r = await ask({ ai: setup.ai, db: s.db, question });
    const item: AskItem = {
      id: ++counter,
      question: question.replace(/\s+/g, " ").trim().slice(0, 500),
      ok: r.ok,
      text: r.ok ? r.answer : r.message,
      evidence: r.evidence,
      unsupported: r.ok ? r.unsupported : { domains: [], numbers: [] },
      model: r.ok ? r.model : "",
      tokens: r.usage.totalTokens,
      standIn: setup.standIn,
    };
    // An empty question is a slip of the finger, not an answer worth keeping.
    if (!r.ok && (r.code === "empty" || r.code === "too_long")) return { history, notice: r.message };
    return { history: [item, ...history].slice(0, MAX_HISTORY) };
  } finally {
    entry.release();
  }
}

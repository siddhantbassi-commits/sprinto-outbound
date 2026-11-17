"use client";
import { useActionState, useEffect, type ReactNode } from "react";
import { toast } from "./toast";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** A form wired to a server action that reports back in words: what happened, or why it did not. */
export function ActionForm({ action, children, submit, tone = "primary", inline = false }: { action: (prev: ActionResult | null, f: FormData) => Promise<ActionResult>; children: ReactNode; submit: string; tone?: "primary" | "danger" | "plain"; inline?: boolean }) {
  const [r, run, pending] = useActionState<ActionResult | null, FormData>(action, null);
  useEffect(() => { if (r) toast(r.message, r.ok); }, [r]);
  return (
    <form action={run} className={inline ? "inline" : "stack"} aria-busy={pending}>
      {children}
      <div className="row">
        <button className={`btn ${tone === "plain" ? "" : tone} small`} type="submit" disabled={pending}>{pending ? "Saving…" : submit}</button>
        {r ? <span className="small" role="status" style={{ color: r.ok ? "var(--good)" : "var(--bad)" }}>{r.message}</span> : null}
      </div>
    </form>
  );
}

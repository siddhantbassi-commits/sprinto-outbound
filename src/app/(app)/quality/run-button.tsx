"use client";
import { useActionState } from "react";
import { runGoldenNow, type GoldenState } from "./actions";

export function RunGolden({ scripted }: { scripted: boolean }) {
  const [r, action, pending] = useActionState<GoldenState | null>(() => runGoldenNow(), null);
  return (
    <form action={action} className="inline">
      <button className="btn primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Reading the companies…" : scripted ? "Run the golden set (scripted)" : "Run the golden set now"}</button>
      {r ? <span className="small" role="status" aria-live="polite" style={{ color: r.ok ? "var(--good)" : "var(--bad)" }}>{r.message}</span> : null}
    </form>
  );
}

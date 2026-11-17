"use client";
import { useActionState } from "react";
import { pauseOrResume, type ActionResult } from "./actions";

export function RunControls({ runId, paused }: { runId: string; paused: boolean }) {
  const [res, action, pending] = useActionState<ActionResult | null, FormData>(pauseOrResume, null);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="run" value={runId} />
      <input type="hidden" name="kind" value={paused ? "resume_run" : "pause_run"} />
      <input type="text" name="reason" required minLength={3} maxLength={300} placeholder={paused ? "Why resume?" : "Why pause?"} aria-label="Reason" />
      <button className={`btn small ${paused ? "primary" : ""}`} type="submit" disabled={pending}>{paused ? "Resume run" : "Pause run"}</button>
      {res ? <span className={`small ${res.ok ? "muted" : ""}`} role="status" style={res.ok ? undefined : { color: "var(--bad)" }}>{res.message}</span> : null}
    </form>
  );
}

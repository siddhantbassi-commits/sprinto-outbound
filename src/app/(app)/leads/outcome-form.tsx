"use client";
import { useActionState, useEffect, useState } from "react";
import { logOutcome, type OutcomeResult } from "./actions";
import { toast } from "@/components/toast";
import { OUTCOMES, OUTCOME_BY_ID, type OutcomeId } from "@/lib/app/outcomes";

/** One small form: what happened, a note, and (for a lead that is still open) when to come back to it. */
export function OutcomeForm({ prospectId, current }: { prospectId: string; current?: OutcomeId | null }) {
  const [state, action, pending] = useActionState<OutcomeResult | null, FormData>(logOutcome, null);
  const [status, setStatus] = useState<OutcomeId>(current && OUTCOME_BY_ID[current].open ? current : "reached_out");
  const open = OUTCOME_BY_ID[status].open;
  useEffect(() => {
    if (state) toast(state.message, state.ok);
  }, [state]);

  return (
    <form action={action} className="outform">
      <input type="hidden" name="id" value={prospectId} />
      <label>
        <span>What happened</span>
        <select name="status" value={status} onChange={(e) => setStatus(e.target.value as OutcomeId)}>
          {OUTCOMES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <span className="hint">{OUTCOME_BY_ID[status].help}</span>
      </label>
      <label>
        <span>Note <span className="hint">optional</span></span>
        <input type="text" name="note" maxLength={500} placeholder="Who you spoke to, what they said" />
      </label>
      {open ? (
        <label>
          <span>Follow up on <span className="hint">optional</span></span>
          <input type="date" name="follow_up" />
        </label>
      ) : null}
      {status === "not_interested" ? <label className="tickline"><input type="checkbox" name="dnc" /> Never contact this company again</label> : null}
      <div className="row">
        <button className="btn primary small" type="submit" disabled={pending}>{pending ? "Saving…" : "Record"}</button>
        {state && !state.ok ? <span className="small" style={{ color: "var(--bad)" }} role="alert">{state.message}</span> : null}
      </div>
    </form>
  );
}

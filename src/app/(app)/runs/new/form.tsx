"use client";
import { useActionState, useState } from "react";
import { checkList, startRun, type CheckResult, type StartResult } from "./actions";
import { Banner } from "@/components/ui";

export function NewRunForm() {
  const [check, checkAction, checking] = useActionState<CheckResult | null, FormData>(checkList, null);
  const [start, startAction, starting] = useActionState<StartResult | null, FormData>(startRun, null);
  // Controlled, because a form action resets plain fields and a person should never lose what they pasted.
  const [text, setText] = useState("");
  const list = check?.ok ? check.list : undefined;
  const skipped = new Set([...(check?.suppressed ?? []), ...(check?.recent ?? [])]);
  const going = list ? list.valid.filter((d) => !skipped.has(d)) : [];

  return (
    <div className="stack">
      <form action={checkAction} className="card stack">
        <h2>1. Add the domains</h2>
        <label>
          Paste domains
          <span className="hint">One per line, or comma separated. Web addresses are fine; the path is ignored.</span>
          <textarea name="domains" value={text} onChange={(e) => setText(e.target.value)} placeholder={"acme.com\nbeta.io\nhttps://www.gamma.co.uk/about"} spellCheck={false} />
        </label>
        <label>
          …or upload a CSV
          <span className="hint">With a column headed domain, website or url. Up to 1 MB. If you choose a file it is used instead of the box above.</span>
          <input type="file" name="file" accept=".csv,.txt,text/csv,text/plain" />
        </label>
        <div className="row">
          <button className="btn primary" type="submit" disabled={checking}>{checking ? "Checking…" : "Check the list"}</button>
          <span className="formnote">Nothing runs yet. This only checks the list and shows what it would cost.</span>
        </div>
        {check && !check.ok ? <Banner tone="bad" title="Could not check that">{check.message}</Banner> : null}
      </form>

      {list ? (
        <section className="card stack" aria-live="polite">
          <h2>2. Check what will happen</h2>
          <div className="grid">
            <div className="stat"><b>{going.length}</b><span>domains will run</span></div>
            <div className="stat"><b>{skipped.size}</b><span>skipped (suppressed or mailed recently)</span></div>
            <div className="stat"><b>{list.rejected.length}</b><span>not valid domains</span></div>
            <div className="stat"><b>{list.duplicates}</b><span>repeats removed</span></div>
          </div>

          {check?.maxRun && going.length + skipped.size > check.maxRun ? <Banner tone="bad" title={`This is over the run limit of ${check.maxRun}`}>Remove some domains, or an admin can raise the limit in Settings.</Banner> : null}
          {list.truncated ? <Banner tone="warn" title="The list was cut">Only the first 1,000 entries were read.</Banner> : null}
          {check?.plan ? <Banner tone={check.plan.trimmed ? "warn" : "info"} title="Hunter credits">{check.plan.message}</Banner> : null}
          {check?.hunterError ? <Banner tone="warn" title="Could not read Hunter's balance">{check.hunterError} Domains with no hand-picked contact will wait in the review lane if Hunter cannot be reached.</Banner> : null}
          {check && !check.plan && !check.hunterError ? <Banner tone="warn" title="Hunter is not set up">Only domains with a hand-picked contact can get an email.</Banner> : null}

          {list.rejected.length ? (
            <details>
              <summary>{list.rejected.length} entries were not valid domains</summary>
              <div className="tablewrap"><table><thead><tr><th>Entry</th><th>Why not</th></tr></thead><tbody>
                {list.rejected.slice(0, 50).map((r, i) => <tr key={i}><td className="mono">{r.input}</td><td>{r.problem}</td></tr>)}
              </tbody></table></div>
            </details>
          ) : null}
          {skipped.size ? <p className="small muted">Skipped: {[...skipped].slice(0, 12).join(", ")}{skipped.size > 12 ? "…" : ""}. They stay on the run as “Skipped”, with the reason.</p> : null}

          <form action={startAction} className="stack">
            <input type="hidden" name="domains" value={JSON.stringify(list.valid)} />
            <input type="hidden" name="source" value={check?.source ?? "paste"} />
            <label>
              Name this run <span className="hint">(optional)</span>
              <input type="text" name="note" maxLength={120} placeholder="Series A SaaS, EU" />
            </label>
            <div className="row">
              <button className="btn primary" type="submit" disabled={starting || list.valid.length === 0}>{starting ? "Starting…" : `Start the run (${list.valid.length} ${list.valid.length === 1 ? "domain" : "domains"})`}</button>
              <span className="formnote">Emails go to the test address only.</span>
            </div>
            {start ? <Banner tone="bad" title="The run did not start">{start.message}</Banner> : null}
          </form>
        </section>
      ) : null}
    </div>
  );
}

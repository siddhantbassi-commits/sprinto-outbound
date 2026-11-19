"use client";
import { useActionState, useMemo, useState } from "react";
import { checkList, startRun, type CheckResult, type StartResult } from "./actions";
import { CountUp } from "@/components/count-up";
import { Icon } from "@/components/icons";
import { Banner, SectionTitle } from "@/components/ui";
import { cleanPaste } from "@/lib/app/paste";

// The demo's own invented companies, and for the real app a few real ones that fit the ICP, shown in the three shapes a list can take.
const EXAMPLE_DEMO = "northwind.io\nhttps://www.cobaltledger.io/pricing\nPaul Tran <paul@harborpay.com>\norbit-labs.dev";
const EXAMPLE_REAL = "documenso.com\nhttps://www.trigger.dev/about\nAlex Kim <alex@cal.com>";

export interface RunFacts {
  approval: boolean;
  dailyCap: number | null;
  testTo: string | null;
  maxRun: number | null;
  /** The demo, where the example list is invented companies. */
  demo?: boolean;
}

const NEXT: [string, string, "globe" | "target" | "people" | "mail"][] = [
  ["Read", "Each site is fetched politely, respecting robots.txt, and only the pages that can answer a question.", "globe"],
  ["Judge", "Scored against your signed-off ICP. Every point traces to a quote from the site.", "target"],
  ["Match", "One named person is chosen: a hand-picked contact first, then Hunter.", "people"],
  ["Write", "A short email from what the site actually says, held for your approval.", "mail"],
];

export function NewRunForm({ facts }: { facts: RunFacts }) {
  const [check, checkAction, checking] = useActionState<CheckResult | null, FormData>(checkList, null);
  const [start, startAction, starting] = useActionState<StartResult | null, FormData>(startRun, null);
  // Controlled, because a form action resets plain fields and a person should never lose what they pasted.
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [over, setOver] = useState(false);
  const live = useMemo(() => cleanPaste(text), [text]);
  const list = check?.ok ? check.list : undefined;
  const skipped = new Set([...(check?.suppressed ?? []), ...(check?.recent ?? [])]);
  const going = list ? list.valid.filter((d) => !skipped.has(d)) : [];
  const overLimit = !!(check?.maxRun && going.length + skipped.size > check.maxRun);
  const stage = list ? 2 : 1;
  const tidy = live.domains.join("\n");
  const messy = live.domains.length > 0 && tidy !== text.trim();

  return (
    <div className="stack" style={{ gap: 22 }}>
      <ol className="stepper" aria-label="Progress">
        <li className={stage > 1 ? "done" : "now"}>Add</li>
        <li className={stage > 2 ? "done" : stage === 2 ? "now" : ""}>Check</li>
        <li className={starting ? "now" : ""}>Start</li>
      </ol>

      <div className="split">
        <form action={checkAction} className="card stack">
          <SectionTitle icon="plus" title="Add the companies" sub="Paste anything: a column from a spreadsheet, an email thread, a list of links. The domains are found for you." />
          <label>
            <span className="sr-only">Domains</span>
            <textarea name="domains" value={text} onChange={(e) => setText(e.target.value)} placeholder={"acme.com\nhttps://www.beta.io/about\nsam@gamma.co.uk"} spellCheck={false} aria-describedby="live" style={{ minHeight: 190 }} />
          </label>

          <div id="live" className="livebar" aria-live="polite">
            {text.trim() === "" ? (
              <span className="muted small">Nothing yet. <button type="button" className="linkbtn" onClick={() => setText(facts.demo ? EXAMPLE_DEMO : EXAMPLE_REAL)}>Try an example</button></span>
            ) : live.domains.length === 0 && !live.csv ? (
              <span className="small" style={{ color: "var(--warn)" }}><Icon name="alert" />No domains found yet. A domain looks like acme.com.</span>
            ) : (
              <>
                <span className="chip good"><Icon name="check" /><b><CountUp to={live.domains.length} ms={350} /></b>&nbsp;{live.domains.length === 1 ? "company" : "companies"} found</span>
                {live.fromEmails ? <span className="chip">{live.fromEmails} from email addresses</span> : null}
                {live.duplicates ? <span className="chip">{live.duplicates} repeats folded</span> : null}
                {live.unclear.length ? <span className="chip warn" title={live.unclear.join("\n")}>{live.unclear.length} not usable</span> : null}
                {live.csv ? <span className="chip">CSV: the named column is read</span> : null}
                {messy && !live.csv ? <button type="button" className="linkbtn" onClick={() => setText(tidy)}>Tidy the list</button> : null}
                <button type="button" className="linkbtn" onClick={() => setText("")}>Clear</button>
              </>
            )}
          </div>

          <div
            className={`dropzone${over ? " over" : ""}${fileName ? " has" : ""}`}
            onDragEnter={() => setOver(true)} onDragLeave={() => setOver(false)} onDrop={() => setOver(false)}
          >
            <Icon name={fileName ? "check" : "plus"} />
            <span>{fileName ? <><b>{fileName}</b> will be used instead of the box above.</> : <><b>Or drop a CSV here</b>, or click to choose one. It needs a column headed domain, website or url. Up to 1 MB.</>}</span>
            <input type="file" name="file" accept=".csv,.txt,text/csv,text/plain" aria-label="Upload a CSV" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
          </div>

          <div className="row">
            <button className="btn primary" type="submit" disabled={checking || (!fileName && live.domains.length === 0 && !live.csv && text.trim() === "")}>{checking ? "Checking…" : "Check the list"}<Icon name="arrow" /></button>
            <span className="formnote">Nothing runs yet. This checks the list and shows what it would cost.</span>
          </div>
          {check && !check.ok ? <Banner tone="bad" title="Could not check that">{check.message}</Banner> : null}
        </form>

        <aside className="stack tight" aria-label="What happens next">
          <div className="card stack">
            <h3 style={{ fontSize: "1rem" }}>What happens to each company</h3>
            <ol className="nextlist stagger">
              {NEXT.map(([t, d, icon]) => (
                <li key={t}><span className="ic"><Icon name={icon} /></span><span><b>{t}</b><small>{d}</small></span></li>
              ))}
            </ol>
          </div>
          <div className="card stack tight">
            <h3 style={{ fontSize: "1rem" }}>Safeguards for this run</h3>
            <dl className="kv" style={{ gridTemplateColumns: "110px minmax(0, 1fr)" }}>
              <dt>Approval</dt><dd>{facts.approval ? "You approve each email" : "Off: sends without approval"}</dd>
              <dt>Mail goes to</dt><dd>{facts.testTo ?? "nobody yet (set a test address)"}</dd>
              <dt>Daily cap</dt><dd>{facts.dailyCap ?? "-"} emails</dd>
              <dt>Run limit</dt><dd>{facts.maxRun ?? "-"} domains</dd>
            </dl>
          </div>
        </aside>
      </div>

      {list ? (
        <section className="card stack" aria-live="polite" style={{ animation: "rise 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both" }}>
          <SectionTitle icon="check" title="Check what will happen" sub="Review the numbers, then start. You can still stop a run once it has begun." />
          <div className="grid">
            <div className="stat"><b><CountUp to={going.length} /></b><span>domains will run</span></div>
            <div className="stat"><b><CountUp to={skipped.size} /></b><span>skipped (suppressed or mailed recently)</span></div>
            <div className="stat"><b><CountUp to={list.rejected.length} /></b><span>not valid domains</span></div>
            <div className="stat"><b><CountUp to={list.duplicates} /></b><span>repeats removed</span></div>
          </div>

          {overLimit ? <Banner tone="bad" title={`This is over the run limit of ${check?.maxRun}`}>Remove some domains, or an admin can raise the limit in Settings.</Banner> : null}
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
              <button className="btn primary large" type="submit" disabled={starting || list.valid.length === 0 || overLimit}>{starting ? "Starting…" : `Start the run (${list.valid.length} ${list.valid.length === 1 ? "domain" : "domains"})`}<Icon name="arrow" /></button>
              <span className="formnote">{facts.approval ? "Each email waits for your approval." : "Approval is off."} Mail goes to the test address only.</span>
            </div>
            {start ? <Banner tone="bad" title="The run did not start">{start.message}</Banner> : null}
          </form>
        </section>
      ) : null}
    </div>
  );
}

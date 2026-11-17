"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Banner, Pill } from "@/components/ui";
import { askQuestion, type AskItem, type AskState } from "./actions";

const SUGGESTIONS = ["Who is waiting for a person?", "Which companies had no usable contact?", "How many companies are in each outcome?", "Why was petalpop.app not a fit?", "Tell me about harborpay.com", "What are the send rules?"];

const argText = (a: Record<string, unknown>) => Object.entries(a).map(([k, v]) => `${k}: ${String(v)}`).join(", ");

function Answer({ item }: { item: AskItem }) {
  const bad = item.unsupported.domains.length + item.unsupported.numbers.length > 0;
  const links = new Map(item.evidence.flatMap((e) => e.companies).map((c) => [c.domain, c.id]));
  return (
    <article className="card stack" aria-label={`Answer to: ${item.question}`}>
      <p className="muted" style={{ margin: 0 }}>{item.question}</p>
      {item.ok ? (
        <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "1.02rem" }}>{item.text}</p>
      ) : (
        <Banner tone="warn" title="No answer">{item.text}</Banner>
      )}
      {item.ok && bad ? (
        <Banner tone="warn" title="Check these against what it looked at">
          {[item.unsupported.domains.length ? `Not in any lookup: ${item.unsupported.domains.join(", ")}.` : "", item.unsupported.numbers.length ? `Numbers not found in any lookup (they may be the model's own arithmetic): ${item.unsupported.numbers.join(", ")}.` : ""].filter(Boolean).join(" ")}
        </Banner>
      ) : null}
      {links.size ? (
        <p className="small" style={{ margin: 0 }}>Open the Why page: {[...links].map(([d, id], i) => <span key={id}>{i ? " · " : ""}<Link href={`/prospects/${id}`}>{d}</Link></span>)}</p>
      ) : null}
      <details>
        <summary>What it looked at ({item.evidence.length})</summary>
        <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
          {item.evidence.length === 0 ? <li className="muted">Nothing: it did not look anything up.</li> : null}
          {item.evidence.map((e, i) => (
            <li key={i}>
              <span className="tag">{e.tool}</span> {Object.keys(e.args).length ? <span className="small muted">({argText(e.args)})</span> : null} {e.error ? <span style={{ color: "var(--bad)" }}>{e.error}</span> : e.summary}
              {e.flagged.length ? <> <Pill tone="warn" title="The stored text contains something that reads like an instruction. The model was told it is only data.">Looks like instructions</Pill></> : null}
            </li>
          ))}
        </ul>
      </details>
      <p className="small muted" style={{ margin: 0 }}>{item.standIn ? "Answered by the demo stand-in, which picks lookups by keyword, not by understanding. " : ""}{item.tokens.toLocaleString("en-GB")} tokens{item.model ? ` · ${item.model}` : ""}. Read-only: nothing was changed.</p>
    </article>
  );
}

export function AskForm() {
  const [state, action, pending] = useActionState<AskState | null, FormData>(askQuestion, null);
  const [question, setQuestion] = useState("");
  const [seen, setSeen] = useState(0);
  // Clear the box once a new answer has arrived, not before: a refused question keeps its text so it can be fixed.
  const latest = state?.history[0]?.id ?? 0;
  if (latest !== seen) {
    setSeen(latest);
    setQuestion("");
  }
  return (
    <div className="stack">
      <form action={action} className="card stack">
        <label htmlFor="q">Your question</label>
        <textarea id="q" name="question" rows={3} maxLength={500} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="For example: why did we skip a company, or who is waiting for a person?" required />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="small muted">{question.length} of 500</span>
          <button className="btn primary" type="submit" disabled={pending || question.trim().length === 0} aria-busy={pending}>{pending ? "Looking it up…" : "Ask"}</button>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }} aria-label="Example questions">
          {SUGGESTIONS.map((s) => <button key={s} type="button" className="btn small" onClick={() => setQuestion(s)}>{s}</button>)}
        </div>
      </form>
      {state?.notice ? <Banner tone="warn" title={state.notice} /> : null}
      {state?.history.map((h) => <Answer key={h.id} item={h} />)}
    </div>
  );
}

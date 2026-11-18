"use client";
import { useActionState, type ReactNode } from "react";
import { addContact, doNotContact, resolveUnknown, resume, type ActionResult } from "./actions";

type Act = (prev: ActionResult | null, f: FormData) => Promise<ActionResult>;

function Msg({ r }: { r: ActionResult | null }) {
  if (!r) return null;
  return <span className="small" role="status" style={{ color: r.ok ? "var(--good)" : "var(--bad)" }}>{r.message}</span>;
}

function Form({ action, children, title, help }: { action: Act; children: ReactNode; title: string; help?: string }) {
  const [r, run, pending] = useActionState<ActionResult | null, FormData>(action, null);
  return (
    <form action={run} className="stack" style={{ padding: "4px 0" }} aria-busy={pending}>
      <div><h3>{title}</h3>{help ? <p className="small muted" style={{ margin: 0 }}>{help}</p> : null}</div>
      {children}
      <Msg r={r} />
    </form>
  );
}

export function ProspectActions({ id, lane, domain, verdict }: { id: string; lane: string; domain?: string; verdict?: string | null }) {
  // A "maybe" waits for a person before any Hunter credit is spent. Promoting it is the step that carries it on, so it gets its own plain card.
  const promotable = lane === "review" && verdict === "maybe";
  const resumable = ["review", "held", "needs_more", "failed", "no_contact"].includes(lane);
  const finished = lane === "sent" || lane === "not_fit" || lane === "skipped";
  const body = (
    <>
      <div className="grid">
        {promotable ? (
          <Form action={resume} title="Promote this company" help="It scored as a maybe, so nothing has been spent on it yet. Promoting it looks up the contact with Hunter (one credit) and writes the email. Your reason is recorded.">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="kind" value="promote" />
            <div className="row">
              <input type="text" name="reason" required minLength={3} maxLength={300} defaultValue="Strong enough signals to justify a discovery call" aria-label="Reason for promoting" />
              <button className="btn primary small" type="submit">Promote: find the contact</button>
            </div>
          </Form>
        ) : null}
        {resumable && !promotable ? (
          <Form action={resume} title="Try again" help="Put it back in the queue. It carries on from the step where it stopped; the decision is recorded with your reason.">
            <input type="hidden" name="id" value={id} />
            <div className="row">
              <input type="text" name="reason" required minLength={3} maxLength={300} placeholder="Why?" aria-label="Reason" />
              <select name="kind" aria-label="Kind of decision" style={{ width: "auto" }}><option value="promote">Promote</option><option value="rerun">Re-run</option></select>
              <button className="btn primary small" type="submit">Put back in the queue</button>
            </div>
          </Form>
        ) : null}
        {lane === "unknown" ? (
          <Form action={resolveUnknown} title="Resolve the unknown send" help="Gmail may or may not have sent this. Search your Sent folder for the X-Outbound-Run header shown below, then say what you found. Nothing retries it for you.">
            <input type="hidden" name="id" value={id} />
            <label>What did you find?
              <select name="outcome"><option value="sent">It is in Sent: it was sent</option><option value="failed">It is not in Sent: it was not sent</option></select>
            </label>
            <label>What you checked <input type="text" name="reason" required minLength={3} maxLength={300} placeholder="Searched Sent for the header" /></label>
            <div><button className="btn primary small" type="submit">Record it</button></div>
          </Form>
        ) : null}
        {domain && lane !== "skipped" ? (
          <Form action={doNotContact} title="Do not contact" help="Adds this domain to the suppression list so it is never mailed. Lifting it later is a new, recorded row.">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="domain" value={domain} />
            <div className="row"><input type="text" name="reason" required minLength={3} maxLength={300} placeholder="Why?" aria-label="Reason" /><button className="btn danger small" type="submit">Add to the list</button></div>
          </Form>
        ) : null}
        {domain && ["no_contact", "review", "held", "needs_more", "queued", "failed"].includes(lane) ? (
          <Form action={addContact} title="Add a contact by hand" help="For when Hunter has nobody or the wrong person. A hand-picked contact always outranks Hunter. Then use “Try again”.">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="domain" value={domain} />
            <div className="fields">
              <label>First name <input type="text" name="first_name" required maxLength={40} autoComplete="off" /></label>
              <label>Last name <input type="text" name="last_name" maxLength={60} autoComplete="off" /></label>
              <label>Job title <input type="text" name="position" required maxLength={80} placeholder="Head of Security" /></label>
              <label>Email <input type="email" name="email" required maxLength={254} placeholder={`name@${domain}`} /></label>
            </div>
            <div><button className="btn small" type="submit">Save contact</button></div>
          </Form>
        ) : null}
      </div>
    </>
  );
  // A finished prospect (sent, ruled out, skipped) needs little: tuck the few things still possible away.
  if (finished) {
    return (
      <details className="card" aria-label="What you can do">
        <summary>More actions (do not contact)</summary>
        {body}
      </details>
    );
  }
  return (
    <section className="card stack" aria-label="What you can do">
      <h2>What you can do</h2>
      {body}
    </section>
  );
}

import Link from "next/link";
import { addClaim, addManualContact, addSuppression, liftSuppression, saveSettings, verifyClaim } from "./actions";
import { ActionForm } from "@/components/action-form";
import { Icon } from "@/components/icons";
import { Banner, Empty, PageHead, Pill, Ring, SectionTitle } from "@/components/ui";
import { ago, dateTime } from "@/lib/app/format";
import { buildReadiness } from "@/lib/app/readiness";
import { settingsPage, workerStatus } from "@/lib/app/queries";
import { getSession, hunterBalance } from "@/lib/app/runtime";
import { factsFileProblems, type SprintoFactsFile } from "@/lib/pitch/sprinto-facts";
import { withSettings } from "@/lib/worker/pipeline";

export const metadata = { title: "Settings" };

const SECTIONS = [
  ["ready", "Readiness"],
  ["approval", "Approval"],
  ["limits", "Sending and limits"],
  ["icp", "ICP"],
  ["claims", "Claims"],
  ["suppress", "Do not contact"],
  ["contacts", "Hand-picked contacts"],
] as const;

export default async function Settings() {
  const s = (await getSession())!;
  const admin = s.user.role === "admin";
  const operator = admin || s.user.role === "operator";
  const [d, tick, hunter] = await Promise.all([settingsPage(s.db), workerStatus(s.db), hunterBalance()]);
  const set = d.settings;
  const file = d.file?.content as SprintoFactsFile | undefined;
  // The worker takes the sender and the postal address from these settings, so readiness is judged the same way.
  const fileProblems = file && set ? factsFileProblems(withSettings(file, set)) : ["There is no facts file."];
  const signed = new Set(d.signoffs.map((x) => String(x.icp_version_id)));
  const latestSigned = d.icp.find((v) => signed.has(v.id));
  const env = s.env;
  const readiness = buildReadiness({
    mode: env.mode,
    testTo: set?.test_to ?? null,
    postalAddress: set?.postal_address ?? null,
    icpSignedVersion: latestSigned?.version ?? null,
    factsProblems: fileProblems,
    geminiSet: !!env.gemini,
    gmailSet: !!env.gmail,
    hunter: hunter && "error" in hunter && hunter.error ? { error: hunter.error } : hunter && typeof hunter.remaining === "number" ? { remaining: hunter.remaining } : null,
    lastTick: tick.lastTick,
    now: Date.now(),
    waiting: 0,
    reserve: set?.hunter_reserve ?? 3,
  });
  const approval = set?.require_approval !== false;
  const unverified = (file?.items ?? []).filter((i) => !i.verifiedBy).length;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHead eyebrow="Control" title="Settings" sub="Every change is a new version with a reason and your name. Nothing is edited in place, so the history can always be shown.">
        <span className="chip"><Icon name="shield" />{env.mode === "demo" ? "Demo mode" : "Test mode"}</span>
      </PageHead>

      <nav className="subnav" aria-label="Sections">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </nav>

      <section id="ready" className="card hero stack" aria-labelledby="ready-h">
        <div className="row" style={{ gap: 22, alignItems: "center", flexWrap: "nowrap" }}>
          <Ring value={readiness.done} max={readiness.total} label={`of ${readiness.total}`} tone={readiness.ready ? "good" : "brand"} size={84} />
          <div style={{ minWidth: 0 }}>
            <h2 id="ready-h" style={{ fontSize: "1.2rem" }}>{readiness.ready ? "Ready to send" : "Not ready to send yet"}</h2>
            <p className="muted" style={{ margin: "4px 0 0", maxWidth: "60ch" }}>
              {readiness.ready ? "Everything required is in place. This page shows what was checked, not what is hoped." : "Sending needs every required item below. Until then the system will not start a run or send an email."}
            </p>
          </div>
        </div>
        <ul className="checklist">
          {readiness.items.map((x) => (
            <li key={x.id} className={x.ok ? "done" : x.optional ? "" : "todo"}>
              <span className="tick" aria-hidden><Icon name={x.ok ? "check" : x.optional ? "info" : "alert"} /></span>
              <span><b>{x.label}{x.optional ? <span className="muted"> (optional)</span> : null}</b><small>{x.detail}</small></span>
              {x.ok ? <Pill tone="good">Done</Pill> : <Link className="btn small" href={x.href}>{x.action}<Icon name="arrow" /></Link>}
            </li>
          ))}
          {admin && env.mode === "supabase" ? (
            <li className={env.problems.length === 0 ? "done" : "todo"}>
              <span className="tick" aria-hidden><Icon name={env.problems.length === 0 ? "check" : "alert"} /></span>
              <span><b>Server environment</b><small>{env.problems.length ? env.problems.join(" ") : "Every required variable is set."}</small></span>
              {env.problems.length === 0 ? <Pill tone="good">Done</Pill> : <Pill tone="warn">Fix on the host</Pill>}
            </li>
          ) : null}
        </ul>
      </section>

      <section id="approval" className="stack tight" aria-label="Approval">
        <SectionTitle icon="shield" title="Human approval" sub="Whether a person must approve each email before it goes out." />
        <div className="card stack">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 18 }}>
            <div style={{ minWidth: 0 }}>
              <strong>{approval ? "A person approves every email" : "Emails send without approval"}</strong>
              <p className="small muted" style={{ margin: "4px 0 0", maxWidth: "62ch" }}>
                {approval
                  ? "The system researches and drafts. The Growth Lead decides what goes out, as written or with edits. Every decision is recorded with how much was changed, which is what tells you whether it is saving time."
                  : "Finished drafts are sent on the next worker run. Use this only once the Review desk has shown that drafts rarely need changing."}
              </p>
            </div>
            <Pill tone={approval ? "good" : "warn"}>{approval ? "On" : "Off"}</Pill>
          </div>
          {!approval ? <Banner tone="warn" title="Approval is off">The 12 draft checks still run, and test mode still sends only to the test address. Nobody reads the email first.</Banner> : null}
          <p className="small muted" style={{ margin: 0 }}>{admin ? "Change it with the switch under Sending and limits, below." : "Only an admin can change this."}</p>
        </div>
      </section>

      <section id="limits" className="stack tight" aria-label="Sending and limits">
        <SectionTitle icon="sliders" title="Sending and limits" sub={set ? `Version ${set.version}, saved ${dateTime(set.created_at)}.` : undefined} />
        <div className="card stack">
          {admin && set ? (
            <ActionForm action={saveSettings} submit="Save as a new version">
              <fieldset className="group">
                <legend>Who it comes from</legend>
                <div className="fields">
                  <label>Test address <span className="hint">the only address test mode can mail</span><input type="email" name="test_to" defaultValue={set.test_to ?? ""} maxLength={254} /></label>
                  <label>Sender first name<input type="text" name="sender_name" defaultValue={set.sender_name} maxLength={60} /></label>
                  <label>Sender title<input type="text" name="sender_title" defaultValue={set.sender_title} maxLength={80} /></label>
                  <label>Postal address <span className="hint">in the opt-out line</span><input type="text" name="postal_address" defaultValue={set.postal_address} maxLength={200} /></label>
                </div>
              </fieldset>
              <fieldset className="group">
                <legend>Approval</legend>
                <label className="switch">
                  <input type="checkbox" name="require_approval" defaultChecked={approval} />
                  <span className="track" aria-hidden />
                  <span><b>A person approves each email before it is sent</b><small>Recommended. Turn it off only once the Review desk shows drafts rarely need changing.</small></span>
                </label>
              </fieldset>
              <fieldset className="group">
                <legend>Volume and cost</legend>
                <div className="fields">
                  <label>Sends per day<input type="number" name="daily_send_cap" defaultValue={set.daily_send_cap} min={0} max={200} /></label>
                  <label>Most domains in a run<input type="number" name="max_run_size" defaultValue={set.max_run_size} min={1} max={500} /></label>
                  <label>Steps at once<input type="number" name="max_parallel" defaultValue={set.max_parallel} min={1} max={10} /></label>
                  <label>Hunter credits kept back<input type="number" name="hunter_reserve" defaultValue={set.hunter_reserve} min={0} /></label>
                  <label>Tokens per domain<input type="number" name="tokens_per_domain" defaultValue={set.tokens_per_domain} min={1} /></label>
                  <label>Tokens per run<input type="number" name="tokens_per_run" defaultValue={set.tokens_per_run} min={1} /></label>
                  <label>Days before a domain can be mailed again<input type="number" name="mail_cooldown_days" defaultValue={set.mail_cooldown_days} min={0} /></label>
                </div>
              </fieldset>
              <fieldset className="group">
                <legend>How time saved is worked out</legend>
                <div className="fields">
                  <label>Manual minutes per company <span className="hint">the baseline for Impact</span><input type="number" step="any" name="minutes_saved_per_email" defaultValue={set.minutes_saved_per_email} min={0} /></label>
                  <label>Minutes to review one email <span className="hint">taken off the saving</span><input type="number" step="any" name="review_minutes_per_email" defaultValue={set.review_minutes_per_email} min={0} max={60} /></label>
                  <label>Minutes per decision <span className="hint">promote, skip, resolve, add a contact</span><input type="number" step="any" name="review_minutes_per_decision" defaultValue={set.review_minutes_per_decision} min={0} max={60} /></label>
                </div>
              </fieldset>
              <label>Why are you changing it?<input type="text" name="reason" required minLength={3} maxLength={300} placeholder="Set up test mode" /></label>
            </ActionForm>
          ) : set ? (
            <dl className="kv">
              <dt>Test address</dt><dd>{set.test_to ?? "not set"}</dd>
              <dt>Sender</dt><dd>{set.sender_name} {set.sender_title}</dd>
              <dt>Approval</dt><dd>{approval ? "A person approves each email" : "Off"}</dd>
              <dt>Sends per day</dt><dd>{set.daily_send_cap}</dd>
              <dt>Run size limit</dt><dd>{set.max_run_size}</dd>
              <dt>Cooldown</dt><dd>{set.mail_cooldown_days} days per domain</dd>
            </dl>
          ) : null}
        </div>
      </section>

      <section id="icp" className="stack tight" aria-label="The ICP">
        <SectionTitle icon="target" title="The ICP: who counts as a fit" sub={latestSigned ? `Version ${latestSigned.version} is in use${d.icp[0] && d.icp[0].id !== latestSigned.id ? `, and version ${d.icp[0].version} is saved but not signed off` : ""}.` : "No version has been signed off, so no run can start."} />
        <div className="card row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 18 }}>
          <p className="small muted" style={{ margin: 0, maxWidth: "62ch" }}>The rubric in words, every past version with what changed, signing off, and replay: try a different definition and see who would move, without re-reading a single site.</p>
          <Link className="btn" href="/icp">Open the ICP<Icon name="arrow" /></Link>
        </div>
      </section>

      <section id="claims" className="stack tight" aria-label="What an email may say about Sprinto">
        <SectionTitle icon="book" title="What an email may say about Sprinto" sub={`Only claims verified by a person against their source can appear in an email, and a figure in a verified claim may be quoted.${unverified ? ` ${unverified} still to verify.` : ""}`} />
        {fileProblems.length ? <Banner tone="warn" title="Not ready for drafting">{fileProblems.join(" ")}</Banner> : null}
        <div className="tablewrap"><table>
          <thead><tr><th>Claim</th><th>Source</th><th>Verified</th></tr></thead>
          <tbody>
            {(file?.items ?? []).map((i) => (
              <tr key={i.id}>
                <td><span className="tag">{i.id}</span> {i.claim}</td>
                <td className="small">{i.sourceUrl}</td>
                <td>{i.verifiedBy ? <Pill tone="good">{i.verifiedBy}, {i.verifiedAt}</Pill> : admin ? (
                  <ActionForm action={verifyClaim} submit="Verify" inline>
                    <input type="hidden" name="claim_id" value={i.id} />
                    <label className="tickline"><input type="checkbox" name="checked" /> I checked it against its source</label>
                  </ActionForm>
                ) : <Pill tone="warn">not verified</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {admin ? (
          <details className="card">
            <summary>Add a claim</summary>
            <ActionForm action={addClaim} submit="Add (unverified)">
              <div className="fields">
                <label>The claim, as one sentence<input type="text" name="claim" required maxLength={300} placeholder="Sprinto supports SOC 2, ISO 27001, GDPR and HIPAA." /></label>
                <label>Where it can be checked<input type="text" name="source" required maxLength={300} placeholder="https://sprinto.com/…" /></label>
                <label>Kind<select name="kind"><option value="proof">Proof point</option><option value="frameworks">Frameworks</option><option value="audience">Who it is for</option></select></label>
              </div>
            </ActionForm>
          </details>
        ) : null}
      </section>

      <section id="suppress" className="stack tight" aria-label="Do not contact">
        <SectionTitle icon="lock" title="Do not contact" sub="A suppressed domain or address is never mailed. Lifting one adds a new row; the history stays." />
        {d.suppressions.length === 0 ? (
          <div className="card"><Empty title="Nobody is suppressed" icon="shield"><p className="small" style={{ margin: 0 }}>Add a domain or address below if someone asks to stop.</p></Empty></div>
        ) : (
          <div className="tablewrap"><table>
            <thead><tr><th>Who</th><th>Why</th><th>Since</th><th /></tr></thead>
            <tbody>
              {d.suppressions.map((x) => (
                <tr key={`${x.kind}:${x.value}`}>
                  <td><strong>{x.value}</strong> <span className="small muted">{x.kind}</span></td>
                  <td className="small">{x.reason}</td>
                  <td className="small muted nowrap">{dateTime(x.created_at)}</td>
                  <td>{operator ? (
                    <ActionForm action={liftSuppression} submit="Lift" tone="plain" inline>
                      <input type="hidden" name="kind" value={x.kind} /><input type="hidden" name="value" value={x.value} />
                      <input type="text" name="reason" required minLength={3} placeholder="Why lift?" aria-label="Reason" />
                    </ActionForm>
                  ) : null}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {operator ? (
          <div className="card">
            <ActionForm action={addSuppression} submit="Add to the list" tone="danger">
              <div className="fields">
                <label>Domain or email address<input type="text" name="value" required maxLength={254} placeholder="acme.com" /></label>
                <label>Which is it?<select name="kind"><option value="domain">A domain</option><option value="address">An email address</option></select></label>
                <label>Why<input type="text" name="reason" required minLength={3} maxLength={300} placeholder="Asked us to stop" /></label>
              </div>
            </ActionForm>
          </div>
        ) : null}
      </section>

      {operator ? (
        <section id="contacts" className="stack tight" aria-label="Hand-picked contacts">
          <SectionTitle icon="people" title="Hand-picked contacts" sub="For when you looked someone up yourself. A hand-picked contact outranks Hunter and saves a credit. Names and addresses are removed after 90 days." />
          {d.manual.length ? (
            <div className="tablewrap"><table><thead><tr><th>Domain</th><th>Person</th><th>Added</th></tr></thead><tbody>
              {d.manual.map((m) => <tr key={String(m.id)}><td>{String(m.domain)}</td><td>{m.email ? <>{String(m.first_name ?? "")} {String(m.last_name ?? "")}, {String(m.position ?? "")} <span className="small muted">{String(m.email)}</span></> : <span className="muted">removed after 90 days</span>}</td><td className="small muted nowrap">{dateTime(m.created_at as string)}</td></tr>)}
            </tbody></table></div>
          ) : null}
          <div className="card">
            <ActionForm action={addManualContact} submit="Save contact" tone="plain">
              <div className="fields">
                <label>Company domain<input type="text" name="domain" required placeholder="acme.com" /></label>
                <label>First name<input type="text" name="first_name" required maxLength={40} /></label>
                <label>Last name<input type="text" name="last_name" maxLength={60} /></label>
                <label>Job title<input type="text" name="position" required maxLength={80} placeholder="Head of Security" /></label>
                <label>Email<input type="email" name="email" required maxLength={254} /></label>
              </div>
            </ActionForm>
          </div>
        </section>
      ) : null}
      <p className="small muted" style={{ margin: 0 }}>Worker {tick.lastTick ? `last ran ${ago(tick.lastTick)}` : "has not run yet"}.</p>
    </div>
  );
}

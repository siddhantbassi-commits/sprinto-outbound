import Link from "next/link";
import { addClaim, addManualContact, addSuppression, liftSuppression, saveSettings, verifyClaim } from "./actions";
import { ActionForm } from "@/components/action-form";
import { Banner, PageHead, Pill } from "@/components/ui";
import { ago, dateTime } from "@/lib/app/format";
import { settingsPage, workerStatus } from "@/lib/app/queries";
import { getSession, hunterBalance } from "@/lib/app/runtime";
import { factsFileProblems, type SprintoFactsFile } from "@/lib/pitch/sprinto-facts";
import { withSettings } from "@/lib/worker/pipeline";

export const metadata = { title: "Settings" };

function Status({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className={ok ? "ok" : "no"}>
      <span className="tick" aria-hidden>{ok ? "✓" : "✕"}</span>
      <span><strong>{label}</strong> {detail ? <span className="muted">{detail}</span> : null}</span>
    </li>
  );
}

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

  return (
    <div className="stack">
      <PageHead title="Settings" sub="Everything here is versioned: a change is a new row with a reason and your name, never an edit." />

      <section className="card stack">
        <div><h2>Is it ready to send?</h2><p className="sub">Sending needs all of these. The page shows what it checked, not what it hopes.</p></div>
        <ul className="checks">
          <Status ok={!!set?.test_to} label="Test address" detail={set?.test_to ? `emails go to ${set.test_to} only` : "not set: every send is refused"} />
          <Status ok={!!latestSigned} label="ICP signed off" detail={latestSigned ? `version ${latestSigned.version}` : "no version has been signed off, so no run can start"} />
          <Status ok={fileProblems.length === 0} label="Sprinto facts file" detail={fileProblems.length ? fileProblems.join(" ") : "verified by a person, sender and address set"} />
          <Status ok={!!tick.lastTick && Date.now() - new Date(tick.lastTick).getTime() < 3_600_000} label="Worker heartbeat" detail={tick.lastTick ? `last ran ${ago(tick.lastTick)}` : "has never run"} />
          <Status ok={env.mode === "demo" || !!env.gemini} label="Gemini" detail={env.mode === "demo" ? "pretend model (demo)" : env.gemini ? "key set" : "GEMINI_API_KEY is not set"} />
          <Status ok={env.mode === "demo" || !!env.gmail} label="Gmail" detail={env.mode === "demo" ? "pretend inbox (demo)" : env.gmail ? "OAuth configured" : "not configured"} />
          <Status ok={!!hunter && !hunter.error} label="Hunter" detail={!hunter ? "not configured: only hand-picked contacts will work" : hunter.error ? hunter.error : `${hunter.remaining} credits left (${set?.hunter_reserve ?? 3} kept in reserve)`} />
          {admin && env.mode === "supabase" ? <Status ok={env.problems.length === 0} label="Server environment" detail={env.problems.length ? env.problems.join(" ") : "complete"} /> : null}
        </ul>
      </section>

      <section className="card stack">
        <div><h2>Sending and limits</h2><p className="sub">{set ? <>Version {set.version}, saved {dateTime(set.created_at)}.</> : null}</p></div>
        {admin && set ? (
          <ActionForm action={saveSettings} submit="Save as a new version">
            <div className="fields">
              <label>Test address <span className="hint">the only address test mode can mail</span><input type="email" name="test_to" defaultValue={set.test_to ?? ""} maxLength={254} /></label>
              <label>Sender first name<input type="text" name="sender_name" defaultValue={set.sender_name} maxLength={60} /></label>
              <label>Sender title<input type="text" name="sender_title" defaultValue={set.sender_title} maxLength={80} /></label>
              <label>Postal address <span className="hint">in the opt-out line</span><input type="text" name="postal_address" defaultValue={set.postal_address} maxLength={200} /></label>
            </div>
            <div className="fields">
              <label>Sends per day<input type="number" name="daily_send_cap" defaultValue={set.daily_send_cap} min={0} max={200} /></label>
              <label>Most domains in a run<input type="number" name="max_run_size" defaultValue={set.max_run_size} min={1} max={500} /></label>
              <label>Steps at once<input type="number" name="max_parallel" defaultValue={set.max_parallel} min={1} max={10} /></label>
              <label>Hunter credits kept back<input type="number" name="hunter_reserve" defaultValue={set.hunter_reserve} min={0} /></label>
              <label>Tokens per domain<input type="number" name="tokens_per_domain" defaultValue={set.tokens_per_domain} min={1} /></label>
              <label>Tokens per run<input type="number" name="tokens_per_run" defaultValue={set.tokens_per_run} min={1} /></label>
              <label>Days before the same domain can be mailed again<input type="number" name="mail_cooldown_days" defaultValue={set.mail_cooldown_days} min={0} /></label>
              <label>Manual minutes per company <span className="hint">the baseline for the Impact view</span><input type="number" step="any" name="minutes_saved_per_email" defaultValue={set.minutes_saved_per_email} min={0} /></label>
              <label>Minutes to review one email <span className="hint">person time, taken off the saving</span><input type="number" step="any" name="review_minutes_per_email" defaultValue={set.review_minutes_per_email} min={0} max={60} /></label>
              <label>Minutes per decision you make <span className="hint">promote, skip, resolve, add a contact</span><input type="number" step="any" name="review_minutes_per_decision" defaultValue={set.review_minutes_per_decision} min={0} max={60} /></label>
            </div>
            <label>Why are you changing it?<input type="text" name="reason" required minLength={3} maxLength={300} placeholder="Set up test mode" /></label>
          </ActionForm>
        ) : set ? (
          <dl className="kv">
            <dt>Test address</dt><dd>{set.test_to ?? "not set"}</dd>
            <dt>Sender</dt><dd>{set.sender_name} {set.sender_title}</dd>
            <dt>Sends per day</dt><dd>{set.daily_send_cap}</dd>
            <dt>Run size limit</dt><dd>{set.max_run_size}</dd>
            <dt>Cooldown</dt><dd>{set.mail_cooldown_days} days per domain</dd>
          </dl>
        ) : null}
      </section>

      <section className="card stack">
        <div><h2>The ICP: who counts as a fit</h2><p className="sub">{latestSigned ? <>Version {latestSigned.version} is in use{d.icp[0] && d.icp[0].id !== latestSigned.id ? `, and version ${d.icp[0].version} is saved but not signed off` : ""}.</> : "No version has been signed off, so no run can start."}</p></div>
        <div><Link className="btn" href="/icp">Open the ICP and rulebook</Link></div>
        <p className="small muted">The rubric in words, every past version with what changed, signing off, and replay: try a different definition and see who would move, without re-reading a single site.</p>
      </section>

      <section className="card stack">
        <div><h2>What an email may say about Sprinto</h2><p className="sub">Only claims on this list, verified by a person against their source, can appear in an email. Gemini is told it is the only source.</p></div>
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
                    <label style={{ display: "flex", flexDirection: "row", gap: 6, alignItems: "center", fontWeight: 400 }}><input type="checkbox" name="checked" /> I checked it against its source</label>
                  </ActionForm>
                ) : <Pill tone="warn">not verified</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {admin ? (
          <details>
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

      <section className="card stack">
        <div><h2>Do not contact</h2><p className="sub">A suppressed domain or address is never mailed. Lifting one adds a new row; the history stays.</p></div>
        {d.suppressions.length === 0 ? <p className="muted">Nobody is suppressed.</p> : (
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
          <ActionForm action={addSuppression} submit="Add to the list" tone="danger">
            <div className="fields">
              <label>Domain or email address<input type="text" name="value" required maxLength={254} placeholder="acme.com" /></label>
              <label>Which is it?<select name="kind"><option value="domain">A domain</option><option value="address">An email address</option></select></label>
              <label>Why<input type="text" name="reason" required minLength={3} maxLength={300} placeholder="Asked us to stop" /></label>
            </div>
          </ActionForm>
        ) : null}
      </section>

      {operator ? (
        <section className="card stack">
          <div><h2>Hand-picked contacts</h2><p className="sub">For when you looked someone up yourself (Apollo, LinkedIn, a conversation). A hand-picked contact always outranks Hunter, and saves a Hunter credit. Names and addresses are removed after 90 days.</p></div>
          {d.manual.length ? (
            <div className="tablewrap"><table><thead><tr><th>Domain</th><th>Person</th><th>Added</th></tr></thead><tbody>
              {d.manual.map((m) => <tr key={String(m.id)}><td>{String(m.domain)}</td><td>{m.email ? <>{String(m.first_name ?? "")} {String(m.last_name ?? "")}, {String(m.position ?? "")} <span className="small muted">{String(m.email)}</span></> : <span className="muted">removed after 90 days</span>}</td><td className="small muted nowrap">{dateTime(m.created_at as string)}</td></tr>)}
            </tbody></table></div>
          ) : null}
          <ActionForm action={addManualContact} submit="Save contact" tone="plain">
            <div className="fields">
              <label>Company domain<input type="text" name="domain" required placeholder="acme.com" /></label>
              <label>First name<input type="text" name="first_name" required maxLength={40} /></label>
              <label>Last name<input type="text" name="last_name" maxLength={60} /></label>
              <label>Job title<input type="text" name="position" required maxLength={80} placeholder="Head of Security" /></label>
              <label>Email<input type="email" name="email" required maxLength={254} /></label>
            </div>
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}

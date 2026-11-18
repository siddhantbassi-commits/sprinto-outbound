import Link from "next/link";
import { Banner, PageHead } from "@/components/ui";
import { ReportActions } from "@/components/report-actions";
import { LANES } from "@/lib/app/format";
import { computeImpact, hours, rangeFor, renderReport, type Rate } from "@/lib/app/impact";
import { currentSettings, impactData } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";

export const metadata = { title: "Impact" };

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const pct = (r: Rate) => (r.value === null ? "-" : `${Math.round(r.value * 100)}%`);
const NEEDS_YOU = new Set(["review", "held", "unknown", "failed", "no_contact", "needs_more"]);

function Stat({ title, rate, help }: { title: string; rate: Rate; help: string }) {
  return (
    <div className="card stat">
      <b>{pct(rate)}</b>
      <span>{title}</span>
      <span className="small">{rate.value === null ? "Not enough data yet" : `${rate.numerator} of ${rate.denominator}. ${help}`}</span>
    </div>
  );
}

export default async function Impact({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const q = await searchParams;
  const s = (await getSession())!;
  const now = Date.now();
  const range = rangeFor(q.range, now);
  const [data, settings] = await Promise.all([impactData(s.db), currentSettings(s.db)]);
  const x = computeImpact({
    ...data,
    range,
    assumptions: {
      manualMinutes: Number(settings?.minutes_saved_per_email ?? 20),
      reviewMinutesPerEmail: Number(settings?.review_minutes_per_email ?? 1.5),
      reviewMinutesPerDecision: Number(settings?.review_minutes_per_decision ?? 2),
    },
  });
  const report = renderReport(x, { from: range.from === null ? "the beginning" : day(range.from), to: day(range.to) });
  const widest = Math.max(1, ...x.funnel.map((f) => f.count));
  const admin = s.user.role === "admin";
  const saved = x.time.savedMinutes;

  return (
    <div className="stack">
      <PageHead title="Impact" sub="What the system did, what it cost, and how much person time it saved, with the working shown.">
        <nav className="rangetabs" aria-label="Period">
          {(["7", "30", "all"] as const).map((k) => (
            <Link key={k} href={`/impact?range=${k}`} aria-current={range.key === k ? "true" : undefined}>{k === "all" ? "All time" : `${k} days`}</Link>
          ))}
        </nav>
        <ReportActions text={report} />
      </PageHead>

      {x.domains === 0 ? (
        <Banner tone="info" title={`Nothing in this period (${range.label.toLowerCase()})`}>No domains were added. Try a longer period, or start a run.</Banner>
      ) : null}

      <div className="grid">
        <div className="card stat"><b>{x.researched}</b><span>Companies researched</span><span className="small">{x.domains} domains added</span></div>
        <div className="card stat"><b>{x.qualified}</b><span>Qualified</span><span className="small">{pct(x.rates.qualification)} of those researched</span></div>
        <div className="card stat"><b>{x.sent}</b><span>Test emails sent</span><span className="small">{x.drafted} drafted</span></div>
        <div className="card stat"><b>{x.researched === 0 ? "-" : hours(saved)}</b><span>Person time saved (estimate)</span><span className="small">The working is just below</span></div>
      </div>

      <section className="card stack">
        <div>
          <h2>Time saved, and how it is worked out</h2>
          <p className="sub">An estimate, not a stopwatch reading. The manual time and the review times are assumptions you set in Settings, so change them if they are wrong for your team.</p>
        </div>
        <div className="ledger" role="table" aria-label="Time saved working">
          {x.time.lines.map((l) => (
            <div className="ledger-row" role="row" key={l.label}>
              <span className="sign" style={{ color: l.minutes >= 0 ? "var(--good)" : "var(--bad)" }}>{l.minutes >= 0 ? "+" : "−"} {hours(Math.abs(l.minutes))}</span>
              <span><strong>{l.label}</strong><br /><span className="small muted">{l.note}</span></span>
              <b />
            </div>
          ))}
          <div className="ledger-row total" role="row">
            <span style={{ color: saved >= 0 ? "var(--good)" : "var(--bad)" }}>= {hours(saved)}</span>
            <span>saved in {range.label.toLowerCase()}</span>
            <b />
          </div>
        </div>
        <p className="small muted">
          Machine time, with no person waiting, was {hours(x.time.machineMinutes)}. It is shown for information and is not counted as a saving or a cost.
          {admin ? <> Change the assumptions in <Link href="/settings">Settings</Link>.</> : null}
        </p>
      </section>

      <section className="card stack">
        <div><h2>From domain to email</h2><p className="sub">How many reached each step, taken from the trace.</p></div>
        <div className="funnel">
          {x.funnel.map((f, i) => {
            const prev = i === 0 ? null : x.funnel[i - 1]!.count;
            return (
              <div key={f.key} className={`funnel-row ${i === x.funnel.length - 1 ? "last" : ""}`}>
                <span>{f.label}</span>
                <span className="funnel-bar" aria-hidden><i style={{ width: `${(f.count / widest) * 100}%` }} /></span>
                <b>{f.count} {prev !== null && prev > 0 ? <small>{Math.round((f.count / prev) * 100)}% of the step before</small> : null}</b>
              </div>
            );
          })}
        </div>
      </section>

      {x.dropoffs.length ? (
        <section className="card stack">
          <div><h2>Where the rest went</h2><p className="sub">Each stopped for a stated reason. The most common reasons are shown.</p></div>
          <div className="tablewrap"><table>
            <thead><tr><th>Outcome</th><th className="num">Companies</th><th>Most common reasons</th></tr></thead>
            <tbody>
              {x.dropoffs.map((d) => (
                <tr key={d.lane}>
                  <td><strong>{LANES[d.lane]?.label ?? d.lane}</strong>{NEEDS_YOU.has(d.lane) ? <> <Link className="small" href="/review">review</Link></> : null}</td>
                  <td className="num">{d.count}</td>
                  <td className="small">{d.reasons.map((r) => `${r.text} (${r.count})`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      ) : null}

      <section className="stack">
        <h2>How well it is working</h2>
        <div className="grid">
          <Stat title="Drafts that passed all 12 checks first time" rate={x.rates.firstPassLint} help="Higher means fewer repairs." />
          <Stat title="Qualified companies where a person was found" rate={x.rates.contactHit} help="Limited by Hunter's coverage and credits." />
          <Stat title="Quotes that were not on the page" rate={x.rates.groundingFailure} help="Lower is better. These facts were set to unknown." />
          <Stat title="Sites that could not be read" rate={x.rates.scrapeFailure} help="Blocked, missing or JavaScript-only." />
          <Stat title="Pages with too little text" rate={x.rates.thinPage} help="Usually a JavaScript-only site." />
          <Stat title="Qualified companies that got an email" rate={x.rates.sendThrough} help="The rest are waiting on a person or were stopped." />
        </div>
      </section>

      <section className="stack">
        <h2>After the outreach</h2>
        {x.results.recorded ? (
          <div className="grid">
            <div className="card stat"><b>{x.results.reached}</b><span>Companies reached</span><span className="small">With an outcome recorded on the Leads page.</span></div>
            <Stat title="Replied" rate={x.results.replyRate} help="Of the companies reached." />
            <Stat title="Meetings booked" rate={x.results.meetingRate} help="Of the companies reached." />
            <div className="card stat"><b>{x.results.notInterested}</b><span>Not interested</span><span className="small">{x.results.bounced} bounced, {x.results.wrongPerson} wrong person.</span></div>
          </div>
        ) : (
          <div className="card"><p className="small" style={{ margin: 0 }}>Nothing recorded yet. After you reach a lead, record what happened on the <a href="/leads">Leads</a> page. This is the number that shows whether the ICP and the emails are working.</p></div>
        )}
      </section>

      <section className="card stack">
        <div><h2>What it cost</h2><p className="sub">From the usage ledger. Prices are not applied: we have not looked up Gemini&rsquo;s current rates, so these are quantities, not money.</p></div>
        <dl className="kv">
          <dt>Model tokens</dt><dd>{x.usage.tokens.toLocaleString("en-GB")}{x.usage.tokensPerCompany === null ? "" : <span className="muted"> · {x.usage.tokensPerCompany.toLocaleString("en-GB")} per company researched</span>}</dd>
          <dt>Hunter credits</dt><dd>{x.usage.hunterCredits}{x.usage.creditsPerContact === null ? "" : <span className="muted"> · {x.usage.creditsPerContact} per person found</span>}</dd>
          <dt>Emails sent</dt><dd>{x.usage.sends}</dd>
          <dt>Replies and bounces</dt><dd>{x.replies.recorded ? `${x.replies.replies} replies, ${x.replies.bounces} bounces recorded` : <span className="muted">Not measured. In test mode every email goes to your own inbox, so nobody can reply.</span>}</dd>
        </dl>
      </section>

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div><h2>The weekly report</h2><p className="sub" style={{ margin: 0 }}>The same numbers as plain text, for an email or a chat.</p></div>
          <ReportActions text={report} />
        </div>
        <pre className="report">{report}</pre>
      </section>

      <section className="card stack">
        <h2>Read this before you quote a number</h2>
        <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>{x.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </section>
    </div>
  );
}

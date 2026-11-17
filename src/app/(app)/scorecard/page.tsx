import Link from "next/link";
import { Icon } from "@/components/icons";
import { Banner, Empty, PageHead, Pill, SectionTitle } from "@/components/ui";
import { dateTime } from "@/lib/app/format";
import { computeImpact, rangeFor } from "@/lib/app/impact";
import { companyIndex, currentSettings, impactData, reviewHistory } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";
import { AIM_REWRITE, AIM_PERSON_MINUTES, computeScorecard, CONTACT_MARGIN, inRange, isRewrite, KILL_CONTACT, KILL_REWRITE, MIN_DECIDED, sampleScenario, type Criterion, type Status } from "@/lib/app/scorecard";

export const metadata = { title: "Scorecard" };

const TONE: Record<Status, "good" | "warn" | "bad" | "muted"> = { ok: "good", watch: "warn", kill: "bad", unknown: "muted" };
const LABEL: Record<Status, string> = { ok: "On aim", watch: "Watch", kill: "Kill line crossed", unknown: "Not enough data" };

/** A bar with the zones drawn on it and a marker at the value. Zones are percentages of the bar. */
function Gauge({ c }: { c: Criterion }) {
  if (c.id === "time" || c.value === null || c.status === "unknown") return null;
  const inverted = c.id === "contacts";
  const stops = inverted
    ? `var(--bad) 0 ${KILL_CONTACT * 100}%, var(--warn) ${KILL_CONTACT * 100}% ${(KILL_CONTACT + CONTACT_MARGIN) * 100}%, var(--good) ${(KILL_CONTACT + CONTACT_MARGIN) * 100}% 100%`
    : `var(--good) 0 ${AIM_REWRITE * 100}%, var(--warn) ${AIM_REWRITE * 100}% ${KILL_REWRITE * 100}%, var(--bad) ${KILL_REWRITE * 100}% 100%`;
  return (
    <div className="gauge" style={{ background: `linear-gradient(90deg, ${stops})` }} role="img" aria-label={`${c.label}: ${c.display}`}>
      <i className="mark" style={{ ["--at" as string]: Math.min(100, Math.max(0, c.value * 100)) }} />
    </div>
  );
}

function CriterionCard({ c }: { c: Criterion }) {
  return (
    <article className={`card stack crit ${c.status}`}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", alignItems: "start" }}>
        <span className="small muted" style={{ fontWeight: 620, letterSpacing: "0.06em", textTransform: "uppercase" }}>{c.label}</span>
        <Pill tone={TONE[c.status]}>{LABEL[c.status]}</Pill>
      </div>
      <div className="crit-value">{c.status === "unknown" ? <span className="early">Too early to say</span> : c.display}</div>
      <Gauge c={c} />
      {c.status === "unknown" ? (
        <div className="stack tight">
          <div className="bar-track t-brand" aria-hidden><i style={{ width: `${Math.min(100, (c.sample / MIN_DECIDED) * 100)}%` }} /></div>
          <span className="small muted">{c.sample} of {MIN_DECIDED} {c.id === "time" ? "companies" : "decisions"} so far. A rate on fewer says nothing.</span>
        </div>
      ) : null}
      <p className="small" style={{ margin: 0 }}>{c.working}</p>
      <ul className="rules">
        <li><Icon name="flag" />{c.killRule}</li>
        {c.aim ? <li><Icon name="target" />{c.aim}</li> : null}
      </ul>
    </article>
  );
}

export default async function Scorecard({ searchParams }: { searchParams: Promise<{ range?: string; preview?: string }> }) {
  const q = await searchParams;
  const s = (await getSession())!;
  const now = Date.now();
  const range = rangeFor(q.range, now);
  const demo = s.mode === "demo";
  const preview = demo && (q.preview === "healthy" || q.preview === "watch" || q.preview === "kill") ? q.preview : null;

  const [data, settings, history, index] = await Promise.all([impactData(s.db), currentSettings(s.db), reviewHistory(s.db), companyIndex(s.db, 1000)]);
  const manual = Number(settings?.minutes_saved_per_email ?? 20);
  const impact = computeImpact({ ...data, range, assumptions: { manualMinutes: manual, reviewMinutesPerEmail: Number(settings?.review_minutes_per_email ?? 1.5), reviewMinutesPerDecision: Number(settings?.review_minutes_per_decision ?? 2) } });
  const real = { reviews: inRange(history, range), time: { researched: impact.researched, baselineMinutes: impact.time.baselineMinutes, humanMinutes: impact.time.humanMinutes, machineMinutes: impact.time.machineMinutes, savedMinutes: impact.time.savedMinutes, manualMinutesPerCompany: manual } };
  const used = preview ? sampleScenario(preview, now) : real;
  const card = computeScorecard(used);
  const domainOf = new Map(index.map((c) => [c.id, c.domain]));
  const recent = [...used.reviews].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 12);
  const by = used.time.baselineMinutes;
  const people = used.time.humanMinutes;
  const widest = Math.max(1, by, people, used.time.machineMinutes);
  const verdictTone = card.verdict === "stop" ? "bad" : card.verdict === "watch" ? "warn" : card.verdict === "continue" ? "good" : "info";
  const keep = `?range=${range.key}`;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHead eyebrow="Insight" title="Scorecard" sub="The point at which this gets shut down, written down before it was built, and where it stands today.">
        <nav className="rangetabs" aria-label="Period">
          {(["7", "30", "all"] as const).map((k) => <Link key={k} href={`/scorecard?range=${k}`} aria-current={range.key === k && !preview ? "true" : undefined}>{k === "all" ? "All time" : `${k} days`}</Link>)}
        </nav>
      </PageHead>

      {demo ? (
        <div className="row" style={{ gap: 8 }}>
          <span className="small muted">Demo: see how it reads with</span>
          {([["healthy", "good results"], ["watch", "so-so results"], ["kill", "bad results"]] as const).map(([k, l]) => <Link key={k} href={`/scorecard${keep}&preview=${k}`} className={`btn small${preview === k ? " primary" : ""}`}>{l}</Link>)}
          {preview ? <Link href={`/scorecard${keep}`} className="btn small ghost">Back to the sample data</Link> : null}
        </div>
      ) : null}
      {preview ? <Banner tone="info" title="Made-up decisions">These 20 decisions are invented, to show how the scorecard reads. They are not this workspace&rsquo;s data.</Banner> : null}

      <section className={`card hero verdict ${verdictTone}`} aria-label="Verdict">
        <span className="verdict-ic"><Icon name={card.verdict === "stop" ? "alert" : card.verdict === "continue" ? "check" : card.verdict === "watch" ? "flag" : "info"} /></span>
        <div>
          <h2 style={{ fontSize: "1.25rem" }}>{card.headline}</h2>
          <p className="muted" style={{ margin: "6px 0 0", maxWidth: "70ch" }}>
            {card.decided} {card.decided === 1 ? "draft" : "drafts"} decided by a person in this period ({preview ? "sample" : range.label.toLowerCase()}). The thresholds are the Growth Lead&rsquo;s own, set before the build.
          </p>
        </div>
      </section>

      <section className="grid stagger" aria-label="Criteria">
        {card.criteria.map((c) => <CriterionCard key={c.id} c={c} />)}
      </section>

      <section className="split">
        <div className="stack tight">
          <SectionTitle icon="clock" title="Where the time goes" sub="Minutes in this period. By hand is the baseline you set; the others are person time and machine time." />
          <div className="card stack">
            {([["By hand", by, "muted"], ["With the system: person time", people, "brand"], ["Machine time (no one waiting)", used.time.machineMinutes, "faint"]] as const).map(([l, v, t]) => (
              <div key={l} className="stack tight">
                <div className="row" style={{ justifyContent: "space-between" }}><span className="small">{l}</span><b>{Math.round(v)} min</b></div>
                <div className={`bar-track t-${t}`}><i style={{ width: `${(v / widest) * 100}%` }} /></div>
              </div>
            ))}
            <p className="small muted" style={{ margin: 0 }}>
              {card.personMinutesPerCompany === null ? "No company researched yet." : `About ${card.personMinutesPerCompany.toFixed(1)} minutes of person time per company, against an aim of under ${AIM_PERSON_MINUTES}.`} Estimated from the assumptions in <Link href="/settings#limits">Settings</Link>; a stopwatch would be better, and this is stated so nobody mistakes it for one.
            </p>
          </div>
        </div>
        <div className="stack tight">
          <SectionTitle icon="info" title="What this cannot say" />
          <div className="card stack tight">
            <p className="small" style={{ margin: 0 }}><b>Conversion.</b> The case also wants pipeline conversion to hold or improve. In test mode nobody outside is mailed, so there are no replies to count. It is left out rather than guessed.</p>
            <p className="small" style={{ margin: 0 }}><b>Small samples.</b> Below {MIN_DECIDED} decisions a rate swings too much to mean anything, so it is shown as &ldquo;not enough data&rdquo;, never as good news.</p>
            <p className="small" style={{ margin: 0 }}><b>The warning band</b> on contact accuracy (60% to 70%) is this team&rsquo;s own margin, not the class&rsquo;s.</p>
          </div>
        </div>
      </section>

      <section className="stack tight" aria-label="Recent decisions">
        <SectionTitle icon="list" title="The decisions behind the numbers" sub="The latest drafts a person approved or rejected. Each is a permanent record." />
        {recent.length === 0 ? (
          <div className="card"><Empty title="No decisions yet" icon="inbox"><p className="small" style={{ margin: 0 }}>They appear here as drafts are approved or rejected on the <Link href="/review">Review desk</Link>.</p></Empty></div>
        ) : (
          <div className="tablewrap"><table>
            <thead><tr><th>Company</th><th>Decision</th><th className="num">Changed</th><th>Contact</th><th>When</th></tr></thead>
            <tbody>
              {recent.map((r, i) => {
                const dom = r.prospect_id ? domainOf.get(r.prospect_id) : undefined;
                return (
                  <tr key={i}>
                    <td>{dom && r.prospect_id ? <Link href={`/prospects/${r.prospect_id}`}><strong>{dom}</strong></Link> : <span className="muted">sample</span>}</td>
                    <td>{r.action === "reject" ? <Pill tone="bad">Rejected</Pill> : isRewrite(r) ? <Pill tone="warn">Rewritten</Pill> : <Pill tone="good">Approved</Pill>}{r.reason ? <div className="small muted">{r.reason}</div> : null}</td>
                    <td className="num">{r.action === "reject" ? "-" : `${Math.round(Number(r.edit_ratio) * 100)}%`}</td>
                    <td>{r.contact_ok ? <span className="muted">Right</span> : <Pill tone="bad">Wrong person</Pill>}</td>
                    <td className="small muted nowrap">{dateTime(String(r.created_at))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}

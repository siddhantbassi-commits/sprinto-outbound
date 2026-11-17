import Link from "next/link";
import { Icon } from "@/components/icons";
import { AdvanceButton } from "@/components/live";
import { Empty, Kpi, LanePill, Meter, PageHead, Pill, Ring, SectionTitle } from "@/components/ui";
import { ago, dateTime, plural } from "@/lib/app/format";
import { computeImpact, hours, rangeFor } from "@/lib/app/impact";
import { currentSettings, impactData, listRuns, needsAttention, settingsPage, workerStatus } from "@/lib/app/queries";
import { buildReadiness } from "@/lib/app/readiness";
import { getSession, hunterBalance } from "@/lib/app/runtime";
import { factsFileProblems, type SprintoFactsFile } from "@/lib/pitch/sprinto-facts";
import { withSettings } from "@/lib/worker/pipeline";

export const metadata = { title: "Runs" };
const DAY = 86_400_000;

export default async function Runs() {
  const s = (await getSession())!;
  const now = Date.now();
  const [runs, status, settings, page, hunter, data, needs] = await Promise.all([listRuns(s.db), workerStatus(s.db), currentSettings(s.db), settingsPage(s.db), hunterBalance(), impactData(s.db), needsAttention(s.db)]);
  const canRun = s.user.role === "operator" || s.user.role === "admin";
  const waiting = runs.reduce((n, r) => n + (r.counts.active ?? 0), 0);

  const file = page.file?.content as SprintoFactsFile | undefined;
  const signed = new Set(page.signoffs.map((x) => String(x.icp_version_id)));
  const icp = page.icp.find((v) => signed.has(v.id));
  const readiness = buildReadiness({
    mode: s.mode,
    testTo: settings?.test_to ?? null,
    icpSignedVersion: icp?.version ?? null,
    factsProblems: file && settings ? factsFileProblems(withSettings(file, settings)) : ["There is no facts file."],
    geminiSet: !!s.env.gemini,
    gmailSet: !!s.env.gmail,
    hunter: hunter && "error" in hunter && hunter.error ? { error: hunter.error } : hunter && typeof hunter.remaining === "number" ? { remaining: hunter.remaining } : null,
    lastTick: status.lastTick,
    now,
    waiting,
    reserve: settings?.hunter_reserve ?? 3,
  });

  // The week, against the week before. Assumptions for time saved are the ones an admin set, shown on Impact.
  const assumptions = { manualMinutes: Number(settings?.minutes_saved_per_email ?? 20), reviewMinutesPerEmail: Number(settings?.review_minutes_per_email ?? 1.5), reviewMinutesPerDecision: Number(settings?.review_minutes_per_decision ?? 2) };
  const week = computeImpact({ ...data, range: { key: "7", label: "Last 7 days", from: now - 7 * DAY, to: now }, assumptions });
  const before = computeImpact({ ...data, range: { key: "7", label: "Previous 7 days", from: now - 14 * DAY, to: now - 7 * DAY - 1 }, assumptions });
  void rangeFor;
  const trend = (a: number, b: number) => (b === 0 && a === 0 ? undefined : a === b ? { text: "no change", dir: "flat" as const } : { text: `${a > b ? "+" : "−"}${Math.abs(a - b)} on the week before`, dir: a > b ? ("up" as const) : ("down" as const) });

  const decisions = needs.filter((p) => p.lane !== "needs_more" && p.lane !== "no_contact");
  const todo = readiness.items.filter((x) => !x.ok && !x.optional);
  const lastTick = status.lastTick ? new Date(status.lastTick).getTime() : null;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHead eyebrow="Workspace" title="Runs" sub="What the pipeline has done, and what is waiting on you.">
        {canRun ? <AdvanceButton /> : null}
        {canRun ? <Link href="/runs/new" className="btn primary"><Icon name="plus" />New run</Link> : null}
      </PageHead>

      {!readiness.ready ? (
        <section className="card hero stack" aria-labelledby="setup-h">
          <div className="row" style={{ gap: 22, alignItems: "center", flexWrap: "nowrap" }}>
            <Ring value={readiness.done} max={readiness.total} label={`of ${readiness.total}`} tone={readiness.done === readiness.total ? "good" : "brand"} size={96} />
            <div style={{ minWidth: 0 }}>
              <h2 id="setup-h" style={{ fontSize: "1.25rem" }}>Before you can send</h2>
              <p className="muted" style={{ margin: "4px 0 0", maxWidth: "58ch" }}>
                {todo.length === 1 ? "One item remains." : `${todo.length} items remain.`} Each takes a minute, and the system will not start a run or send an email until they are done.
              </p>
            </div>
          </div>
          <ul className="checklist stagger">
            {readiness.items.filter((x) => !x.optional || !x.ok).map((x) => (
              <li key={x.id} className={x.ok ? "done" : x.optional ? "" : "todo"}>
                <span className="tick" aria-hidden><Icon name={x.ok ? "check" : x.optional ? "info" : "alert"} /></span>
                <span><b>{x.label}</b><small>{x.detail}</small></span>
                {x.ok ? <Pill tone="good">Done</Pill> : s.user.role === "admin" || x.id === "worker" ? <Link className="btn small" href={x.href}>{x.action}<Icon name="arrow" /></Link> : <Pill tone="muted">Ask an admin</Pill>}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="row" style={{ gap: 14 }}>
          <span className="chip"><span className="dot-live" aria-hidden /> Ready to send</span>
          <span className="small muted">
            {settings?.test_to ? <>Mail goes only to {settings.test_to}. </> : null}
            Worker {lastTick ? `last ran ${ago(status.lastTick)}` : "has not run yet"}.
          </span>
        </div>
      )}

      <section aria-label="This week" className="stack tight">
        <SectionTitle title="Last 7 days" sub="Against the 7 days before. Time saved is an estimate from assumptions you set; the working is on Impact." />
        <div className="kpis stagger">
          <Kpi icon="globe" label="Companies researched" count={week.researched} foot={<>{plural(week.domains, "domain")} added</>} delta={trend(week.researched, before.researched)} />
          <Kpi icon="target" label="Qualified" count={week.qualified} foot={week.researched ? `${Math.round((week.qualified / week.researched) * 100)}% of those researched` : "None researched yet"} delta={trend(week.qualified, before.qualified)} />
          <Kpi icon="mail" label="Test emails sent" count={week.sent} foot={`${week.drafted} drafted`} delta={trend(week.sent, before.sent)} />
          <Kpi icon="clock" label="Person time saved" value={week.researched ? hours(week.time.savedMinutes) : "-"} foot={<Link href="/impact">See the working</Link>} />
        </div>
      </section>

      <div className="split">
        <section className="stack tight" aria-label="Needs a decision">
          <SectionTitle icon="bell" title="Needs a decision" sub={decisions.length ? `${plural(decisions.length, "company", "companies")} waiting for a person.` : undefined}>
            {decisions.length ? <Link href="/review" className="btn small">Open review<Icon name="arrow" /></Link> : null}
          </SectionTitle>
          {decisions.length === 0 ? (
            <div className="card"><Empty title="Nothing is waiting on you" icon="check"><p className="small" style={{ margin: 0 }}>Maybes, held drafts and uncertain sends appear here as they happen.</p></Empty></div>
          ) : (
            <div className="queue stagger">
              {decisions.slice(0, 6).map((p) => (
                <Link key={p.id} href={`/prospects/${p.id}`} className="queue-item" style={{ textDecoration: "none" }}>
                  <LanePill lane={p.lane} />
                  <span><strong>{p.domain}</strong><small>{p.lane_reason ?? "No reason recorded"}</small></span>
                  <Icon name="arrow" />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="stack tight" aria-label="Pipeline health">
          <SectionTitle icon="pulse" title="Pipeline" sub="Where every company has ended up." />
          <div className="card stack">
            {runs.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No runs yet.</p> : (
              <>
                <Meter counts={runs.reduce<Record<string, number>>((a, r) => { for (const [k, v] of Object.entries(r.counts)) a[k] = (a[k] ?? 0) + v; return a; }, {})} />
                <dl className="kv" style={{ gridTemplateColumns: "120px minmax(0, 1fr)" }}>
                  <dt>Runs</dt><dd>{runs.length}</dd>
                  <dt>In progress</dt><dd>{waiting}</dd>
                  <dt>Sent (test)</dt><dd>{runs.reduce((n, r) => n + (r.counts.sent ?? 0), 0)}</dd>
                  <dt>Worker</dt><dd>{lastTick ? `ran ${ago(status.lastTick)}` : "has not run"}</dd>
                </dl>
              </>
            )}
          </div>
        </section>
      </div>

      <section className="stack tight" aria-label="Runs">
        <SectionTitle icon="runs" title="Runs" />
        {runs.length === 0 ? (
          <div className="card">
            <Empty title="No runs yet" icon="runs">
              <p className="small" style={{ margin: 0, maxWidth: "52ch" }}>Paste a list of domains. Each is read, judged against the ICP, matched to one named person and written to.</p>
              {canRun ? <Link href="/runs/new" className="btn primary" style={{ marginTop: 10 }}><Icon name="plus" />Start a run</Link> : <p className="small muted">An operator can start one.</p>}
            </Empty>
          </div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Run</th><th>Progress</th><th className="num">Domains</th><th className="num">Sent</th><th>Needs you</th></tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const needsYou = (r.counts.review ?? 0) + (r.counts.held ?? 0) + (r.counts.unknown ?? 0) + (r.counts.failed ?? 0);
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/runs/${r.id}`}><strong>{r.note || `Run of ${plural(r.domain_count, "domain")}`}</strong></Link>
                        <div className="small muted">{dateTime(r.created_at)} · {r.source === "csv" ? "CSV" : "pasted"}{r.paused ? " · paused" : ""}</div>
                      </td>
                      <td style={{ minWidth: 180 }}><Meter counts={r.counts} /></td>
                      <td className="num">{r.domain_count}</td>
                      <td className="num">{r.counts.sent ?? 0}</td>
                      <td>{needsYou ? <Link href="/review">{needsYou} waiting</Link> : <span className="muted">Nothing</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

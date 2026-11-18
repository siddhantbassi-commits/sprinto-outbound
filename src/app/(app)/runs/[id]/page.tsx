import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { RunControls } from "./controls";
import { Icon } from "@/components/icons";
import { LiveRun } from "@/components/live";
import { ProgressPanel } from "@/components/progress-panel";
import { estimateRun, stepSeconds } from "@/lib/app/progress";
import { Banner, Empty, Kpi, LanePill, PageHead, Ring, SectionTitle, VerdictPill } from "@/components/ui";
import { ago, dateTime, plural, runSource, STEPS } from "@/lib/app/format";
import { getRun } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";
import { activity, duration, filterProspects, parseShow, runHeadline, runProgress, SHOWS, stageCounts, track } from "@/lib/app/runview";

export const metadata = { title: "Run" };

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const s = (await getSession())!;
  const data = await getRun(s.db, id);
  if (!data) notFound();
  const { run, prospects, paused, tokens, credits, events, decisions } = data;
  const now = Date.now();
  const show = parseShow(q.show);
  const canRun = s.user.role === "operator" || s.user.role === "admin";
  const prog = runProgress(prospects, run.created_at, now, events[0]?.created_at);
  const stages = stageCounts(prospects);
  const est = estimateRun(prospects.map((p) => ({ step: p.step, lane: p.lane, running: !!p.lease_until && new Date(p.lease_until).getTime() > now })), stepSeconds(events));
  const listed = filterProspects(prospects, show);
  const domainOf = new Map(prospects.map((p) => [p.id, p.domain]));
  const feed = activity(events, decisions, domainOf);
  const promptVersions = Object.entries((run as unknown as { prompt_versions?: Record<string, string> }).prompt_versions ?? {});
  const counts: Record<string, number> = {};
  for (const p of prospects) counts[p.lane] = (counts[p.lane] ?? 0) + 1;
  const tone = prog.active > 0 && !paused ? "brand" : prog.needsPerson > 0 ? "warn" : "good";
  const reached0 = Math.max(1, stages[0]?.reached ?? 1);

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="crumbs"><Link href="/runs">Runs</Link> / {dateTime(run.created_at)}</div>
      <PageHead eyebrow="Run" title={run.note || `Run of ${plural(run.domain_count, "domain")}`} sub={`Started ${ago(run.created_at, now)}, ${runSource(run.source).how}.`}>
        {prog.needsPerson > 0 ? <Link className="btn primary" href="/review"><Icon name="bell" />{prog.needsPerson} to review</Link> : null}
        <a className="btn" href={`/runs/${id}/export`}><Icon name="down" />Download CSV</a>
      </PageHead>

      {paused ? <Banner tone="warn" title="This run is paused">No new step will start for it until it is resumed.</Banner> : null}

      <section className="card hero stack" aria-label="Progress">
        <div className="row" style={{ gap: 22, alignItems: "center", flexWrap: "nowrap" }}>
          <Ring value={prog.settled} max={Math.max(1, prog.total)} label="finished" tone={tone} size={96} />
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: "1.25rem" }}>{runHeadline(prog, paused)}</h2>
            <p className="muted small" style={{ margin: "5px 0 0" }}>
              {prog.active > 0 ? "Running for" : "Took"} {duration(prog.elapsedMs)}.
            </p>
          </div>
        </div>
        <ProgressPanel est={est} paused={paused} />
        <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
          {paused ? <span className="small muted">Paused: the worker skips this run.</span> : <LiveRun active={prog.active > 0} />}
          {canRun ? <RunControls runId={id} paused={paused} /> : null}
        </div>
      </section>

      <section className="kpis stagger" aria-label="Totals">
        <Kpi icon="globe" label="Domains" count={prog.total} foot={`${prog.settled} finished`} />
        <Kpi icon="mail" label="Test emails sent" count={prog.sent} foot="to the test address only" />
        <Kpi icon="refresh" label="In progress" count={prog.active} foot={prog.active ? "worked on automatically" : "nothing running"} />
        <Kpi icon="bell" label="Need a person" count={prog.needsPerson} foot={prog.needsPerson ? <Link href="/review">Open the review desk</Link> : "nothing waiting"} />
      </section>

      <section className="stack tight" aria-label="Pipeline">
        <SectionTitle icon="pulse" title="Where every company is" sub="How many have got at least as far as each step. A gap between two steps is where companies dropped out or are still working." />
        <div className="stages card">
          {stages.map((st) => (
            <div key={st.step} className="stage">
              <span className="stage-n"><b>{st.reached}</b><small>of {prog.total}</small></span>
              <div className="bar-track t-brand"><i style={{ width: `${(st.reached / reached0) * 100}%` }} /></div>
              <span className="stage-l">{st.label}</span>
              <span className="stage-m">
                {st.working ? <em className="live">{st.working} working</em> : null}
                {st.stopped ? <em className="stop">{st.stopped} stopped</em> : null}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="split">
        <section className="stack tight" aria-label="Companies">
          <SectionTitle icon="list" title="Companies" sub={`${plural(listed.length, "company", "companies")} shown.`}>
            <nav className="rangetabs" aria-label="Show">
              {SHOWS.map(([k, l]) => <Link key={k} href={k === "all" ? `/runs/${id}` : `/runs/${id}?show=${k}`} aria-current={show === k ? "true" : undefined}>{l}{k !== "all" ? <span className="muted"> {filterProspects(prospects, k).length}</span> : null}</Link>)}
            </nav>
          </SectionTitle>
          {listed.length === 0 ? (
            <div className="card"><Empty title="Nothing here" icon="inbox"><p className="small" style={{ margin: 0 }}>No company matches this filter.</p></Empty></div>
          ) : (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Company</th><th>Progress</th><th>Result</th><th className="num">Score</th></tr></thead>
                <tbody>
                  {listed.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/prospects/${p.id}`}><strong>{p.domain}</strong></Link>
                        <div className="small muted">{p.lane_reason ?? (p.lane === "active" ? "Working on it." : "")}</div>
                      </td>
                      <td>
                        <span className="dots" role="img" aria-label={`${STEPS[p.step] ?? p.step}`}>{track(p).map((d, i) => <i key={i} className={d} />)}</span>
                        <div className="small muted">{STEPS[p.step] ?? p.step}</div>
                      </td>
                      <td><LanePill lane={p.lane} /></td>
                      <td className="num">{p.score ?? "-"}{p.verdict ? <><br /><VerdictPill verdict={p.verdict} /></> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="stack tight" aria-label="Activity">
          <SectionTitle icon="clock" title="Just happened" sub="Steps and decisions, newest first." />
          <div className="card">
            {feed.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Nothing yet.</p> : (
              <ol className="feed" aria-live="polite">
                {feed.map((a) => (
                  <li key={a.key} className={a.tone}>
                    <span className="dot" aria-hidden />
                    <span>
                      <span>{a.text}</span>
                      <small>{a.domain && a.prospectId ? <Link href={`/prospects/${a.prospectId}`}>{a.domain}</Link> : null}{a.domain ? " · " : ""}{ago(new Date(a.at), now)}</small>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="card stack tight">
            <h3 style={{ fontSize: "1rem" }}>What it has used</h3>
            <dl className="kv" style={{ gridTemplateColumns: "120px minmax(0, 1fr)" }}>
              <dt>Model tokens</dt><dd>{Math.round(tokens).toLocaleString("en-GB")}</dd>
              <dt>Hunter credits</dt><dd>{Math.round(credits)}</dd>
              <dt>Sent</dt><dd>{counts.sent ?? 0} of {prog.total}</dd>
            </dl>
          </div>
        </aside>
      </div>

      <details className="card">
        <summary>How this run was configured</summary>
        <p className="small muted">A run is replayable: it records the exact versions it used.</p>
        <dl className="kv">
          <dt>ICP version</dt><dd><span className="tag">{String(run.icp_version_id).slice(0, 8)}</span></dd>
          <dt>Facts file</dt><dd><span className="tag">{String(run.facts_version_id).slice(0, 8)}</span></dd>
          <dt>Settings</dt><dd><span className="tag">{String(run.settings_version_id).slice(0, 8)}</span></dd>
          {promptVersions.map(([k, v]) => <Fragment key={k}><dt>{k} prompt</dt><dd><span className="tag">{v}</span></dd></Fragment>)}
        </dl>
      </details>
    </div>
  );
}

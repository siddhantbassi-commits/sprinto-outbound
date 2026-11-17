import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { RunControls } from "./controls";
import { LiveRun } from "@/components/live";
import { Banner, LanePill, Meter, PageHead, VerdictPill } from "@/components/ui";
import { dateTime, plural, STEP_ORDER, STEPS } from "@/lib/app/format";
import { getRun } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";

export const metadata = { title: "Run" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = (await getSession())!;
  const data = await getRun(s.db, id);
  if (!data) notFound();
  const { run, prospects, paused, tokens, credits } = data;
  const counts: Record<string, number> = {};
  for (const p of prospects) counts[p.lane] = (counts[p.lane] ?? 0) + 1;
  const active = counts.active ?? 0;
  const canRun = s.user.role === "operator" || s.user.role === "admin";
  const needs = (counts.review ?? 0) + (counts.held ?? 0) + (counts.unknown ?? 0) + (counts.failed ?? 0);
  const promptVersions = Object.entries((run as unknown as { prompt_versions?: Record<string, string> }).prompt_versions ?? {});

  return (
    <div className="stack">
      <div className="crumbs"><Link href="/">Runs</Link> / {dateTime(run.created_at)}</div>
      <PageHead title={run.note || `Run of ${plural(run.domain_count, "domain")}`} sub={`Started ${dateTime(run.created_at)}, ${run.source === "csv" ? "from a CSV" : "pasted"}.`}>
        <a className="btn" href={`/runs/${id}/export`}>Download CSV</a>
      </PageHead>

      {paused ? <Banner tone="warn" title="This run is paused">No new step will start for it until it is resumed.</Banner> : null}

      <div className="card row" style={{ justifyContent: "space-between" }}>
        {paused ? <span className="small muted">Paused: the worker skips this run.</span> : <LiveRun active={active > 0} />}
        {canRun ? <RunControls runId={id} paused={paused} /> : null}
      </div>

      <div className="grid">
        <div className="card stat"><b>{prospects.length}</b><span>Domains</span></div>
        <div className="card stat"><b>{counts.sent ?? 0}</b><span>Test emails sent</span></div>
        <div className="card stat"><b>{active}</b><span>In progress</span></div>
        <div className="card stat"><b>{needs}</b><span>Need a person</span></div>
      </div>
      <div className="card stack">
        <Meter counts={counts} />
        <div className="small muted">{plural(Math.round(tokens), "model token")} used · {plural(Math.round(credits), "Hunter credit")} used{needs ? <> · <Link href="/review">{needs} waiting for you</Link></> : null}</div>
      </div>

      <div className="tablewrap">
        <table>
          <thead><tr><th>Company</th><th>Where it is</th><th>Result</th><th className="num">Score</th><th>Why</th></tr></thead>
          <tbody>
            {prospects.map((p) => {
              const at = STEP_ORDER.indexOf(p.step);
              return (
                <tr key={p.id}>
                  <td><Link href={`/prospects/${p.id}`}><strong>{p.domain}</strong></Link></td>
                  <td>
                    <div>{STEPS[p.step] ?? p.step}</div>
                    <div className="small muted">step {at + 1} of {STEP_ORDER.length}</div>
                  </td>
                  <td><LanePill lane={p.lane} /></td>
                  <td className="num">{p.score ?? "-"} {p.verdict ? <><br /><VerdictPill verdict={p.verdict} /></> : null}</td>
                  <td className="small">{p.lane_reason ?? (p.lane === "active" ? "Working on it." : "")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
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

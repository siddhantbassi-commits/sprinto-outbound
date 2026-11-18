import Link from "next/link";
import { Icon } from "@/components/icons";
import { AdvanceButton } from "@/components/live";
import { Empty, Meter, PageHead, SectionTitle } from "@/components/ui";
import { ago, dateTime, plural, runSource } from "@/lib/app/format";
import { listRuns, workerStatus } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";

export const metadata = { title: "Runs" };

export default async function Runs() {
  const s = (await getSession())!;
  const [runs, status] = await Promise.all([listRuns(s.db), workerStatus(s.db)]);
  const canRun = s.user.role === "operator" || s.user.role === "admin";
  const waiting = runs.reduce((n, r) => n + (r.counts.active ?? 0), 0);

  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHead eyebrow="Work" title="Runs" sub="Every batch of companies, and how far each has got.">
        {canRun ? <AdvanceButton /> : null}
        {canRun ? <Link href="/runs/new" className="btn"><Icon name="list" />Paste a list</Link> : null}
        {canRun ? <Link href="/discover" className="btn primary"><Icon name="search" />Discover companies</Link> : null}
      </PageHead>

      <section className="stack tight" aria-label="Pipeline health">
        <SectionTitle icon="pulse" title="Pipeline" sub="Where every company in these runs has ended up." />
        <div className="card stack">
          {runs.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No runs yet.</p> : (
            <>
              <Meter counts={runs.reduce<Record<string, number>>((a, r) => { for (const [k, v] of Object.entries(r.counts)) a[k] = (a[k] ?? 0) + v; return a; }, {})} />
              <dl className="kv" style={{ gridTemplateColumns: "120px minmax(0, 1fr)" }}>
                <dt>Runs</dt><dd>{runs.length}</dd>
                <dt>In progress</dt><dd>{waiting}</dd>
                <dt>Sent (test)</dt><dd>{runs.reduce((n, r) => n + (r.counts.sent ?? 0), 0)}</dd>
                <dt>Worker</dt><dd>{status.lastTick ? `ran ${ago(status.lastTick)}` : "has not run"}</dd>
              </dl>
            </>
          )}
        </div>
      </section>

      <section className="stack tight" aria-label="Runs">
        <SectionTitle icon="runs" title="Runs" />
        {runs.length === 0 ? (
          <div className="card">
            <Empty title="No runs yet" icon="runs">
              <p className="small" style={{ margin: 0, maxWidth: "52ch" }}>Find companies that look like Sprinto customers, or paste your own list. Each is read, judged against the ICP, matched to one named person and written up for a discovery call.</p>
              {canRun ? <span className="row" style={{ marginTop: 10 }}><Link href="/discover" className="btn primary"><Icon name="search" />Discover companies</Link><Link href="/runs/new" className="btn">Paste a list</Link></span> : <p className="small muted">An operator can start one.</p>}
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
                        <div className="small muted">{dateTime(r.created_at)} · {runSource(r.source).label}{r.paused ? " · paused" : ""}</div>
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

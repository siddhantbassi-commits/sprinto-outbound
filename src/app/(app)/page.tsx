import Link from "next/link";
import { CountUp } from "@/components/count-up";
import { Icon, type IconName } from "@/components/icons";
import { AdvanceButton } from "@/components/live";
import { Empty, Kpi, LanePill, PageHead, Pill, Ring, SectionTitle } from "@/components/ui";
import { ago, plural } from "@/lib/app/format";
import { hours } from "@/lib/app/impact";
import { getSession } from "@/lib/app/runtime";
import { followUpText } from "@/lib/app/outcomes";
import { roughTime } from "@/lib/app/progress";
import { dateHeading } from "@/lib/app/today";
import { loadToday } from "@/lib/app/today-load";
import { ItemAction } from "@/components/item-action";

export const metadata = { title: "Today" };

function Card({ icon, title, count, tone, children, action }: { icon: IconName; title: string; count: number; tone?: "warn"; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className={`today-card${count > 0 && tone ? ` ${tone}` : ""}`} aria-label={title}>
      <div className="today-head">
        <span className="today-ico" aria-hidden><Icon name={icon} /></span>
        <div><div className="today-n"><CountUp to={count} ms={500} /></div><div className="today-t">{title}</div></div>
      </div>
      <div className="today-body">{children}</div>
      {action ? <div className="today-act">{action}</div> : null}
    </section>
  );
}

export default async function Today() {
  const s = (await getSession())!;
  const now = Date.now();
  const t = await loadToday(s, now);
  const canRun = s.user.role === "operator" || s.user.role === "admin";
  const todo = t.readiness.items.filter((x) => !x.ok && !x.optional);
  const lastTick = t.lastTick ? new Date(t.lastTick).getTime() : null;
  const trend = (a: number, b: number) => (b === 0 && a === 0 ? undefined : a === b ? { text: "no change", dir: "flat" as const } : { text: `${a > b ? "+" : "−"}${Math.abs(a - b)} on the week before`, dir: a > b ? ("up" as const) : ("down" as const) });
  const overdue = t.followUps.filter((f) => f.followUp.state !== "upcoming").length;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHead eyebrow={dateHeading(now)} title="Today" sub="What needs you this morning, and where everything stands.">
        {canRun ? <AdvanceButton /> : null}
        {canRun ? <Link href="/runs/new" className="btn"><Icon name="list" />Paste a list</Link> : null}
        {canRun ? <Link href="/discover" className="btn primary"><Icon name="search" />Discover companies</Link> : null}
      </PageHead>

      {!t.readiness.ready ? (
        <section className="card hero stack" aria-labelledby="setup-h">
          <div className="row" style={{ gap: 22, alignItems: "center", flexWrap: "nowrap" }}>
            <Ring value={t.readiness.done} max={t.readiness.total} label={`of ${t.readiness.total}`} tone="brand" size={96} />
            <div style={{ minWidth: 0 }}>
              <h2 id="setup-h" style={{ fontSize: "1.25rem" }}>Before you can send</h2>
              <p className="muted" style={{ margin: "4px 0 0", maxWidth: "58ch" }}>{todo.length === 1 ? "One item remains." : `${todo.length} items remain.`} Each takes a minute, and the system will not start a run or send an email until they are done.</p>
            </div>
          </div>
          <ul className="checklist stagger">
            {t.readiness.items.filter((x) => !x.optional || !x.ok).map((x) => (
              <li key={x.id} className={x.ok ? "done" : x.optional ? "" : "todo"}>
                <span className="tick" aria-hidden><Icon name={x.ok ? "check" : x.optional ? "info" : "alert"} /></span>
                <span><b>{x.label}</b><small>{x.detail}</small></span>
                {x.ok ? <Pill tone="good">Done</Pill> : s.user.role === "admin" || x.id === "worker" ? <ItemAction item={x} here="/" /> : <Pill tone="muted">Ask an admin</Pill>}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="row" style={{ gap: 14 }}>
          <span className="chip"><span className="dot-live" aria-hidden /> Ready to send</span>
          <span className="small muted">{t.testTo ? <>Mail goes only to {t.testTo}. </> : null}Worker {lastTick ? `last ran ${ago(t.lastTick)}` : "has not run yet"}. <Link href="/golive">Go-live readiness</Link></span>
        </div>
      )}

      <div className="today-grid stagger" data-tour="today">
        <Card icon="mail" title="Drafts to approve" count={t.approvals} tone="warn" action={t.approvals ? <Link className="btn primary small" href="/review">Open the review desk<Icon name="arrow" /></Link> : null}>
          {t.approvals ? <p className="small" style={{ margin: 0 }}>{plural(t.approvals, "email")} written and waiting. Nothing is sent until you approve it.</p> : <p className="small muted" style={{ margin: 0 }}>Nothing waiting. New drafts appear here as the pipeline finishes them.</p>}
        </Card>

        <Card icon="clock" title="Follow-ups due" count={t.followUps.length} tone="warn" action={<Link className="btn small" href="/leads?view=follow">All follow-ups<Icon name="arrow" /></Link>}>
          {t.followUps.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No follow-ups in the next week. Set a date when you record an outcome and it appears here.</p> : (
            <ul className="today-list">
              {t.followUps.slice(0, 3).map((f) => (
                <li key={f.id}><Link href={`/prospects/${f.id}/brief`}><b>{f.name}</b></Link><span className={f.followUp.state === "upcoming" ? "muted small" : "small overdue"}>{followUpText(f.followUp)}</span></li>
              ))}
              {t.followUps.length > 3 ? <li className="small muted">and {t.followUps.length - 3} more{overdue ? `, ${overdue} due now` : ""}</li> : null}
            </ul>
          )}
        </Card>

        <Card icon="spark" title="New from the digest" count={t.digest?.fresh.length ?? 0} action={<Link className="btn small" href="/digest">{t.digest?.hasSearch ? "Open the digest" : "Set up the digest"}<Icon name="arrow" /></Link>}>
          {!t.digest?.hasSearch ? <p className="small muted" style={{ margin: 0 }}>No weekly search is saved. Save one on Discover and new companies arrive every Monday.</p>
            : t.digest.fresh.length === 0 ? <p className="small muted" style={{ margin: 0 }}>{t.digest.latest ? "Nothing from the latest digest is left to research." : "No digest has run yet."}</p>
            : <ul className="today-list">{t.digest.fresh.slice(0, 3).map((c) => <li key={c.domain}><b>{c.name}</b><span className="muted small">{c.domain}</span></li>)}{t.digest.fresh.length > 3 ? <li className="small muted">and {t.digest.fresh.length - 3} more</li> : null}</ul>}
        </Card>

        <Card icon="runs" title="Running now" count={t.running.length} action={<Link className="btn small" href="/runs">All runs<Icon name="arrow" /></Link>}>
          {t.running.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Nothing running.</p> : (
            <ul className="today-list">
              {t.running.slice(0, 2).map((r) => (
                <li key={r.id} className="col">
                  <Link href={`/runs/${r.id}`}><b>{r.title}</b></Link>
                  <div className="bar-track t-brand"><i style={{ width: `${Math.max(3, r.percent)}%` }} /></div>
                  <span className="small muted">{r.percent}%{r.remainingSeconds !== null ? `, ${roughTime(r.remainingSeconds)} to go` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section className="stack tight" aria-label="The pursuit">
        <SectionTitle icon="target" title="Where the leads are" sub="Every lead worth a call, by how far you have got.">
          <Link href="/leads?view=board" className="btn small">Open the board<Icon name="arrow" /></Link>
        </SectionTitle>
        <ol className="pursuit">
          {t.pipeline.map((p) => (
            <li key={p.id} className={p.count ? "has" : ""}>
              <Link href={`/leads?view=board`}><b><CountUp to={p.count} ms={400} /></b><span>{p.label}</span></Link>
            </li>
          ))}
        </ol>
        {t.nextCalls.length ? (
          <p className="small" style={{ margin: 0 }}><span className="muted">Best to call first: </span>{t.nextCalls.map((l, i) => <span key={l.id}>{i ? ", " : ""}<Link href={`/prospects/${l.id}/brief`}>{l.name}</Link> ({l.score})</span>)}</p>
        ) : null}
      </section>

      <div className="split">
        <section className="stack tight" aria-label="Needs a decision">
          <SectionTitle icon="bell" title="Needs a decision" sub={t.decisions.length ? `${plural(t.decisions.length, "company", "companies")} waiting for a person.` : undefined}>
            {t.decisions.length ? <Link href="/review" className="btn small">Open review<Icon name="arrow" /></Link> : null}
          </SectionTitle>
          {t.decisions.length === 0 ? (
            <div className="card"><Empty title="Nothing is waiting on you" icon="check"><p className="small" style={{ margin: 0 }}>Maybes, held drafts and uncertain sends appear here as they happen.</p></Empty></div>
          ) : (
            <div className="queue stagger">
              {t.decisions.slice(0, 6).map((p) => (
                <Link key={p.id} href={`/prospects/${p.id}`} className="queue-item" style={{ textDecoration: "none" }}>
                  <LanePill lane={p.lane} />
                  <span><strong>{p.domain}</strong><small>{p.lane_reason ?? "No reason recorded"}</small></span>
                  <Icon name="arrow" />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section aria-label="This week" className="stack tight">
          <SectionTitle title="Last 7 days" sub="Against the 7 days before." />
          <div className="kpis stagger">
            <Kpi icon="globe" label="Researched" count={t.week.researched} foot={<>{plural(t.week.domains, "domain")} added</>} delta={trend(t.week.researched, t.before.researched)} />
            <Kpi icon="target" label="Qualified" count={t.week.qualified} foot={t.week.researched ? `${Math.round((t.week.qualified / t.week.researched) * 100)}% of those researched` : "None yet"} delta={trend(t.week.qualified, t.before.qualified)} />
            <Kpi icon="mail" label="Test emails sent" count={t.week.sent} foot={`${t.week.drafted} drafted`} delta={trend(t.week.sent, t.before.sent)} />
            <Kpi icon="clock" label="Time saved" value={t.week.researched ? hours(t.week.time.savedMinutes) : "-"} foot={<Link href="/impact">See the working</Link>} />
          </div>
        </section>
      </div>
    </div>
  );
}

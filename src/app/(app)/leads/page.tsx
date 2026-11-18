import Link from "next/link";
import { Icon } from "@/components/icons";
import { Empty, LanePill, PageHead, Pill, Ring, VerdictPill } from "@/components/ui";
import { ago, plural } from "@/lib/app/format";
import { isCallable, listLeads } from "@/lib/app/leads";
import { dayOf, followUpOf, followUpText, OUTCOME_BY_ID } from "@/lib/app/outcomes";
import { OutcomeForm } from "./outcome-form";
import { getSession } from "@/lib/app/runtime";

export const metadata = { title: "Leads" };

export default async function Leads({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const s = (await getSession())!;
  const canRun = s.user.role === "operator" || s.user.role === "admin";
  const all = await listLeads(s.db, s.user.role !== "viewer");
  const mode = show === "all" ? "all" : show === "follow" ? "follow" : "ready";
  const now = Date.now();
  const today = dayOf(now);
  const callable = all.filter(isCallable).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const due = all.filter((l) => followUpOf(l.outcome, today) !== null).sort((a, b) => (followUpOf(a.outcome, today)!.on < followUpOf(b.outcome, today)!.on ? -1 : 1));
  const rows = mode === "all" ? [...all].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) : mode === "follow" ? due : callable;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <PageHead eyebrow="Work" title="Leads" sub="Every company that has been researched, best fit first, with who to speak to and a brief for the call.">
        {canRun ? <Link className="btn primary" href="/discover"><Icon name="search" />Discover more</Link> : null}
      </PageHead>

      <div className="row between">
        <div className="segmented" role="group" aria-label="Show">
          <Link href="/leads" aria-pressed={mode === "ready"} aria-current={mode === "ready" ? "true" : undefined}>Worth a call ({callable.length})</Link>
          <Link href="/leads?show=follow" aria-pressed={mode === "follow"} aria-current={mode === "follow" ? "true" : undefined}>Follow up ({due.length})</Link>
          <Link href="/leads?show=all" aria-pressed={mode === "all"} aria-current={mode === "all" ? "true" : undefined}>All researched ({all.length})</Link>
        </div>
        <span className="small muted">{plural(rows.length, "company", "companies")} shown</span>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <Empty title={all.length === 0 ? "No companies researched yet" : mode === "follow" ? "No follow-ups set" : "Nothing worth a call yet"} icon="target">
            <p className="small" style={{ margin: 0, maxWidth: "52ch" }}>{all.length === 0 ? "Discover companies that look like Sprinto customers and research a few. They appear here with a brief for each." : mode === "follow" ? "When you record an outcome you can set a date to come back to a lead. Those with a date appear here, soonest first." : "Researched companies that score as a strong or possible fit appear here. See everything under All researched."}</p>
            {canRun ? <Link href="/discover" className="btn primary" style={{ marginTop: 10 }}><Icon name="search" />Discover companies</Link> : null}
          </Empty>
        </div>
      ) : (
        <ul className="leadcards">
          {rows.map((l, i) => (
            <li key={l.id} className="leadcard" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
              <Ring value={l.score ?? 0} max={100} tone={l.verdict === "qualified" ? "good" : l.verdict === "maybe" ? "warn" : "brand"} size={64} />
              <div className="lcmain">
                <div className="row" style={{ gap: 8 }}>
                  <Link href={`/prospects/${l.id}/brief`}><b>{l.name}</b></Link>
                  <span className="mono small muted">{l.domain}</span>
                  <VerdictPill verdict={l.verdict} />
                  <LanePill lane={l.lane} />
                  {l.outcome ? <Pill tone={OUTCOME_BY_ID[l.outcome.status].tone}>{OUTCOME_BY_ID[l.outcome.status].label}</Pill> : null}
                  {(() => { const f = followUpOf(l.outcome, today); return f ? <Pill tone={f.state === "overdue" ? "bad" : f.state === "today" ? "warn" : "info"}>{followUpText(f)}</Pill> : null; })()}
                </div>
                <p className="small" style={{ margin: 0 }}>
                  {l.contact ? <>Speak to <b>{l.contact.name}</b>{l.contact.title ? `, ${l.contact.title}` : ""}.</> : <span className="muted">No named person yet.</span>}
                  {l.reasons.length ? <span className="muted"> Fit because of {l.reasons.join(", ").toLowerCase()}.</span> : null}
                </p>
                {l.pains.length ? <ul className="because">{l.pains.map((p) => <li key={p}>{p}</li>)}</ul> : null}
                {l.outcome?.note ? <p className="small muted" style={{ margin: 0 }}>Last note: {l.outcome.note}</p> : null}
                {canRun ? (
                  <details className="outdetails">
                    <summary>{l.outcome ? "Update the outcome" : "Record what happened"}</summary>
                    <OutcomeForm prospectId={l.id} current={l.outcome?.status ?? null} />
                  </details>
                ) : null}
              </div>
              <div className="lcside">
                <span className="small muted">{ago(l.updatedAt, now)}</span>
                <Link className="btn small primary" href={`/prospects/${l.id}/brief`}>Open brief<Icon name="arrow" /></Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

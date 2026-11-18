import Link from "next/link";
import { LeadBoard } from "./lead-board";
import { LeadFilters } from "./lead-filters";
import { OutcomeForm } from "./outcome-form";
import { Icon } from "@/components/icons";
import { Empty, LanePill, PageHead, Pill, Ring, VerdictPill } from "@/components/ui";
import { ago } from "@/lib/app/format";
import { applyLeadQuery, describeQuery, isFiltered, parseLeadQuery, toSearch, type LeadView } from "@/lib/app/lead-query";
import { listLeads } from "@/lib/app/leads";
import { dayOf, followUpOf, followUpText, OUTCOME_BY_ID } from "@/lib/app/outcomes";
import { getSession } from "@/lib/app/runtime";

export const metadata = { title: "Leads" };

const TABS: [LeadView, string][] = [["worth", "Worth a call"], ["board", "Board"], ["follow", "Follow up"], ["all", "All researched"]];

export default async function Leads({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseLeadQuery(await searchParams);
  const s = (await getSession())!;
  const canRun = s.user.role === "operator" || s.user.role === "admin";
  const all = await listLeads(s.db, s.user.role !== "viewer");
  const now = Date.now();
  const today = dayOf(now);
  const rows = applyLeadQuery(all, query, now);
  // How many each tab would show with the current filters, so the tabs say what is behind them.
  const count = (v: LeadView) => applyLeadQuery(all, { ...query, view: v }, now).length;
  const filtered = isFiltered(query);

  return (
    <div className="stack" style={{ gap: 22 }}>
      <PageHead eyebrow="Work" title="Leads" sub="Every company that has been researched, best fit first, with who to speak to and a brief for the call.">
        {canRun ? <Link className="btn primary" href="/discover"><Icon name="search" />Discover more</Link> : null}
      </PageHead>

      <div className="row between">
        <nav className="segmented" aria-label="View">
          {TABS.map(([v, label]) => (
            <Link key={v} href={`/leads${toSearch({ ...query, view: v })}`} aria-current={query.view === v ? "true" : undefined}>{label} ({count(v)})</Link>
          ))}
        </nav>
      </div>

      <LeadFilters query={query} shown={rows.length} total={applyLeadQuery(all, { ...query, q: "", verdict: "any", outcome: "any", skipCompetitor: false }, now).length} />

      {rows.length === 0 ? (
        <div className="card">
          <Empty title={all.length === 0 ? "No companies researched yet" : filtered ? "No leads match" : query.view === "follow" ? "No follow-ups set" : "Nothing here yet"} icon="target">
            <p className="small" style={{ margin: 0, maxWidth: "52ch" }}>
              {all.length === 0 ? "Discover companies that look like Sprinto customers and research a few. They appear here with a brief for each."
                : filtered ? `Nothing matches ${describeQuery(query)}. Try clearing a filter.`
                : query.view === "follow" ? "When you record an outcome you can set a date to come back to a lead. Those with a date appear here, soonest first."
                : "Researched companies that score as a strong or possible fit appear here. See everything under All researched."}
            </p>
            {canRun && all.length === 0 ? <Link href="/discover" className="btn primary" style={{ marginTop: 10 }}><Icon name="search" />Discover companies</Link> : null}
          </Empty>
        </div>
      ) : query.view === "board" ? (
        <LeadBoard leads={rows} canMove={canRun} />
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
                  {l.usesCompetitor ? <Pill tone="warn" title="The rubric found a competitor's trust centre on their site.">Uses a competitor</Pill> : null}
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { ReportActions } from "@/components/report-actions";
import { Banner, LanePill, PageHead, Pill, Ring, SectionTitle } from "@/components/ui";
import { briefFor } from "@/lib/app/brief";
import { getSession } from "@/lib/app/runtime";
import { briefToText, type Cited } from "@/lib/brief/build";
import { dayOf, followUpOf, followUpText, OUTCOME_BY_ID, standings, type OutcomeRow } from "@/lib/app/outcomes";
import { dateTime } from "@/lib/app/format";
import { OutcomeForm } from "../../../leads/outcome-form";
import { VerifyButton } from "./verify-button";

export const metadata = { title: "Discovery brief" };

function Evidence({ c }: { c: Cited }) {
  return (
    <div className="ev">
      <div>{c.text}</div>
      {c.quote ? (
        <blockquote className="quote">
          “{c.quote}”
          {c.source ? <cite><a href={c.source} target="_blank" rel="noopener noreferrer nofollow">{c.source.replace(/^https?:\/\//, "")}</a></cite> : null}
        </blockquote>
      ) : <div className="small muted">Confirmed by checking the site, not by a quote.</div>}
    </div>
  );
}

export default async function Brief({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = (await getSession())!;
  const view = await briefFor(s.db, id, s.user.role !== "viewer");
  if (!view) notFound();
  const b = view.brief;
  const canRun = s.user.role === "operator" || s.user.role === "admin";
  const history = (await s.db.select("lead_outcomes", { prospect_id: id }, { order: "seq", ascending: false })) as unknown as OutcomeRow[];
  const now = standings(history).get(id) ?? null;
  const follow = followUpOf(now, dayOf(Date.now()));
  const tone = b.fit.verdict === "qualified" ? "good" : b.fit.verdict === "not_fit" ? "bad" : b.fit.verdict === "maybe" ? "warn" : "brand";

  return (
    <div className="stack brief" style={{ gap: 22 }}>
      <div className="print-only callsheet-head"><b>Call sheet: {b.company.name}</b> ({b.company.domain}) · printed {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
      <div className="crumbs"><Link href="/leads">Leads</Link> / {b.company.name}</div>
      <PageHead eyebrow="Discovery call brief" title={b.company.name} sub={<>Everything to know before the call, from what the company says about itself. <a href={`https://${b.company.domain}`} target="_blank" rel="noreferrer noopener">{b.company.domain}</a></>}>
        <LanePill lane={view.lane} />
        <Link className="btn" href={`/prospects/${view.prospectId}`}><Icon name="book" />Why the system decided this</Link>
        <ReportActions text={briefToText(b)} label="Copy the brief" printLabel="Print call sheet" />
      </PageHead>

      <section className="card hero why-hero" aria-label="Fit">
        <Ring value={b.fit.score ?? 0} max={100} label="of 100" tone={tone} size={104} />
        <div className="stack tight" style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: "1.35rem" }}>{b.fit.label}</h2>
          <p style={{ margin: 0 }}>{b.fit.summary}</p>
          {b.company.about ? <p className="small about" style={{ margin: 0 }}>They describe themselves: “{b.company.about}”</p> : null}
          <div className="row">
            {b.company.size ? <span className="chip" title={b.company.sizeFromHunter ? "Hunter Discover found this company under this size; the site does not state it." : undefined}>{b.company.size} people{b.company.sizeFromHunter ? " (per Hunter)" : ""}</span> : null}
            {b.company.certification ? <span className="chip">{b.company.certification}</span> : null}
            {b.company.product ? <span className="chip">{b.company.product}</span> : null}
          </div>
        </div>
      </section>

      {b.fit.usesCompetitor ? (
        <Banner tone="warn" title="They already seem to use a competitor">
          {b.fit.usesCompetitor.quote ? `Their site says: “${b.fit.usesCompetitor.quote}”. ` : ""}Find out in the first minutes what they use and what they wish it did, and expect a switching conversation, not a first-compliance one.
        </Banner>
      ) : null}

      <section className="card stack" aria-label="Ready for the call">
        <SectionTitle icon="check" title={b.ready.ok ? "Ready for a discovery call" : "Nearly ready"} sub="What the brief rests on. Anything missing is said plainly, never filled in." />
        <ul className="checks">
          {b.ready.checks.map((c) => <li key={c.label} className={c.ok ? "ok" : "no"}><span className="tick" aria-hidden>{c.ok ? "✓" : "✕"}</span><span><strong>{c.label}</strong> <span className="muted">{c.note}</span></span></li>)}
        </ul>
      </section>

      <div className="split">
        <div className="stack" style={{ gap: 22 }}>
          {b.whyNow.length ? (
            <section className="card stack" aria-label="Why now">
              <SectionTitle icon="clock" title="Why now" sub="Signals that this is a moment, not just a match." />
              {b.whyNow.map((w, i) => <Evidence key={i} c={w} />)}
            </section>
          ) : null}

          <section className="card stack" aria-label="Talking points">
            <SectionTitle icon="chat" title="Talking points" sub="The two problems this company is most likely feeling, each tied to something on their own site." />
            {b.talkingPoints.length === 0 ? <p className="muted">Pains were not chosen for this company yet.</p> : b.talkingPoints.map((t) => (
              <div key={t.id} className="tp stack tight">
                <div><span className="tag">{t.id}</span> <strong>{t.label}</strong></div>
                <p className="small" style={{ margin: 0 }}>{t.framing}</p>
                <p className="small muted" style={{ margin: 0 }}>{t.because}</p>
                {t.evidence.map((e, i) => <Evidence key={i} c={e} />)}
              </div>
            ))}
          </section>

          <section className="card stack" aria-label="Questions to ask">
            <SectionTitle icon="help" title="Questions to ask" sub="Open questions that let them describe the problem in their own numbers." />
            <ol className="qs">
              {b.questions.map((q, i) => <li key={i}>{q.text}{q.pain ? <span className="small muted"> · {q.pain}</span> : null}</li>)}
            </ol>
          </section>

          <section className="card stack" aria-label="If they say">
            <SectionTitle icon="shield" title="If they say…" sub="Likely pushback and how to respond. Guidance for you, not a script." />
            {b.objections.map((o) => (
              <div key={o.says} className="obj">
                <b>“{o.says}”</b>
                <p className="small" style={{ margin: "4px 0 0" }}>{o.response}</p>
              </div>
            ))}
          </section>
        </div>

        <aside className="stack" style={{ gap: 22 }}>
          <section className="card stack" aria-label="What happened">
            <SectionTitle icon="flag" title="What happened" sub="Record each step after the call, so the numbers on Impact are real." />
            {now ? (
              <div className="row" style={{ gap: 8 }}>
                <Pill tone={OUTCOME_BY_ID[now.status].tone}>{OUTCOME_BY_ID[now.status].label}</Pill>
                {follow ? <Pill tone={follow.state === "overdue" ? "bad" : follow.state === "today" ? "warn" : "info"}>{followUpText(follow)}</Pill> : null}
              </div>
            ) : <p className="small muted" style={{ margin: 0 }}>Nothing recorded yet.</p>}
            {history.length ? (
              <ol className="timeline">
                {history.map((h) => (
                  <li key={String(h.seq)}>
                    <div><strong>{OUTCOME_BY_ID[h.status as keyof typeof OUTCOME_BY_ID]?.label ?? h.status}</strong>{h.follow_up_on ? <span className="muted"> · follow up {standings([h]).get(id)?.followUpOn}</span> : null}</div>
                    <div className="meta">{dateTime(h.created_at as string)}</div>
                    {h.note ? <div className="small">{h.note}</div> : null}
                  </li>
                ))}
              </ol>
            ) : null}
            {canRun ? <OutcomeForm prospectId={id} current={now?.status ?? null} /> : null}
          </section>
          <section className="card stack" aria-label="Who to speak to">
            <SectionTitle icon="people" title="Who to speak to" />
            {b.contact ? (
              <>
                <div><b style={{ fontSize: "1.1rem" }}>{b.contact.name}</b><div className="muted">{b.contact.title ?? "Title not listed"}</div></div>
                {b.contact.email ? <div className="mono small">{b.contact.email}</div> : <p className="small muted">As a viewer you do not see the address.</p>}
                <p className="small" style={{ margin: 0 }}>{b.contact.trust}.</p>
                <p className="small muted" style={{ margin: 0 }}>{b.contact.why}</p>
                {b.contact.shouldVerify && canRun ? <VerifyButton prospectId={view.prospectId} /> : null}
              </>
            ) : <p className="muted">No suitable named person was found.</p>}
          </section>

          {b.group.length ? (
            <section className="card stack" aria-label="Also worth speaking to">
              <SectionTitle icon="people" title="Also worth speaking to" sub="Other people who matter here, and what to lead with for each. For the call: the product emails one person per company." />
              {b.group.map((m) => (
                <div key={m.name + (m.title ?? "")} className="member">
                  <div><b>{m.name}</b><div className="muted small">{m.title ?? "Title not listed"}{m.roleLabel ? ` · ${m.roleLabel}` : ""}</div></div>
                  {m.email ? <div className="mono small">{m.email}</div> : null}
                  <p className="small muted" style={{ margin: 0 }}>{m.trust}.</p>
                  {m.angle ? (
                    <div className="stack tight">
                      <div className="small"><span className="tag">{m.angle.id}</span> <b>{m.angle.label}</b></div>
                      <p className="small" style={{ margin: 0 }}>{m.angle.framing}</p>
                      {m.angle.evidence.slice(0, 1).map((e, i) => <div key={i} className="small muted">{e.text}{e.quote ? ` — “${e.quote}”` : ""}</div>)}
                    </div>
                  ) : null}
                  <p className="small muted" style={{ margin: 0 }}>{m.why}</p>
                </div>
              ))}
            </section>
          ) : null}

          <section className="card stack" aria-label="The email">
            <SectionTitle icon="mail" title="The outreach email" />
            {b.email ? (
              <>
                <div className="email"><div className="subject">Subject: {b.email.subject}</div>{b.email.body}</div>
                <p className="small muted" style={{ margin: 0 }}>Status: {b.email.status}. Test mode sends only to the test address.</p>
              </>
            ) : <p className="muted">No draft was written for this company.</p>}
          </section>

          <section className="card stack" aria-label="What you may say about Sprinto">
            <SectionTitle icon="shield" title="What you may say about Sprinto" sub="Only claims a person has checked against their source." />
            {b.mayState.length ? <ul className="small" style={{ margin: 0, paddingLeft: "1.1em", display: "grid", gap: 6 }}>{b.mayState.map((c) => <li key={c}>{c}</li>)}</ul> : <Banner tone="warn" title="Nothing verified yet">Verify claims in Settings before quoting Sprinto on a call.</Banner>}
          </section>

          {b.fit.gaps.length ? (
            <section className="card flat stack tight" aria-label="Not known">
              <SectionTitle icon="info" title="Not known" sub="Nothing here was guessed. Ask on the call." />
              <ul className="small" style={{ margin: 0, paddingLeft: "1.1em", display: "grid", gap: 4 }}>{b.fit.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

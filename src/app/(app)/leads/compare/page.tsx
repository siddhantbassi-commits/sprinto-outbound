import Link from "next/link";
import { CompareBars } from "@/components/charts";
import { Icon } from "@/components/icons";
import { Banner, Empty, PageHead, Pill, SectionTitle, VerdictPill } from "@/components/ui";
import { briefFor } from "@/lib/app/brief";
import { seesContacts } from "@/lib/app/privacy";
import { getSession } from "@/lib/app/runtime";
import { buildComparison, MAX_COMPARE, MIN_COMPARE, parseCompareIds, type CompareColumn } from "@/lib/brief/compare";
import type { FwId } from "@/lib/brief/intel";

export const metadata = { title: "Compare companies" };

const FW: [FwId, string][] = [["soc2", "SOC 2"], ["iso27001", "ISO 27001"], ["gdpr", "GDPR"], ["hipaa", "HIPAA"], ["pci", "PCI DSS"]];
const WORD: Record<string, string> = { held: "Held", in_progress: "In progress", likely: "Likely needed", not_indicated: "Not indicated" };

export default async function Compare({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const q = await searchParams;
  const s = (await getSession())!;
  const { ids, dropped } = parseCompareIds(q.id);
  const views = (await Promise.all(ids.map((id) => briefFor(s.db, id, seesContacts(s))))).flatMap((v, i) => (v ? [{ id: ids[i]!, lane: v.lane, brief: v.brief }] : []));

  if (views.length < MIN_COMPARE) {
    return (
      <div className="stack" style={{ gap: 22 }}>
        <PageHead eyebrow="Work" title="Compare companies" sub="Line two to four researched companies up side by side." />
        <div className="card">
          <Empty title="Choose at least two companies" icon="target">
            <p className="small" style={{ margin: 0, maxWidth: "54ch" }}>
              {ids.length > views.length ? "One of the companies in this link could not be found. " : ""}Tick two to four companies on the Leads page, then press Compare selected.
            </p>
            <Link href="/leads" className="btn primary" style={{ marginTop: 10 }}><Icon name="target" />Go to the leads</Link>
          </Empty>
        </div>
      </div>
    );
  }

  const cmp = buildComparison(views);
  const cols = cmp.columns;
  const mark = (c: CompareColumn, ids: string[]) => (ids.includes(c.id) && cols.length > 1 ? <Pill tone="good">Best</Pill> : null);

  return (
    <div className="stack" style={{ gap: 22 }}>
      <PageHead eyebrow="Work" title="Compare companies" sub={`${cols.length} researched companies, side by side. Everything here comes from each company's own brief.`}>
        <Link className="btn" href="/leads"><Icon name="arrow" />Back to the leads</Link>
      </PageHead>

      {dropped > 0 ? <Banner tone="info" title={`Showing the first ${MAX_COMPARE}`}>You chose {MAX_COMPARE + dropped} companies. A comparison holds up to {MAX_COMPARE}, so the rest are left out.</Banner> : null}

      <section className="card stack" aria-label="The short answer">
        <SectionTitle icon="chart" title="The short answer" sub="Who is the stronger fit, and where these companies actually differ." />
        <p style={{ margin: 0, fontSize: "1.05rem" }}><b>{cmp.verdictLine}</b></p>
        <CompareBars columns={cols.map((c) => ({ id: c.id, name: c.name, score: c.score, verdict: c.verdict }))} />
        {cmp.differences.length ? (
          <ul className="cmp-diff">{cmp.differences.map((d) => <li key={d}>{d}</li>)}</ul>
        ) : <p className="small muted" style={{ margin: 0 }}>These companies look alike on every measure compared here.</p>}
      </section>

      <section className="card stack" aria-label="Side by side">
        <SectionTitle icon="list" title="Side by side" sub="Scroll sideways on a small screen." />
        <div className="cmp-scroll">
          <table className="cmp">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Measure</span></th>
                {cols.map((c) => (
                  <th scope="col" key={c.id}>
                    <Link href={`/prospects/${c.id}/brief`}>{c.name}</Link>
                    <span className="mono small muted">{c.domain}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Fit score</th>
                {cols.map((c) => <td key={c.id}><b className="cmp-big">{c.score ?? "n/a"}</b> {mark(c, cmp.bestScore)}</td>)}
              </tr>
              <tr>
                <th scope="row">Verdict</th>
                {cols.map((c) => <td key={c.id}><VerdictPill verdict={c.verdict} /></td>)}
              </tr>
              <tr>
                <th scope="row">Short of a strong fit by</th>
                {cols.map((c) => <td key={c.id}>{c.verdict === "qualified" ? <span className="muted">Already strong</span> : c.shortBy !== null ? `${c.shortBy} points` : <span className="muted">n/a</span>}</td>)}
              </tr>
              <tr>
                <th scope="row">How well supported</th>
                {cols.map((c) => <td key={c.id}>{c.confidence}% {mark(c, cmp.bestEvidence)}</td>)}
              </tr>
              <tr>
                <th scope="row">Size</th>
                {cols.map((c) => <td key={c.id}>{c.size ? `${c.size} people` : <span className="muted">Not stated</span>}</td>)}
              </tr>
              <tr>
                <th scope="row">Where they stand</th>
                {cols.map((c) => <td key={c.id}>{c.stance}</td>)}
              </tr>
              {FW.map(([id, label]) => (
                <tr key={id}>
                  <th scope="row">{label}</th>
                  {cols.map((c) => {
                    const f = c.frameworks[id];
                    return (
                      <td key={c.id}>
                        <span className={`cmp-st s-${f.status}`}>{WORD[f.status]}</span>
                        {f.status !== "not_indicated" ? <span className="small muted"> {f.basis === "stated" ? "stated" : "our inference"}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <th scope="row">Who to speak to</th>
                {cols.map((c) => <td key={c.id}>{c.contact ? <><b>{c.contact.name}</b><span className="small muted"> {c.contact.title ?? ""}</span></> : <span className="muted">No named person yet</span>}</td>)}
              </tr>
              <tr>
                <th scope="row">Their likely problems</th>
                {cols.map((c) => <td key={c.id}>{c.pains.length ? <ul className="cmp-list">{c.pains.map((p) => <li key={p}>{p}</li>)}</ul> : <span className="muted">Not chosen yet</span>}</td>)}
              </tr>
              <tr>
                <th scope="row">Signals of timing</th>
                {cols.map((c) => <td key={c.id}>{c.signals ? `${c.signals} found` : <span className="muted">None found</span>}{c.usesCompetitor ? <> <Pill tone="warn">Uses a competitor</Pill></> : null}</td>)}
              </tr>
              <tr>
                <th scope="row">The email</th>
                {cols.map((c) => <td key={c.id}>{c.emailStatus ? c.emailStatus : <span className="muted">Not written</span>}</td>)}
              </tr>
              <tr>
                <th scope="row">Open</th>
                {cols.map((c) => (
                  <td key={c.id}>
                    <div className="stack tight">
                      <Link className="btn small primary" href={`/prospects/${c.id}/brief`}>Open brief<Icon name="arrow" /></Link>
                      <a className="btn small" href={`/prospects/${c.id}/brief/pdf`} download><Icon name="down" />One-pager (PDF)</a>
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

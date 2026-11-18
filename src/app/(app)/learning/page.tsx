import Link from "next/link";
import { CountUp } from "@/components/count-up";
import { Banner, Empty, PageHead, SectionTitle } from "@/components/ui";
import { learnFromOutcomes, MIN_REACHED, QUALIFIED_AT, rateText } from "@/lib/app/learning";
import { learningData } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";

export const metadata = { title: "What is working" };

export default async function Learning() {
  const s = (await getSession())!;
  const { prospects, outcomes } = await learningData(s.db);
  const l = learnFromOutcomes(prospects, outcomes);
  const f = l.funnel;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <PageHead eyebrow="Insight" title="What is working" sub="What the results say about the ICP, once enough leads have been reached. It shows the sample behind every figure, and it never tunes anything by itself." />

      <section className="stack tight" aria-label="The funnel">
        <SectionTitle icon="pulse" title="From reached to a meeting" sub="Counted by company, from the outcomes recorded on the Leads page." />
        <ol className="pursuit">
          <li className={f.reached ? "has" : ""}><span className="pstat"><b><CountUp to={f.reached} ms={400} /></b><span>Reached</span></span></li>
          <li className={f.replied ? "has" : ""}><span className="pstat"><b><CountUp to={f.replied} ms={400} /></b><span>Replied</span></span></li>
          <li className={f.meetings ? "has" : ""}><span className="pstat"><b><CountUp to={f.meetings} ms={400} /></b><span>Meetings booked</span></span></li>
        </ol>
      </section>

      {!l.ready ? (
        <div className="card">
          <Empty title={f.reached === 0 ? "No outcomes recorded yet" : `${l.needed} more ${l.needed === 1 ? "company" : "companies"} to reach before a pattern means anything`} icon="target">
            <p className="small" style={{ margin: 0, maxWidth: "58ch" }}>
              Patterns appear once {MIN_REACHED} companies have an outcome recorded ({f.reached} so far). With fewer, three replies out of five would look like a finding and would not be one. Record what happens after each call on the <Link href="/leads">Leads</Link> page.
            </p>
          </Empty>
        </div>
      ) : (
        <>
          {l.scoreSplit ? (
            <section className="card stack" aria-label="Does the score predict?">
              <SectionTitle icon="flag" title="Does a higher score do better?" sub={`Companies at ${QUALIFIED_AT} or above, against those below it.`} />
              <dl className="kv">
                <dt>{QUALIFIED_AT} or above</dt><dd>{rateText(l.scoreSplit.highPositive, l.scoreSplit.highN)} replied or booked a meeting</dd>
                <dt>Below {QUALIFIED_AT}</dt><dd>{rateText(l.scoreSplit.lowPositive, l.scoreSplit.lowN)}</dd>
              </dl>
              <p className="small" style={{ margin: 0 }}>{l.scoreSplit.gap > 10 ? "The score is pointing the right way: higher scores did better." : l.scoreSplit.gap < -10 ? "The score is pointing the wrong way on this sample: lower scores did better. Look at the signals below." : "No clear difference yet between higher and lower scores."}</p>
            </section>
          ) : null}

          <section className="stack" aria-label="Signals">
            <SectionTitle icon="target" title="Signals that went with a reply" sub="Only signals with at least three companies on each side, and a gap of 20 points or more." />
            {l.insights.length === 0 ? (
              <div className="card"><p className="small" style={{ margin: 0 }}>No signal stands out yet. Either nothing separates the companies that replied from those that did not, or the groups are still too small to say.</p></div>
            ) : (
              l.insights.map((i) => (
                <div key={i.id} className="card insight">
                  <b>{i.label}</b>
                  <p style={{ margin: "4px 0 0" }}>
                    {i.direction === "more" ? "Companies with this signal replied or booked a meeting more often" : "Companies with this signal replied or booked a meeting less often"}: <b>{rateText(i.withPositive, i.withN)}</b> with it, against <b>{rateText(i.withoutPositive, i.withoutN)}</b> without it.
                  </p>
                  {i.suggestion ? <p className="small muted" style={{ margin: "6px 0 0" }}>{i.suggestion} <Link href="/icp">Open ICP and replay</Link></p> : <p className="small muted" style={{ margin: "6px 0 0" }}>The sample is still small, so treat this as something to watch.</p>}
                </div>
              ))
            )}
          </section>
        </>
      )}

      <Banner tone="info" title="How far to trust this">
        These are patterns in a small number of hand-recorded outcomes, not proof. A signal can go with replies because of something else that travels with it, and outcomes are only as complete as people keep them. Use this to choose what to try on the ICP and replay page, which can test a change on the companies already read, and change a weight only when the pattern holds as more outcomes arrive.
      </Banner>
    </div>
  );
}

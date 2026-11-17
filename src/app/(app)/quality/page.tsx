import { Banner, Empty, PageHead, Pill } from "@/components/ui";
import { ago, dateTime } from "@/lib/app/format";
import { liveData } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";
import { uncovered } from "@/lib/quality/coverage";
import { GOLDEN } from "@/lib/quality/golden";
import { THRESHOLDS, type CaseResult } from "@/lib/quality/harness";
import { sampleNote, showDelta, showPrevious, showValue, STATUS_LABEL, STATUS_TONE } from "@/lib/quality/format";
import { computeLive, HEARTBEAT, RULES } from "@/lib/quality/live";
import { goldenRuns } from "@/lib/quality/record";
import { RunGolden } from "./run-button";

export const metadata = { title: "Quality" };

const STALE_DAYS = 8;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const GOLD_TONE = { pass: "good", warn: "warn", fail: "bad" } as const;
const GOLD_LABEL = { pass: "Passed", warn: "Warning", fail: "Failed" } as const;

export default async function Quality() {
  const s = (await getSession())!;
  const now = Date.now();
  const [data, runs] = await Promise.all([liveData(s.db, now), goldenRuns(s.db, 12)]);
  const live = computeLive(data);
  const canRun = s.user.role === "operator" || s.user.role === "admin";
  const latest = runs[0];
  // Only a run on the real model counts as a measurement. A scripted run proves the plumbing and nothing else.
  const lastLive = runs.find((r) => r.source === "live");
  const staleLive = !lastLive || now - new Date(lastLive.created_at).getTime() > STALE_DAYS * 86_400_000;
  const notCovered = uncovered(live, lastLive);
  const byId = new Map(GOLDEN.map((c) => [c.id, c]));

  const overallBanner =
    live.overall === "not_enough" ? (
      <Banner tone="info" title="Not enough work yet to judge quality">{live.judged} of {live.total} readings could be judged. The rest are below their minimum sample, and are marked rather than shown as fine. Process more companies, or use the golden set, which does not depend on volume.</Banner>
    ) : live.overall === "bad" ? (
      <Banner tone="bad" title="At least one reading needs action">See the rows marked Act. {live.total - live.judged > 0 ? `${live.total - live.judged} more could not be judged yet.` : ""}</Banner>
    ) : live.overall === "watch" ? (
      <Banner tone="warn" title="Something is drifting">See the rows marked Watch. {live.total - live.judged > 0 ? `${live.total - live.judged} more could not be judged yet.` : ""}</Banner>
    ) : (
      <Banner tone="good" title="No reading is outside its limits">{live.judged} of {live.total} readings were judged and are within their limits. {live.total - live.judged > 0 ? `${live.total - live.judged} are not judged yet because there is too little data.` : ""}</Banner>
    );

  return (
    <div className="stack">
      <PageHead title="Quality" sub="How the system is behaving on real work this week, and whether it still reads a set of companies whose answers we know.">
        {canRun ? <RunGolden scripted={s.mode === "demo"} /> : null}
      </PageHead>

      {overallBanner}
      {staleLive && s.mode !== "demo" ? <Banner tone="warn" title={lastLive ? `The golden set has not run on the real model for ${Math.floor((now - new Date(lastLive.created_at).getTime()) / 86_400_000)} days` : "The golden set has never been run on the real model"}>It should run weekly. {canRun ? "Run it now with the button above." : "Ask an operator to run it."}</Banner> : null}
      {notCovered.length ? <Banner tone="warn" title="The model or prompt in use has not been through the golden set">{notCovered.join(", ")} {notCovered.length === 1 ? "is" : "are"} in use now but were not in the last real golden run. Run it before trusting this week&rsquo;s numbers.</Banner> : null}

      <section className="stack">
        <div>
          <h2>This week, against last week</h2>
          <p className="sub">Each reading needs a minimum number of cases before it is judged. Below that it says so, because a few companies cannot tell you a rate.</p>
        </div>
        <div className="tablewrap"><table>
          <thead><tr><th>Reading</th><th className="num">This week</th><th className="num">Last week</th><th>Change</th><th>Status</th></tr></thead>
          <tbody>
            {live.readings.map((r) => (
              <tr key={r.key} style={r.status === "not_enough" ? { opacity: 0.8 } : undefined}>
                <td>
                  <strong>{r.label}</strong>
                  <div className="small muted">{r.help}</div>
                  <div className="small muted">{sampleNote(r)}</div>
                </td>
                <td className="num" style={r.status === "not_enough" ? { color: "var(--muted)", fontStyle: "italic" } : undefined}>{showValue(r)}</td>
                <td className="num">{showPrevious(r)}</td>
                <td className="small">{showDelta(r)}</td>
                <td><Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2>The golden set</h2>
            <p className="sub" style={{ margin: 0 }}>{GOLDEN.length} invented companies with known answers, including traps: a number that is not the headcount, &ldquo;not yet certified&rdquo;, a competitor&rsquo;s badge, a page that tells the model what to say. The model reads them, the quotes are checked, and the result is compared with the truth.</p>
          </div>
          {latest ? latest.source === "scripted" ? <Pill tone="muted" title="Read by the stand-in model, so this is not a measurement">Stand-in, not a measurement</Pill> : <Pill tone={GOLD_TONE[latest.status]}>{GOLD_LABEL[latest.status]}</Pill> : null}
        </div>

        {!latest ? (
          <Empty title="The golden set has not been run">{canRun ? "Press the button above to run it." : "An operator can run it."}</Empty>
        ) : (
          <>
            {latest.source === "scripted" ? <Banner tone="warn" title="This run used the built-in stand-in model, not a real one">The stand-in answers from the known truth, so it always scores perfectly. It proves the harness works and says nothing about how well the real model reads. Real runs are marked &ldquo;Real model&rdquo; below.</Banner> : null}
            <p className="small muted">Run {ago(latest.created_at, now)} ({dateTime(latest.created_at)}) · {latest.trigger === "weekly" ? "the weekly job" : "by a person"} · {latest.source === "live" ? "real model" : "stand-in model"}: {latest.models.join(", ") || "none"} · prompt {latest.prompt_version}</p>
            <div className="grid">
              <div className="card stat"><b>{pct(latest.accuracy)}</b><span>Facts read correctly</span><span className="small">Warn below {pct(THRESHOLDS.accuracy.warn)}, fail below {pct(THRESHOLDS.accuracy.fail)}</span></div>
              <div className="card stat"><b>{pct(latest.wrong_rate)}</b><span>Facts read wrongly</span><span className="small">The worst kind. Warn above {pct(THRESHOLDS.wrongRate.warn)}, fail above {pct(THRESHOLDS.wrongRate.fail)}</span></div>
              <div className="card stat"><b>{pct(latest.verdict_agreement)}</b><span>Verdicts that matched</span><span className="small">Warn below {pct(THRESHOLDS.verdictAgreement.warn)}, fail below {pct(THRESHOLDS.verdictAgreement.fail)}</span></div>
              <div className="card stat"><b>{latest.spurious}</b><span>Facts nobody stated</span><span className="small">Asserted with no page saying so</span></div>
            </div>
            {latest.reasons.length ? <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>{latest.reasons.map((x) => <li key={x}>{x}</li>)}</ul> : null}

            <div className="tablewrap"><table>
              <thead><tr><th>Case</th><th className="num">Correct</th><th>Verdict</th><th>What went wrong</th></tr></thead>
              <tbody>
                {(latest.detail as CaseResult[]).map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.id}</strong><div className="small muted">{byId.get(c.id)?.tests ?? c.tests}</div></td>
                    <td className="num">{c.correct} of {c.asserted}</td>
                    <td><Pill tone={c.verdict.match ? "good" : "bad"}>{c.verdict.match ? "Matched" : "Differed"}</Pill> <span className="small muted">expected {c.verdict.expected.replace("_", " ")}{c.verdict.match ? "" : `, got ${c.verdict.got?.replace("_", " ") ?? "nothing"}`}</span></td>
                    <td className="small">
                      {c.error ? <span style={{ color: "var(--bad)" }}>Could not be read: {c.error}</span> : null}
                      {c.mismatches.length === 0 && !c.error ? <span className="muted">Nothing</span> : c.mismatches.map((m) => <div key={m.key}><span className="tag">{m.key}</span> {m.outcome}: expected {String(m.expected ?? "unknown")}, got {String(m.got ?? "unknown")}</div>)}
                      {c.injection.expected ? <div>{c.injection.flagged ? "The hidden instruction was flagged." : <span style={{ color: "var(--bad)" }}>The hidden instruction was not flagged.</span>}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </>
        )}
      </section>

      {runs.length > 1 ? (
        <section className="stack">
          <h2>History</h2>
          <div className="tablewrap"><table>
            <thead><tr><th>When</th><th>Read by</th><th>Model and prompt</th><th className="num">Correct</th><th className="num">Wrong</th><th className="num">Verdicts</th><th>Result</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{dateTime(r.created_at)}<div className="small muted">{r.trigger === "weekly" ? "weekly job" : "by a person"}</div></td>
                  <td>{r.source === "live" ? <Pill tone="info">Real model</Pill> : <Pill tone="muted">Stand-in</Pill>}</td>
                  <td className="small">{r.models.join(", ") || "-"}<div className="muted">{r.prompt_version}</div></td>
                  <td className="num">{pct(r.accuracy)}</td>
                  <td className="num">{pct(r.wrong_rate)}</td>
                  <td className="num">{pct(r.verdict_agreement)}</td>
                  <td>{r.source === "scripted" ? <Pill tone="muted" title="Read by the stand-in model, so this is not a measurement">Not a measurement</Pill> : <Pill tone={GOLD_TONE[r.status]}>{GOLD_LABEL[r.status]}</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      ) : null}

      <section className="card stack">
        <h2>How this is judged, and what it cannot tell you</h2>
        <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
          <li>The windows are the last {live.days} days against the {live.days} days before, by when the company was added.</li>
          <li>Starting limits: quotes not on the page watch at {pct(RULES.groundingFailure.watch)}, act at {pct(RULES.groundingFailure.bad)}; sites unreadable {pct(RULES.scrapeFailure.watch)} and {pct(RULES.scrapeFailure.bad)}; person found below {pct(RULES.contactHit.watch)} and {pct(RULES.contactHit.bad)}; drafts passing first time below {pct(RULES.firstPassLint.watch)} and {pct(RULES.firstPassLint.bad)}; retries {pct(RULES.retryRate.watch)} and {pct(RULES.retryRate.bad)}. The worker is watched after {HEARTBEAT.watchMinutes} minutes, and acted on after {HEARTBEAT.badMinutes}, only while work is waiting. These are starting points, to be tuned against real weeks.</li>
          <li>The golden companies are invented. They measure whether the model still reads pages the way we expect, so they catch a model or prompt that got worse. They do not measure how well the system does on the real market, and a perfect score is not proof of that.</li>
          <li>The golden set also runs in the test suite and on a schedule. In the test suite it runs against a stand-in model, to prove a degraded model would be caught; only a run with a real model counts as a measurement.</li>
          <li>Reply rate and booked meetings are not measured: in test mode no real person is emailed.</li>
        </ul>
      </section>
    </div>
  );
}

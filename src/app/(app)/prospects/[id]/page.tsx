import Link from "next/link";
import { notFound } from "next/navigation";
import { ProspectActions } from "./controls";
import { Banner, LanePill, PageHead, Pill, VerdictPill } from "@/components/ui";
import { ACTIONS, dateTime, STEP_ORDER, STEPS, tokens, type Tone } from "@/lib/app/format";
import { getProspect } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";

export const metadata = { title: "Why" };

interface Part { id: string; group: string; label: string; points: number; max: number; quotes: string[] }
interface Gate { id: string; label: string; status: "pass" | "fail" | "unknown"; detail: string }
interface Check { id: string; pass: boolean; message: string }
interface Pick { id: string; label: string; plain: string; reason: string; evidence: { id: string; text: string; quotes: string[]; kind: string }[] }
interface Rank { label: string; points: number }

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function Quote({ text, source }: { text: string; source?: string | null }) {
  return (
    <blockquote className="quote">
      “{text}”
      {source ? <cite><a href={source} target="_blank" rel="noopener noreferrer nofollow">{source.replace(/^https?:\/\//, "")}</a></cite> : null}
    </blockquote>
  );
}

export default async function Why({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = (await getSession())!;
  const full = s.user.role !== "viewer";
  const d = await getProspect(s.db, id, full);
  if (!d) notFound();
  const { prospect: p, events, pages, facts, score, contacts, emails, decisions } = d;
  const canAct = s.user.role === "operator" || s.user.role === "admin";

  const lastFacts = facts.at(-1)?.facts as Record<string, { value: unknown; confidence: string; quotes: string[] }> | undefined;
  const pageFor = (quote: string) => pages.find((pg) => String(pg.text).toLowerCase().replace(/\s+/g, " ").includes(quote.toLowerCase().replace(/\s+/g, " ")))?.url as string | undefined;
  const parts = asArray<Part>(score?.parts);
  const gates = asArray<Gate>(score?.gates);
  const qualify = events.find((e) => e.step === "qualify");
  const painsEvent = [...events].reverse().find((e) => e.step === "pains" && e.status === "ok");
  const picks = asArray<Pick>(painsEvent?.output.picks);
  const email = emails.filter((e) => e.status !== "held").at(-1) ?? emails.at(-1);
  const checks = asArray<Check>(email?.lint);
  const hook = email?.hook as { id: string; quote: string; source: string | null } | null | undefined;
  const chosen = contacts.find((c) => c.chosen);
  const at = STEP_ORDER.indexOf(p.step);
  const stopped = p.lane !== "active" && p.lane !== "sent";
  const injection = asArray<{ url: string; rules: string[] }>(qualify?.output.injection);
  const groundingFails = asArray<string>(qualify?.output.grounding_failures);
  const trace = asArray<{ round: number; tool: string; outcome: string; newPages: number }>(qualify?.output.trace);

  return (
    <div className="stack">
      <div className="crumbs"><Link href="/">Runs</Link> / <Link href={`/runs/${p.run_id}`}>Run</Link> / {p.domain}</div>
      <PageHead title={p.domain} sub="Why the system did what it did, with the evidence for each decision.">
        <LanePill lane={p.lane} />
        <VerdictPill verdict={p.verdict} />
      </PageHead>

      {p.lane_reason ? <Banner tone={(["unknown", "failed"].includes(p.lane) ? "bad" : p.lane === "sent" ? "good" : "warn") as Tone} title={p.lane === "sent" ? "Sent to the test inbox" : "Where and why it stopped"}>{p.lane_reason}</Banner> : null}
      {p.lane === "sent" ? <Banner tone="good" title="Sent to the test inbox">This email went to the test address only. The contact named below was not mailed.</Banner> : null}
      {injection.length ? <Banner tone="warn" title="A page tried to give the model instructions">It was treated only as text to read, and the result still had to pass the quote check. {injection.map((i) => `${i.url} (${i.rules.join(", ")})`).join("; ")}</Banner> : null}

      <ol className="stepper" aria-label="Progress">
        {STEP_ORDER.map((st, i) => {
          const cls = i < at || p.lane === "sent" ? "done" : i === at ? (stopped ? "stop" : "now") : "";
          return <li key={st} className={cls}>{cls === "done" ? "✓" : i + 1}. {STEPS[st]}</li>;
        })}
      </ol>

      {canAct && p.lane !== "active" ? <ProspectActions id={p.id} lane={p.lane} domain={p.domain} /> : null}

      {/* ---------------- 1. the company ---------------- */}
      <section className="card stack">
        <div>
          <h2>1. Why this company{score ? `: ${score.score}/100` : ""}</h2>
          <p className="sub">A fixed rubric scored from facts the model quoted from the site. The model reads; code adds up the points.</p>
        </div>
        {score ? (
          <>
            <ul className="checks" aria-label="Gates">
              {gates.map((g) => (
                <li key={g.id} className={g.status === "pass" ? "ok" : "no"}>
                  <span className="tick" aria-hidden>{g.status === "pass" ? "✓" : g.status === "fail" ? "✕" : "?"}</span>
                  <span><strong>{g.label}</strong> <span className="muted">{g.detail}</span></span>
                </li>
              ))}
            </ul>
            <div className="parts">
              {parts.filter((x) => x.points !== 0 || x.max !== 0).map((x) => (
                <div key={x.id} className={`part ${x.points < 0 ? "neg" : ""}`}>
                  <span>{x.label}</span>
                  <b>{x.points}{x.max ? <span className="muted"> / {Math.abs(x.max)}</span> : null}</b>
                  <div className="bar"><i style={{ width: `${Math.min(100, (Math.abs(x.points) / (Math.abs(x.max) || 1)) * 100)}%` }} /></div>
                  {x.quotes.slice(0, 2).map((q, i) => <Quote key={i} text={q} source={pageFor(q)} />)}
                </div>
              ))}
            </div>
            {asArray<string>(score.missing).length ? <p className="small muted">Still unknown: {asArray<string>(score.missing).join(", ")}. Nothing was guessed.</p> : null}
            <p className="small muted">Verdict: <strong>{String(score.verdict).replace("_", " ")}</strong>. {String(score.reason)}</p>
          </>
        ) : <p className="muted">It was not scored{p.lane === "skipped" ? ": it was skipped before reading." : " yet."}</p>}

        {trace.length ? (
          <details>
            <summary>The extra pages the model asked for ({trace.length})</summary>
            <div className="tablewrap"><table><thead><tr><th>Round</th><th>Tool</th><th>What happened</th></tr></thead><tbody>
              {trace.map((t, i) => <tr key={i}><td>{t.round}</td><td className="mono">{t.tool}</td><td>{t.outcome}{t.newPages ? ` (+${t.newPages} page)` : ""}</td></tr>)}
            </tbody></table></div>
            <p className="small muted">The model may only choose between five tools that our code runs and checks.</p>
          </details>
        ) : null}

        <details>
          <summary>Evidence the model quoted (checked against the page text){groundingFails.length ? `, ${groundingFails.length} did not check out and were set to unknown` : ""}</summary>
          {lastFacts ? Object.entries(lastFacts).filter(([, f]) => f.value !== null).map(([k, f]) => (
            <div key={k} className="stack" style={{ marginBottom: 10 }}>
              <div><span className="tag">{k}</span> = <strong>{String(f.value)}</strong> <Pill tone={f.confidence === "high" ? "good" : "muted"}>{f.confidence}</Pill>{f.quotes.length === 0 ? <span className="small muted"> · confirmed by checking the pages (no quote can prove an absence)</span> : null}</div>
              {f.quotes.map((q, i) => <Quote key={i} text={q} source={pageFor(q)} />)}
            </div>
          )) : <p className="muted">No facts were extracted.</p>}
        </details>
        <details>
          <summary>The {pages.length} pages that were read</summary>
          <div className="tablewrap"><table><thead><tr><th>Page</th><th>Kind</th><th className="num">Status</th><th className="num">Size</th><th>Fingerprint</th></tr></thead><tbody>
            {pages.map((pg) => <tr key={String(pg.id)}><td><a href={String(pg.url)} target="_blank" rel="noopener noreferrer nofollow">{String(pg.url).replace(/^https?:\/\//, "")}</a>{pg.thin ? <> <Pill tone="warn">thin</Pill></> : null}</td><td>{String(pg.kind)}</td><td className="num">{String(pg.status)}</td><td className="num">{tokens(Number(pg.bytes))}B</td><td className="mono small">{String(pg.sha256).slice(0, 10)}</td></tr>)}
          </tbody></table></div>
        </details>
      </section>

      {/* ---------------- 2. the person ---------------- */}
      <section className="card stack">
        <div>
          <h2>2. Why this person</h2>
          <p className="sub">Candidates come from Hunter or a hand-picked list and are ranked by code: the title for this company&rsquo;s size, seniority, how sure the address is. The model is not involved.</p>
        </div>
        {contacts.length === 0 ? <p className="muted">{p.lane === "no_contact" ? "No suitable contact was found." : "No contact has been looked up yet."}</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Candidate</th><th>Title</th><th className="num">Rank</th><th>How it was scored</th></tr></thead>
            <tbody>
              {[...contacts].sort((a, b) => Number(b.chosen) - Number(a.chosen) || Number(b.rank_score ?? 0) - Number(a.rank_score ?? 0)).map((c, i) => {
                const parts = asArray<Rank>(c.rank_parts);
                const who = full ? [c.first_name, c.last_name].filter(Boolean).join(" ") || String(c.email ?? "(shared mailbox)") : String(c.first_initial ?? "(hidden)");
                return (
                  <tr key={String(c.id ?? i)}>
                    <td><strong>{who}</strong> {c.chosen ? <Pill tone="good">chosen</Pill> : c.excluded ? <Pill tone="muted">excluded</Pill> : null}<div className="small muted">{full ? String(c.email ?? "") : String(c.email_masked ?? "")} · {String(c.source)}</div></td>
                    <td>{String(c.position ?? "") || <span className="muted">none listed</span>}</td>
                    <td className="num">{c.excluded ? "-" : String(c.rank_score ?? "-")}</td>
                    <td className="small">{c.excluded ? String(c.excluded) : parts.map((x) => `${x.label}: ${x.points}`).join(" · ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        {!full ? <p className="small muted">As a viewer you see initials and masked addresses.</p> : null}
        {chosen && !chosen.first_name && full ? <p className="small muted">This person&rsquo;s name and address were removed by the 90-day retention rule.</p> : null}
      </section>

      {/* ---------------- 3. the pains ---------------- */}
      <section className="card stack">
        <div>
          <h2>3. Why these two pains</h2>
          <p className="sub">Nine fixed pains. Code scores them for this person&rsquo;s role and this company&rsquo;s facts and keeps four; the model picks two of the four and must cite real evidence.</p>
        </div>
        {picks.length === 0 ? <p className="muted">Not chosen yet.</p> : (
          <>
            {String(painsEvent?.output.source) === "code_fallback" ? <Banner tone="info" title="Code fallback">{String(painsEvent?.output.fallback_reason ?? "The model's answer was not used; the two highest-scoring pains were.")}</Banner> : null}
            {picks.map((k) => (
              <div key={k.id} className="stack">
                <div><span className="tag">{k.id}</span> <strong>{k.label}</strong></div>
                <div className="small">{k.reason}</div>
                {k.evidence.map((e) => (
                  <div key={e.id}>
                    <div className="small muted">{e.text}</div>
                    {e.quotes.slice(0, 1).map((q, i) => <Quote key={i} text={q} source={pageFor(q)} />)}
                  </div>
                ))}
              </div>
            ))}
            <details>
              <summary>The shortlist of four</summary>
              <div className="tablewrap"><table><thead><tr><th>Pain</th><th className="num">Evidence</th><th className="num">Role fit</th><th className="num">Score</th></tr></thead><tbody>
                {asArray<{ id: string; score: number; signal_points: number; persona_points: number }>(painsEvent?.output.shortlist).map((x) => <tr key={x.id}><td><span className="tag">{x.id}</span></td><td className="num">{x.signal_points}</td><td className="num">{x.persona_points}</td><td className="num">{x.score}</td></tr>)}
              </tbody></table></div>
            </details>
          </>
        )}
      </section>

      {/* ---------------- 4. the email ---------------- */}
      <section className="card stack">
        <div>
          <h2>4. Why this email</h2>
          <p className="sub">The model writes the middle; code adds the greeting, the sign-off and the opt-out line, and twelve checks decide whether it may go.</p>
        </div>
        {!email ? <p className="muted">No draft yet.</p> : (
          <>
            <div className="email"><div className="subject">Subject: {String(email.subject)}</div>{String(email.body)}</div>
            <div className="row small muted">
              <Pill tone={email.status === "sent" ? "good" : email.status === "held" ? "warn" : email.status === "unknown" || email.status === "failed" ? "bad" : "info"}>{String(email.status)}</Pill>
              <span>draft {String(email.attempt)}</span>
              {email.gmail_message_id ? <span>Gmail message <span className="mono">{String(email.gmail_message_id)}</span></span> : null}
              {email.sending_at ? <span>Search Sent for <span className="mono">X-Outbound-Run: {String(email.id)}</span></span> : null}
            </div>
            {hook ? <div><div className="small muted">The hook it opens with, from the company&rsquo;s own page:</div><Quote text={hook.quote} source={hook.source} /></div> : null}
            <ul className="checks" aria-label="Lint checks">
              {checks.map((c) => <li key={c.id} className={c.pass ? "ok" : "no"}><span className="tick" aria-hidden>{c.pass ? "✓" : "✕"}</span><span><span className="tag">{c.id}</span> {c.message}</span></li>)}
            </ul>
            {emails.length > 1 ? <p className="small muted">{emails.length} drafts were written for this prospect.</p> : null}
          </>
        )}
      </section>

      {/* ---------------- the trace ---------------- */}
      <section className="card stack">
        <div>
          <h2>Everything that happened</h2>
          <p className="sub">The append-only trace. It cannot be edited or deleted by anyone, and every row is stamped by the database.</p>
        </div>
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id} className={e.status}>
              <div><strong>{ACTIONS[e.step] ?? e.step}</strong> <span className="muted">· {e.status}</span></div>
              <div className="meta">{dateTime(e.created_at)}{e.model ? ` · ${e.model}` : ""}{e.prompt_version ? ` · ${e.prompt_version}` : ""}{e.tokens ? ` · ${tokens(e.tokens)} tokens` : ""}{e.latency_ms ? ` · ${(e.latency_ms / 1000).toFixed(1)}s` : ""}</div>
              {e.error ? <div className="small" style={{ color: "var(--bad)" }}>{e.error}</div> : null}
              {typeof e.output.reason === "string" ? <div className="small">{e.output.reason}</div> : null}
            </li>
          ))}
        </ol>
        {decisions.length ? (
          <>
            <h3>Decisions by people</h3>
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {decisions.map((x) => <li key={String(x.id)} className="small"><span className="tag">{String(x.kind).replace(/_/g, " ")}</span> {String(x.reason)} <span className="muted">· {dateTime(x.created_at as string)}</span></li>)}
            </ul>
          </>
        ) : null}
      </section>
    </div>
  );
}

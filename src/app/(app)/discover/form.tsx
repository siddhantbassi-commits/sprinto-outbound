"use client";
import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { searchCompanies, type SearchResult } from "./actions";
import { saveDigestSearch, type DigestResult } from "../digest/actions";
import { toast } from "@/components/toast";
import { startRun, type StartResult } from "../runs/new/actions";
import { CountUp } from "@/components/count-up";
import { Icon } from "@/components/icons";
import { Banner, SectionTitle } from "@/components/ui";
import { ANGLES, canResearch, estimateCost, MAX_WANT, REGIONS, SIZES, STANDING_NOTE, type AngleId, type Criteria, type RegionId, type SizeId } from "@/lib/discovery/criteria";

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

const SEARCHING = [
  "Asking Hunter who is hiring for security and compliance",
  "Asking Hunter for B2B software companies of your size",
  "Asking Hunter for companies in regulated markets",
  "Merging the three lists and ranking by how many agree",
  "Opening each home page to check it is a software company",
];

function Searching() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(n + 1, SEARCHING.length - 1)), 3200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="card searching" role="status" aria-live="polite">
      <div className="search-orb" aria-hidden><i /><i /><i /></div>
      <div className="stack tight">
        <b>Looking for companies</b>
        <p className="small muted" key={i} style={{ animation: "rise 0.35s both" }}>{SEARCHING[i]}…</p>
        <div className="bar-track t-brand indet" aria-hidden><i /></div>
        <p className="small muted">This is free and takes about half a minute. No Hunter credits and no AI are used to find companies.</p>
      </div>
    </div>
  );
}

export function DiscoverForm({ initial, facts }: { initial: Criteria; facts: { approval: boolean; testTo: string | null } }) {
  const [crit, setCrit] = useState<Criteria>(initial);
  const [found, searchAction, searching] = useActionState<SearchResult | null, FormData>(searchCompanies, null);
  const [start, startAction, starting] = useActionState<StartResult | null, FormData>(startRun, null);
  const [saved, saveAction, saving] = useActionState<DigestResult | null, FormData>(saveDigestSearch, null);
  useEffect(() => { if (saved) toast(saved.message, saved.ok); }, [saved]);
  const [picked, setPicked] = useState<string[]>([]);
  const [seen, setSeen] = useState<SearchResult | null>(null);

  // Preselect the best companies when new results arrive, once per result, and never override what the person then chose.
  useEffect(() => {
    if (found?.ok && found.outcome && found !== seen) {
      setSeen(found);
      const want = found.criteria?.want ?? crit.want;
      setPicked(found.outcome.found.filter((f) => f.standing === "new").slice(0, Math.min(want, found.maxRun ?? want)).map((f) => f.domain));
    }
  }, [found, seen, crit.want]);

  const out = found?.ok ? found.outcome : undefined;
  const fresh = out ? out.found.filter((f) => f.standing === "new") : [];
  const cost = useMemo(() => estimateCost(picked.length), [picked.length]);
  const maxRun = found?.maxRun ?? null;
  const over = maxRun !== null && picked.length > maxRun;
  const credits = found?.hunter ?? null;
  const spendable = credits ? Math.max(0, credits.remaining - credits.reserve) : null;
  const short = spendable !== null && picked.length > spendable;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <ol className="stepper" aria-label="Progress">
        <li className={out ? "done" : "now"}>Describe</li>
        <li className={picked.length && out ? "now" : out ? "done" : ""}>Choose</li>
        <li className={starting ? "now" : ""}>Research</li>
      </ol>

      <div className="split">
        <form action={searchAction} className="card stack" data-tour="criteria">
          <input type="hidden" name="criteria" value={JSON.stringify(crit)} />
          <SectionTitle icon="target" title="What a good customer looks like" sub="Pre-filled from your signed-off ICP. Change anything; the search follows." />

          <fieldset className="crit">
            <legend>Where they are based</legend>
            <div className="optrow">
              {REGIONS.map((r) => (
                <button key={r.id} type="button" className="opt" aria-pressed={crit.regions.includes(r.id as RegionId)} onClick={() => setCrit((c) => ({ ...c, regions: c.regions.length === 1 && c.regions.includes(r.id) ? c.regions : toggle(c.regions, r.id as RegionId) }))}>
                  {r.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="crit">
            <legend>How many people work there</legend>
            <div className="optrow">
              {SIZES.map((z) => (
                <button key={z.id} type="button" className="opt" aria-pressed={crit.sizes.includes(z.id as SizeId)} onClick={() => setCrit((c) => ({ ...c, sizes: c.sizes.length === 1 && c.sizes.includes(z.id) ? c.sizes : toggle(c.sizes, z.id as SizeId) }))}>
                  {z.label}
                </button>
              ))}
            </div>
            <p className="hint">Your ICP scores 11 to 500 people highest. Larger companies usually already have a compliance team.</p>
          </fieldset>

          <fieldset className="crit">
            <legend>Why they might need Sprinto now</legend>
            <div className="anglelist">
              {ANGLES.map((a) => {
                const on = crit.angles.includes(a.id as AngleId);
                return (
                  <button key={a.id} type="button" className="angle" aria-pressed={on} onClick={() => setCrit((c) => ({ ...c, angles: c.angles.length === 1 && on ? c.angles : toggle(c.angles, a.id as AngleId) }))}>
                    <span className="tick" aria-hidden>{on ? <Icon name="check" /> : null}</span>
                    <span><b>{a.label}</b><small>{a.help}</small></span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="wantrow">
            <span>How many to research from this search: <b>{crit.want}</b></span>
            <input type="range" min={1} max={MAX_WANT} value={crit.want} onChange={(e) => setCrit((c) => ({ ...c, want: Number(e.target.value) }))} />
          </label>

          <div className="row">
            <button className="btn primary large" type="submit" disabled={searching}>{searching ? "Searching…" : out ? "Search again" : "Find companies"}<Icon name="search" /></button>
            <span className="formnote">Free. Uses no Hunter credits and no AI.</span>
          </div>
        </form>

        <aside className="card flat stack tight" aria-label="How discovery works">
          <SectionTitle icon="info" title="How this works" />
          <ol className="how">
            <li><b>Hunter finds leads.</b> Three searches (hiring, software, regulated markets) are merged. A company three of them agree on ranks highest.</li>
            <li><b>The site is checked.</b> Each home page is opened to confirm it is a software company. Hotels, charities and dead sites are dropped.</li>
            <li><b>You choose.</b> Nothing is researched or written until you press the button below the results.</li>
            <li><b>Then it is judged properly.</b> A match here is only a lead. Fit is decided after the company&apos;s own site is read and scored against your ICP, with a quote for every point.</li>
          </ol>
          <p className="small muted">Competitors and anyone on the do-not-contact list never appear.</p>
          <form action={saveAction} className="stack tight digestsave">
            <input type="hidden" name="criteria" value={JSON.stringify(crit)} />
            <b>Want this every week?</b>
            <p className="small muted" style={{ margin: 0 }}>Save these criteria and each Monday you will be emailed only the companies you have not seen before.</p>
            <div className="row">
              <button className="btn small" type="submit" disabled={saving}>{saving ? "Saving…" : "Save as the weekly digest"}</button>
              <Link className="small" href="/digest">See the digest</Link>
            </div>
          </form>
        </aside>
      </div>

      {searching ? <Searching /> : null}
      {found && !found.ok && !searching ? <Banner tone="bad" title="The search could not run">{found.message}</Banner> : null}

      {out && !searching ? (
        <section className="stack" style={{ gap: 14, animation: "rise 0.4s both" }} aria-label="Results">
          <div className="row between">
            <h2 style={{ margin: 0 }}>{fresh.length} {fresh.length === 1 ? "company" : "companies"} to consider</h2>
            <span className="small muted">Found in {Math.max(1, Math.round((found?.tookMs ?? 0) / 1000))}s from {out.considered} Hunter matches</span>
          </div>
          <div className="livebar">
            {ANGLES.filter((a) => a.id in out.byAngle).map((a) => (
              <span key={a.id} className={`chip ${out.byAngle[a.id] === null ? "warn" : ""}`}>{a.label}: {out.byAngle[a.id] === null ? "failed" : out.byAngle[a.id]}</span>
            ))}
            {out.hidden.notSoftware ? <span className="chip" title="Their home page does not read like a software company.">{out.hidden.notSoftware} not software, left out</span> : null}
            {out.hidden.unreachable ? <span className="chip" title="The site did not answer, or robots.txt asks to be left alone.">{out.hidden.unreachable} could not be opened, left out</span> : null}
          </div>
          {out.dropped.length ? (
            <details className="dropped">
              <summary>See who was left out, and why ({out.dropped.length})</summary>
              <p className="small muted" style={{ margin: "8px 0" }}>Left out after a look at each home page. If one of these should have stayed, paste it into <Link href="/runs/new">Paste a list</Link>.</p>
              <ul>{out.dropped.map((d) => <li key={d.domain}><b>{d.name}</b> <a className="mono small" href={`https://${d.domain}`} target="_blank" rel="noreferrer noopener">{d.domain}</a><span className="small muted"> · {d.why === "unreachable" ? "Could not be opened" : "Not software"}. {d.detail}</span></li>)}</ul>
            </details>
          ) : null}
          {out.problems.length ? <Banner tone="warn" title="Part of the search failed">{out.problems.join(" ")} The results below are from the searches that worked.</Banner> : null}

          {out.found.length === 0 ? (
            <div className="card"><b>Nothing matched.</b><p className="small muted">Try more sizes or regions, or switch on more reasons. You can also paste a list instead.</p></div>
          ) : (
            <>
              <div className="row">
                <button type="button" className="linkbtn" onClick={() => setPicked(fresh.slice(0, Math.min(MAX_WANT, maxRun ?? MAX_WANT)).map((f) => f.domain))}>Select the top {Math.min(fresh.length, MAX_WANT, maxRun ?? MAX_WANT)}</button>
                <button type="button" className="linkbtn" onClick={() => setPicked([])}>Clear</button>
              </div>
              <ul className="leads" data-tour="leads">
                {out.found.map((f, idx) => {
                  const can = canResearch(f.standing);
                  const on = picked.includes(f.domain);
                  return (
                    <li key={f.domain} className={`lead${on ? " on" : ""}${can ? "" : " off"}`} style={{ animationDelay: `${Math.min(idx, 12) * 35}ms` }}>
                      <label className="leadbox">
                        <input type="checkbox" checked={on} disabled={!can} onChange={() => setPicked((p) => toggle(p, f.domain))} aria-label={`Research ${f.name}`} />
                        <span className="tick" aria-hidden>{on ? <Icon name="check" /> : null}</span>
                      </label>
                      <div className="leadmain">
                        <div className="row" style={{ gap: 8 }}>
                          <b>{f.name}</b>
                          <a className="mono small" href={`https://${f.domain}`} target="_blank" rel="noreferrer noopener">{f.domain}<Icon name="external" /></a>
                          {f.standing !== "new" ? <span className="chip warn">{STANDING_NOTE[f.standing]}</span> : null}
                          {can && !f.verified ? <span className="chip" title={f.note ?? ""}>Site not checked</span> : null}
                        </div>
                        {f.about ? <p className="small about">&ldquo;{f.about}&rdquo;</p> : f.note ? <p className="small muted">{f.note}</p> : null}
                        <ul className="because">
                          {f.because.map((b) => <li key={b}>{b}</li>)}
                          {f.emailsTotal > 0 ? <li>Hunter holds {f.emailsTotal} {f.emailsTotal === 1 ? "address" : "addresses"} for them</li> : null}
                        </ul>
                      </div>
                      <div className="leadrank" title="How many of the three searches found it, with a bonus for hiring and for a checked site">
                        {can ? <><span className="meter" aria-hidden><i style={{ width: `${Math.min(100, (f.rank / 40) * 100)}%` }} /></span><span className="small muted">{f.angles.length} of {out.byAngle ? Object.keys(out.byAngle).length : 3} signals</span></> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <form action={startAction} className="dock card" data-tour="dock">
                <input type="hidden" name="domains" value={JSON.stringify(picked)} />
                <input type="hidden" name="source" value="discover" />
                <input type="hidden" name="hints" value={JSON.stringify(Object.fromEntries(out.found.filter((f) => picked.includes(f.domain) && f.band).map((f) => [f.domain, f.band])))} />
                <div className="dockinfo">
                  <b><CountUp to={picked.length} ms={300} /> selected</b>
                  <span className="small muted">
                    {picked.length === 0 ? "Choose at least one company." : `About ${(cost.tokens / 1000).toFixed(0)}k AI tokens and ${cost.minutes} ${cost.minutes === 1 ? "minute" : "minutes"}. You can leave the page; progress is saved.`}
                  </span>
                  {credits ? <span className="small muted">Up to {picked.length} of {credits.remaining} Hunter credits ({credits.reserve} kept in reserve).</span> : null}
                </div>
                <label className="dockname">
                  <span className="sr-only">Name this run</span>
                  <input type="text" name="note" maxLength={120} placeholder="Name this run (optional)" />
                </label>
                <button className="btn primary large" type="submit" disabled={starting || picked.length === 0 || over}>{starting ? "Starting…" : `Research ${picked.length || ""} ${picked.length === 1 ? "company" : "companies"}`}<Icon name="arrow" /></button>
                <div className="dockwarn">
                  {over ? <Banner tone="bad" title={`Over the run limit of ${maxRun}`}>Choose fewer, or an admin can raise the limit in Settings.</Banner> : null}
                  {short && !over ? <Banner tone="warn" title="Not enough Hunter credits for everyone">Only {spendable} can be looked up for a contact. The rest will wait in the review lane until credits renew or you add a contact by hand.</Banner> : null}
                  {start ? <Banner tone="bad" title="The run did not start">{start.message}</Banner> : null}
                </div>
                <p className="formnote dockfoot">{facts.approval ? "Each email waits for your approval." : "Approval is off."} {facts.testTo ? "Mail goes to the test address only." : null} <Link href="/runs/new">Paste a list instead</Link></p>
              </form>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

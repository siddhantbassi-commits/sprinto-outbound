import Link from "next/link";
import { DigestControls, DigestList } from "./controls";
import { Banner, Empty, PageHead, Pill, SectionTitle } from "@/components/ui";
import { dateTime, plural } from "@/lib/app/format";
import { loadKnown } from "@/lib/app/known";
import { currentSettings } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";
import { loadDigests, loadSearch, nextDue } from "@/lib/digest/run";
import { ANGLES, defaultCriteria, normaliseCriteria, REGIONS, SIZES } from "@/lib/discovery/criteria";
import { ICP_V1 } from "@/lib/icp/config";

export const metadata = { title: "Weekly digest" };
// Running it now asks Hunter three questions and opens up to two dozen home pages.
export const maxDuration = 60;

const EMAIL: Record<string, { label: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  sent: { label: "Emailed to you", tone: "good" },
  failed: { label: "Email failed", tone: "bad" },
  skipped: { label: "Email not sent", tone: "warn" },
  not_sent: { label: "No email", tone: "muted" },
};

export default async function Digest() {
  const s = (await getSession())!;
  const canRun = s.user.role === "operator" || s.user.role === "admin";
  const [search, digests, settings] = await Promise.all([loadSearch(s.db), loadDigests(s.db, 8), currentSettings(s.db)]);
  const known = await loadKnown(s.db, settings?.mail_cooldown_days ?? 30);
  const criteria = search ? normaliseCriteria(search.criteria, defaultCriteria(ICP_V1)) : null;
  const latest = digests[0] ?? null;
  const now = Date.now();
  const next = search?.enabled ? nextDue(latest, now) : null;
  const gone = [...new Set([...known.researched, ...known.suppressed, ...known.mailed])];

  return (
    <div className="stack" style={{ gap: 22 }}>
      <PageHead eyebrow="Work" title="Weekly digest" sub="Every Monday morning the saved search runs, and you are emailed the companies that fit and that you have not been shown before. Searching is free: it uses no Hunter credits and no AI, and no company is contacted." />

      <section className="card stack" aria-label="The weekly search">
        <SectionTitle icon="clock" title="The weekly search" />
        {!search || !criteria ? (
          <>
            <p style={{ margin: 0 }}>No search is saved yet. Set up a search on <Link href="/discover">Discover</Link> and press <b>Save as the weekly digest</b>.</p>
            {canRun ? <Link href="/discover" className="btn primary" style={{ alignSelf: "start" }}>Set up a search</Link> : null}
          </>
        ) : (
          <>
            <div className="row" style={{ gap: 8 }}>
              <Pill tone={search.enabled ? "good" : "muted"}>{search.enabled ? "On" : "Off"}</Pill>
              <span className="small muted">
                {search.enabled ? `Runs every Monday at 9:00 India time. ${next && next > now ? `The next scheduled run can happen from ${dateTime(new Date(next).toISOString())}.` : "The next scheduled run will pick it up."}` : "Switched off. Nothing runs on Mondays until it is switched on."}
              </span>
            </div>
            <ul className="because">
              {criteria.regions.map((r) => <li key={r}>{REGIONS.find((x) => x.id === r)?.label}</li>)}
              {criteria.sizes.map((z) => <li key={z}>{SIZES.find((x) => x.id === z)?.label} people</li>)}
              {criteria.angles.map((a) => <li key={a}>{ANGLES.find((x) => x.id === a)?.label}</li>)}
            </ul>
            <p className="small muted" style={{ margin: 0 }}>Saved {dateTime(search.created_at)}. To change it, adjust the criteria on <Link href="/discover">Discover</Link> and save again; each save is kept.</p>
            {canRun ? <DigestControls enabled={search.enabled} /> : <p className="small muted" style={{ margin: 0 }}>An operator can switch it on or off and run it.</p>}
          </>
        )}
      </section>

      {latest ? (
        <section className="stack" aria-label="The latest digest">
          <div className="row between">
            <h2 style={{ margin: 0 }}>{latest.found.length ? `${plural(latest.found.length, "new company", "new companies")}` : "Nothing new"}</h2>
            <span className="row" style={{ gap: 8 }}>
              <Pill tone={EMAIL[latest.email_status]?.tone ?? "muted"}>{EMAIL[latest.email_status]?.label ?? latest.email_status}</Pill>
              <span className="small muted">{dateTime(latest.created_at)} · {latest.trigger === "cron" ? "scheduled" : "run by hand"}</span>
            </span>
          </div>
          {latest.email_note ? <p className="small muted" style={{ margin: 0 }}>{latest.email_note}</p> : null}
          {latest.problems.length ? <Banner tone="warn" title="Part of the search failed">{latest.problems.join(" ")}</Banner> : null}
          {latest.found.length ? (
            canRun ? <DigestList companies={latest.found} researched={gone} maxRun={settings?.max_run_size ?? null} /> : (
              <ul className="leads">{latest.found.map((c) => (
                <li key={c.domain} className="lead"><span /><div className="leadmain"><div className="row"><b>{c.name}</b><span className="mono small">{c.domain}</span></div>{c.about ? <p className="small about">&ldquo;{c.about}&rdquo;</p> : null}<ul className="because">{c.because.map((b) => <li key={b}>{b}</li>)}</ul></div><div /></li>
              ))}</ul>
            )
          ) : (
            <div className="card"><Empty title="Nothing new since the last digest" icon="check"><p className="small" style={{ margin: 0, maxWidth: "52ch" }}>Every company the search found has already been researched, suppressed, mailed or shown to you. Hunter&rsquo;s hiring signals change week to week, so next week may differ.</p></Empty></div>
          )}
        </section>
      ) : search ? (
        <div className="card"><Empty title="No digest has run yet" icon="clock"><p className="small" style={{ margin: 0, maxWidth: "52ch" }}>{canRun ? "Press Run it now to see what it finds, or wait for Monday." : "The first one runs on Monday."}</p></Empty></div>
      ) : null}

      {digests.length > 1 ? (
        <section className="stack tight" aria-label="Earlier digests">
          <SectionTitle icon="list" title="Earlier digests" />
          {digests.slice(1).map((d) => (
            <details key={d.id} className="card">
              <summary><b>{dateTime(d.created_at)}</b> <span className="muted small">· {plural(d.found.length, "company", "companies")} · {EMAIL[d.email_status]?.label ?? d.email_status}</span></summary>
              {d.found.length ? <ul className="because" style={{ marginTop: 10 }}>{d.found.map((c) => <li key={c.domain}>{c.name} ({c.domain})</li>)}</ul> : <p className="small muted">Nothing new that week.</p>}
            </details>
          ))}
        </section>
      ) : null}
    </div>
  );
}

import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { spreadLeads, type SpreadLead } from "@/lib/app/spread";
import type { FrameworkRow, FwStatus, PathToVerdict } from "@/lib/brief/intel";

/**
 * Small, honest graphics for the brief and the Why page. Each states its figures in text as well, so none depends on colour or
 * on seeing the shape, and each reads from the same record the words do, so a graphic can never say something the text does not.
 */

const X0 = 24;
const X1 = 576;
const at = (v: number) => X0 + (Math.max(0, Math.min(100, v)) / 100) * (X1 - X0);

/** Where the score sits against the two bars that decide the verdict, and how far unknowns could carry it. */
export function ScoreTrack({ path }: { path: PathToVerdict }) {
  const { score, maybeAt, qualifyAt, couldReach } = path;
  if (score === null) return null;
  const reach = couldReach !== null && couldReach > score ? couldReach : null;
  return (
    <figure className="chart score-track">
      <svg viewBox="0 0 600 96" role="img" aria-label={`Score ${score} of 100. A possible fit starts at ${maybeAt} and a strong fit at ${qualifyAt}.${reach ? ` If everything the site left unsaid came out best it could reach ${reach}.` : ""}`}>
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="none" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--brand)" strokeWidth="2" opacity="0.45" /></pattern>
        </defs>
        <rect x={X0} y="38" width={at(maybeAt) - X0} height="16" rx="8" fill="var(--bad-soft)" />
        <rect x={at(maybeAt)} y="38" width={at(qualifyAt) - at(maybeAt)} height="16" fill="var(--warn-soft)" />
        <rect x={at(qualifyAt)} y="38" width={X1 - at(qualifyAt)} height="16" rx="8" fill="var(--good-soft)" />
        {reach ? <rect x={at(score)} y="38" width={at(reach) - at(score)} height="16" fill="url(#hatch)" /> : null}
        <rect x={X0} y="38" width={at(score) - X0} height="16" rx="8" fill="var(--brand)" opacity="0.92" />
        {[maybeAt, qualifyAt].map((v) => (
          <g key={v}>
            <line x1={at(v)} x2={at(v)} y1="30" y2="62" stroke="var(--ink-2)" strokeWidth="1.5" />
            <text x={at(v)} y="76" textAnchor="middle" className="ct">{v}</text>
          </g>
        ))}
        <g transform={`translate(${at(score)} 0)`}>
          <path d="M0 33 l-7 -11 h14 z" fill="var(--ink)" />
          <text y="14" textAnchor="middle" className="cv">{score}</text>
        </g>
        <text x={(X0 + at(maybeAt)) / 2} y="90" textAnchor="middle" className="cz">Not a fit</text>
        <text x={(at(maybeAt) + at(qualifyAt)) / 2} y="90" textAnchor="middle" className="cz">Possible fit</text>
        <text x={(at(qualifyAt) + X1) / 2} y="90" textAnchor="middle" className="cz">Strong fit</text>
      </svg>
      <figcaption className="small muted">{path.summary}</figcaption>
    </figure>
  );
}

const GROUP_LABEL: Record<string, string> = { fit: "Fit", need: "Need", timing: "Timing", penalty: "Penalty" };

/** Every scored signal as a bar: how many points it earned out of how many it could, with the quote behind it a click away. */
export function ScoreBars({ parts }: { parts: { id: string; group: string; label: string; points: number; max: number; quotes: string[] }[] }) {
  const shown = [...parts].filter((p) => p.points !== 0 || p.max > 0).sort((a, b) => b.points - a.points).slice(0, 12);
  if (shown.length === 0) return null;
  return (
    <ul className="scorebars" aria-label="Points by signal">
      {shown.map((p) => {
        const neg = p.points < 0;
        const frac = p.max > 0 ? Math.min(1, Math.abs(p.points) / p.max) : neg ? 1 : 0;
        return (
          <li key={p.id} className={`g-${p.group}${neg ? " neg" : ""}`}>
            <span className="sb-label">{p.label}<small>{GROUP_LABEL[p.group] ?? p.group}</small></span>
            <span className="sb-track" aria-hidden><i style={{ width: `${Math.max(frac * 100, p.points !== 0 ? 4 : 0)}%` }} /></span>
            <span className="sb-val">{p.points > 0 ? "+" : ""}{p.points}<small>{p.max > 0 && !neg ? ` / ${p.max}` : ""}</small></span>
          </li>
        );
      })}
    </ul>
  );
}

const FW_ICON: Record<FwStatus, IconName> = { held: "check", in_progress: "clock", likely: "alert", not_indicated: "x" };
const FW_WORD: Record<FwStatus, string> = { held: "Held", in_progress: "In progress", likely: "Likely needed", not_indicated: "Not indicated" };

/** The five frameworks side by side: what the company has, what it is working on, what it probably needs, and whether Sprinto may be promised for it. */
export function FrameworkMap({ rows }: { rows: FrameworkRow[] }) {
  return (
    <div className="fwmap" role="list" aria-label="Compliance frameworks">
      {rows.map((r) => (
        <div key={r.id} className={`fw s-${r.status}`} role="listitem">
          <div className="fw-top"><span className="fw-name">{r.name}</span><span className="fw-state"><Icon name={FW_ICON[r.status]} />{FW_WORD[r.status]}</span></div>
          <div className="fw-head">{r.headline}</div>
          {r.because ? <p className="small muted fw-why">{r.because}</p> : null}
          {r.quote ? (
            <blockquote className="quote fw-quote">“{r.quote}”{r.source ? <cite><a href={r.source} target="_blank" rel="noopener noreferrer nofollow">{r.source.replace(/^https?:\/\//, "")}</a></cite> : null}</blockquote>
          ) : null}
          <div className="fw-foot">
            {r.status !== "not_indicated" ? <span className={`fw-basis ${r.basis}`}>{r.basis === "stated" ? "Stated on their site" : "Our inference"}</span> : null}
            {r.status !== "not_indicated" ? <span className={`fw-claim ${r.sprintoClaim ? "yes" : "no"}`} title={r.sprintoClaim ? "A verified claim about Sprinto covers this framework." : "No verified claim covers this framework, so do not promise anything about it."}>{r.sprintoClaim ? "Sprinto claim verified" : "No verified claim: do not promise"}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface Person {
  name: string;
  title: string | null;
  role?: string | null;
  note?: string | null;
}

/** Who is in the room: the person the email goes to, and the others to bring in, drawn as a small tree. */
export function BuyerMap({ lead, others }: { lead: Person | null; others: Person[] }) {
  if (!lead && others.length === 0) return null;
  const node = (p: Person, primary = false): ReactNode => (
    <div key={p.name + (p.title ?? "")} className={`bm-node${primary ? " primary" : ""}`}>
      <b>{p.name}</b>
      <span className="small muted">{p.title ?? "Title not listed"}</span>
      {p.role ? <span className="chip">{p.role}</span> : null}
      {p.note ? <span className="small bm-note">{p.note}</span> : null}
    </div>
  );
  return (
    <div className="buyermap" role="group" aria-label="The buying group">
      {lead ? <div className="bm-top">{node(lead, true)}<span className="bm-tag">The email goes here</span></div> : null}
      {others.length ? (
        <>
          {lead ? <div className="bm-stem" aria-hidden /> : null}
          <div className="bm-row">{others.map((o) => <div key={o.name + (o.title ?? "")} className="bm-leaf">{node(o)}</div>)}</div>
        </>
      ) : null}
    </div>
  );
}

const VERDICT_FILL: Record<string, string> = { qualified: "var(--good)", maybe: "var(--orange)", not_fit: "var(--bad)", needs_more: "var(--info)" };
const VERDICT_WORD: Record<string, string> = { qualified: "Strong fit", maybe: "Possible fit", not_fit: "Not a fit", needs_more: "Not enough to judge" };

/** Every researched company as a dot on the score line, coloured by verdict, each one a link to its brief. */
export function FitSpread({ leads, maybeAt = 45, qualifyAt = 65 }: { leads: SpreadLead[]; maybeAt?: number; qualifyAt?: number }) {
  const lay = spreadLeads(leads);
  if (lay.dots.length === 0) return null;
  const rowH = 17;
  const base = 12 + lay.rows * rowH;
  const H = base + 34;
  const ax = (v: number) => 24 + (v / 100) * 552;
  const counts = lay.dots.reduce<Record<string, number>>((m, d) => ((m[d.verdict ?? "needs_more"] = (m[d.verdict ?? "needs_more"] ?? 0) + 1), m), {});
  return (
    <figure className="chart fitspread">
      <svg viewBox={`0 0 600 ${H}`} role="group" aria-label={`Fit scores of ${lay.dots.length} companies. ${Object.entries(counts).map(([v, n]) => `${n} ${VERDICT_WORD[v] ?? v}`).join(", ")}.`}>
        <rect x={ax(0)} y="6" width={ax(maybeAt) - ax(0)} height={base - 4} fill="var(--bad-soft)" opacity="0.55" rx="6" />
        <rect x={ax(maybeAt)} y="6" width={ax(qualifyAt) - ax(maybeAt)} height={base - 4} fill="var(--warn-soft)" opacity="0.55" />
        <rect x={ax(qualifyAt)} y="6" width={ax(100) - ax(qualifyAt)} height={base - 4} fill="var(--good-soft)" opacity="0.55" rx="6" />
        <line x1={ax(0)} x2={ax(100)} y1={base + 2} y2={base + 2} stroke="var(--line-strong)" />
        {[0, maybeAt, qualifyAt, 100].map((v) => (
          <g key={v}><line x1={ax(v)} x2={ax(v)} y1={base} y2={base + 6} stroke="var(--line-strong)" /><text x={ax(v)} y={base + 20} textAnchor="middle" className="ct">{v}</text></g>
        ))}
        {lay.dots.map((d) => (
          <a key={d.id} href={`/prospects/${d.id}/brief`}>
            <title>{`${d.name}: ${d.score} (${VERDICT_WORD[d.verdict ?? "needs_more"] ?? d.verdict})`}</title>
            <circle cx={24 + d.x} cy={base - 9 - d.row * rowH} r="6.5" fill={VERDICT_FILL[d.verdict ?? "needs_more"] ?? "var(--muted)"} stroke="var(--surface)" strokeWidth="1.5" className="dot" />
          </a>
        ))}
      </svg>
      <figcaption className="small muted fs-legend">
        {(["qualified", "maybe", "not_fit", "needs_more"] as const).filter((v) => counts[v]).map((v) => <span key={v}><i style={{ background: VERDICT_FILL[v] }} aria-hidden />{counts[v]} {VERDICT_WORD[v]}</span>)}
        {lay.unscored ? <span>{lay.unscored} not scored yet</span> : null}
      </figcaption>
    </figure>
  );
}

/** The companies being compared as bars on one scale, with the two bars that decide a verdict marked on every track. */
export function CompareBars({ columns, maybeAt = 45, qualifyAt = 65 }: { columns: { id: string; name: string; score: number | null; verdict: string }[]; maybeAt?: number; qualifyAt?: number }) {
  const rows = [...columns].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return (
    <ul className="cmpbars" aria-label="Fit score by company">
      {rows.map((c) => (
        <li key={c.id}>
          <span className="cb-name">{c.name}</span>
          <span className="cb-track" aria-hidden>
            <i style={{ width: `${Math.max(0, Math.min(100, c.score ?? 0))}%`, background: VERDICT_FILL[c.verdict] ?? "var(--muted)" }} />
            <b style={{ left: `${maybeAt}%` }} />
            <b style={{ left: `${qualifyAt}%` }} />
          </span>
          <span className="cb-val">{c.score ?? "n/a"}</span>
        </li>
      ))}
    </ul>
  );
}

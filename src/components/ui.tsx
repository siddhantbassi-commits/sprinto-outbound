import type { ReactNode } from "react";
import { LANES, VERDICTS, type Tone } from "@/lib/app/format";
import { CountUp } from "./count-up";
import { Icon, type IconName } from "./icons";

export function Pill({ tone = "muted", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`pill tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function LanePill({ lane }: { lane: string }) {
  const l = LANES[lane] ?? { label: lane, tone: "muted" as Tone, help: "" };
  return <Pill tone={l.tone} title={l.help}>{l.label}</Pill>;
}

export function VerdictPill({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="muted">-</span>;
  const v = VERDICTS[verdict] ?? { label: verdict, tone: "muted" as Tone };
  return <Pill tone={v.tone}>{v.label}</Pill>;
}

const TONE_ICON: Record<Tone, IconName> = { good: "check", warn: "alert", bad: "alert", info: "info", muted: "info" };

export function Banner({ tone = "info", title, children }: { tone?: Tone; title: string; children?: ReactNode }) {
  return (
    <div className={`banner tone-${tone}`} role={tone === "bad" ? "alert" : "status"}>
      <span className="banner-icon" aria-hidden><Icon name={TONE_ICON[tone]} /></span>
      <div>
        <strong>{title}</strong>
        {children ? <p>{children}</p> : null}
      </div>
    </div>
  );
}

export function PageHead({ title, sub, eyebrow, children }: { title: string; sub?: ReactNode; eyebrow?: string; children?: ReactNode }) {
  return (
    <header className="head">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children ? <div className="row">{children}</div> : null}
    </header>
  );
}

const METER_TONES: Record<string, string> = { sent: "good", active: "info", not_fit: "muted", skipped: "muted", needs_more: "warn", review: "warn", no_contact: "warn", held: "warn", unknown: "bad", failed: "bad" };

/** A stacked bar of where a run's prospects are. Each segment has a title, so it is readable without colour. */
export function Meter({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const order = ["sent", "active", "review", "held", "needs_more", "no_contact", "unknown", "failed", "not_fit", "skipped"];
  return (
    <div className="meter" role="img" aria-label={order.filter((k) => counts[k]).map((k) => `${counts[k]} ${LANES[k]?.label ?? k}`).join(", ")}>
      {order.filter((k) => counts[k]).map((k) => (
        <i key={k} className={`m-${METER_TONES[k] ?? "muted"}`} style={{ width: `${(counts[k]! / total) * 100}%` }} title={`${counts[k]} ${LANES[k]?.label ?? k}`} />
      ))}
    </div>
  );
}

export function Empty({ title, children, icon = "inbox" }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="empty">
      <span className="art" aria-hidden><Icon name={icon} /></span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** A labelled figure: the building block of every summary row. */
export function Kpi({ icon, label, value, count, decimals, unit, foot, delta }: { icon: IconName; label: string; value?: ReactNode; count?: number; decimals?: number; unit?: string; foot?: ReactNode; delta?: { text: string; dir: "up" | "down" | "flat" } }) {
  return (
    <div className="kpi">
      <div className="kpi-top"><span>{label}</span><span className="kpi-ico" aria-hidden><Icon name={icon} /></span></div>
      <div className="kpi-val">{count !== undefined ? <CountUp to={count} decimals={decimals} /> : value}{unit ? <small>{unit}</small> : null}</div>
      {foot || delta ? <div className="kpi-foot">{delta ? <span className={`delta ${delta.dir}`}>{delta.text}</span> : null}{foot}</div> : null}
    </div>
  );
}

/** A section heading with its icon, for cards that hold more than a table. */
export function SectionTitle({ icon, title, sub, children }: { icon?: IconName; title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <h2 className="sec-title">{icon ? <Icon name={icon} /> : null}{title}</h2>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {children ? <div className="row">{children}</div> : null}
    </div>
  );
}

/** A score drawn as a ring. The number is always printed, so the ring is never the only carrier. */
export function Ring({ value, max = 100, label, tone = "brand", size = 92 }: { value: number; max?: number; label?: string; tone?: "brand" | "good" | "warn" | "bad"; size?: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, max === 0 ? 0 : value / max));
  const color = tone === "brand" ? "var(--brand)" : `var(--${tone})`;
  return (
    <div className="ring" style={{ ["--s" as string]: `${size}px`, ["--ring-c" as string]: color }} role="img" aria-label={`${value} of ${max}${label ? `, ${label}` : ""}`}>
      <svg viewBox="0 0 100 100" aria-hidden><circle className="track" cx="50" cy="50" r={r} /><circle className="value" cx="50" cy="50" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ ["--c" as string]: c }} /></svg>
      <b>{value}{label ? <small>{label}</small> : null}</b>
    </div>
  );
}

/** A trend line with no axes: shape only, with the figures stated beside it. */
export function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 30 - ((v - min) / span) * 26] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden>
      <path className="area" d={`${line} L100 34 L0 34 Z`} />
      <path className="line" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

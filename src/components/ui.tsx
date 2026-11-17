import type { ReactNode } from "react";
import { LANES, VERDICTS, type Tone } from "@/lib/app/format";

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

const ICONS: Record<Tone, string> = { good: "✓", warn: "!", bad: "✕", info: "i", muted: "·" };

export function Banner({ tone = "info", title, children }: { tone?: Tone; title: string; children?: ReactNode }) {
  return (
    <div className={`banner tone-${tone}`} role={tone === "bad" ? "alert" : "status"}>
      <span className="banner-icon" aria-hidden>{ICONS[tone]}</span>
      <div>
        <strong>{title}</strong>
        {children ? <p>{children}</p> : null}
      </div>
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="head">
      <div>
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

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

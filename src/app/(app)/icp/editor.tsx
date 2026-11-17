"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { runReplay, saveVersion, type ReplayState, type SaveState } from "./actions";
import { Banner, Pill } from "@/components/ui";

export interface FieldView {
  name: string;
  label: string;
  group: string;
  min: number;
  max: number;
  help?: string;
}

const VERDICT: Record<string, string> = { qualified: "Qualified", maybe: "Maybe", needs_more: "Needs more", not_fit: "Not a fit" };
const ORDER = ["qualified", "maybe", "needs_more", "not_fit"];
const KIND: Record<string, { label: string; tone: "good" | "warn" | "muted" }> = {
  now_qualifies: { label: "now qualifies", tone: "good" },
  no_longer_qualifies: { label: "no longer qualifies", tone: "warn" },
  other: { label: "moves", tone: "muted" },
};

function Results({ r }: { r: ReplayState }) {
  if (!r.ok) {
    return r.errors ? (
      <Banner tone="bad" title="That draft cannot be replayed">
        {r.errors.slice(0, 6).join(" ")}
      </Banner>
    ) : (
      <Banner tone="bad" title="Could not replay">{r.message}</Banner>
    );
  }
  const x = r.result!;
  const movers = r.movers ?? [];
  const sameAsBase = !!r.message;
  return (
    <section className="stack" aria-live="polite">
      <h2>What would change</h2>
      <Banner tone="info" title="Nothing has been saved">This re-scored {x.total} stored {x.total === 1 ? "company" : "companies"} from the facts already read. No site was fetched and no model was called.</Banner>
      {sameAsBase ? <Banner tone="info" title="No difference">{r.message}</Banner> : null}
      {x.reproduces.matching < x.reproduces.of ? (
        <Banner tone={x.reproduces.other > 0 ? "warn" : "info"} title="Some stored verdicts came from an older version">
          Replaying version {r.baseVersion} reproduces {x.reproduces.matching} of {x.reproduces.of} recorded verdicts. {x.reproduces.olderVersion > 0 ? `${x.reproduces.olderVersion} ${x.reproduces.olderVersion === 1 ? "was" : "were"} scored under an older version of the ICP, which is expected after a change. ` : ""}{x.reproduces.other > 0 ? `${x.reproduces.other} differ for another reason, such as a suppression or blocklist added since. ` : ""}The moves below compare version {r.baseVersion} with your draft, so they are exact either way.
        </Banner>
      ) : (
        <p className="small muted">Check: replaying version {r.baseVersion} reproduces all {x.reproduces.of} recorded verdicts, so this comparison is exact.</p>
      )}
      {x.approximated > 0 ? <p className="small muted">{x.approximated} older {x.approximated === 1 ? "company has" : "companies have"} no record of how much text was read, so the reading-enough rule was assumed to pass for {x.approximated === 1 ? "it" : "them"}.</p> : null}

      <div className="tablewrap">
        <table>
          <thead><tr><th>Outcome</th><th className="num">Now</th><th className="num">With the draft</th></tr></thead>
          <tbody>
            {ORDER.map((v) => {
              const a = x.counts.base[v] ?? 0;
              const b = x.counts.draft[v] ?? 0;
              return (
                <tr key={v}>
                  <td><strong>{VERDICT[v]}</strong></td>
                  <td className="num">{a}</td>
                  <td className="num"><strong>{b}</strong> {b !== a ? <span className="small" style={{ color: b > a ? "var(--good)" : "var(--bad)" }}>({b > a ? "+" : ""}{b - a})</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">{r.changed} {r.changed === 1 ? "company moves" : "companies move"} to a different outcome; {x.scoreOnly} change score but keep the same outcome; {x.unchanged} are untouched.</p>

      {movers.length > 0 ? (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Company</th><th>Moves</th><th>Why</th></tr></thead>
            <tbody>
              {movers.map((m) => (
                <tr key={m.id}>
                  <td><Link href={`/prospects/${m.id}`}><strong>{m.domain}</strong></Link></td>
                  <td>
                    <Pill tone={KIND[m.kind]!.tone}>{KIND[m.kind]!.label}</Pill>
                    <div className="small muted" style={{ marginTop: 4 }}>{VERDICT[m.from.verdict]} {Math.round(m.from.score)} → {VERDICT[m.to.verdict]} {Math.round(m.to.score)}</div>
                  </td>
                  <td className="small">
                    {m.because.length ? (
                      <>
                        {m.because.map((d) => `${d.label}: ${d.from} → ${d.to}`).join(" · ")}
                        <div className="muted">{m.reason}</div>
                      </>
                    ) : (
                      <>
                        The score is unchanged; the bar moved.
                        <div className="muted">{m.reason}</div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {r.changed! > movers.length ? <p className="small muted">Showing the first {movers.length} of {r.changed}.</p> : null}
    </section>
  );
}

export function IcpEditor({ baseId, baseVersion, fields, values, blocklist }: { baseId: string; baseVersion: number; fields: FieldView[]; values: Record<string, number>; blocklist: string }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])));
  const [block, setBlock] = useState(blocklist);
  const [reason, setReason] = useState("");
  const [replay, replayAction, replaying] = useActionState<ReplayState | null, FormData>(runReplay, null);
  const [save, saveAction, saving] = useActionState<SaveState | null, FormData>(saveVersion, null);
  const groups = [...new Set(fields.map((f) => f.group))];
  const edited = fields.filter((f) => vals[f.name] !== String(values[f.name])).length + (block !== blocklist ? 1 : 0);

  return (
    <form action={replayAction} className="stack">
      <input type="hidden" name="base" value={baseId} />
      <div className="card stack">
        <div>
          <h2>Try a different definition of fit</h2>
          <p className="sub">Starting from version {baseVersion}. Change any number, then replay: every stored company is re-scored from the facts already read, and you see who would move. Nothing is saved until you choose to.</p>
        </div>
        {groups.map((g) => (
          <fieldset key={g} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend><h3 style={{ marginBottom: 8 }}>{g}</h3></legend>
            <div className="fields">
              {fields.filter((f) => f.group === g).map((f) => (
                <label key={f.name}>
                  {f.label}
                  {f.help ? <span className="hint">{f.help}</span> : null}
                  <input type="number" name={f.name} min={f.min} max={f.max} step={1} value={vals[f.name]} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} style={vals[f.name] !== String(values[f.name]) ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined} />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <label>
          Never write to these domains <span className="hint">(besides Sprinto and its competitors, which are always blocked)</span>
          <textarea name="blocklist" value={block} onChange={(e) => setBlock(e.target.value)} style={{ minHeight: 70 }} placeholder={"an-auditor.com\nan-existing-customer.io"} spellCheck={false} />
        </label>
        <div className="row">
          <button className="btn primary" type="submit" disabled={replaying}>{replaying ? "Replaying…" : "Replay (saves nothing)"}</button>
          <button className="btn" type="button" disabled={edited === 0} onClick={() => { setVals(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]))); setBlock(blocklist); }}>Reset to version {baseVersion}</button>
          <span className="small muted">{edited === 0 ? "No changes yet." : `${edited} ${edited === 1 ? "change" : "changes"} from version ${baseVersion}.`}</span>
        </div>
      </div>

      {replay ? <Results r={replay} /> : null}

      <div className="card stack">
        <div>
          <h2>Keep it</h2>
          <p className="sub">Saves this draft as a new version, with your reason. It cannot be used for a run until it is signed off, so saving changes nothing until then.</p>
        </div>
        <label>Why is this better?<input type="text" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Our wins skew to 11-50 people, so size should count more" /></label>
        <div className="row">
          <button className="btn" type="submit" formAction={saveAction} disabled={saving || edited === 0}>{saving ? "Saving…" : "Save as a new version"}</button>
          {save ? <span className="small" role="status" style={{ color: save.ok ? "var(--good)" : "var(--bad)" }}>{save.message}</span> : null}
        </div>
      </div>
    </form>
  );
}

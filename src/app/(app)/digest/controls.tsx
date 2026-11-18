"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { runDigestNow, setDigestEnabled, type DigestResult } from "./actions";
import { startRun, type StartResult } from "../runs/new/actions";
import { Icon } from "@/components/icons";
import { Banner } from "@/components/ui";
import { toast } from "@/components/toast";
import { estimateCost } from "@/lib/discovery/criteria";
import type { DigestCompany } from "@/lib/digest/email";

/** The on/off switch and the run-now button. */
export function DigestControls({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<DigestResult | null, FormData>(setDigestEnabled, null);
  const [running, start] = useTransition();
  const [note, setNote] = useState<DigestResult | null>(null);
  useEffect(() => {
    if (state) toast(state.message, state.ok);
  }, [state]);
  return (
    <div className="stack tight">
      <div className="row">
        <form action={action}>
          <input type="hidden" name="enabled" value={enabled ? "off" : "on"} />
          <button className="btn" type="submit" disabled={pending}>{enabled ? "Switch the weekly digest off" : "Switch the weekly digest on"}</button>
        </form>
        <button className="btn primary" type="button" disabled={running} onClick={() => start(async () => { setNote(await runDigestNow()); })}>
          {running ? "Searching…" : "Run it now"}<Icon name="search" />
        </button>
      </div>
      {running ? <p className="small muted" role="status">This is free and takes about half a minute.</p> : null}
      {note && !running ? <p className="small" role="status" style={{ color: note.ok ? "var(--good)" : "var(--bad)", margin: 0 }}>{note.message}</p> : null}
    </div>
  );
}

/** The newest digest's companies, to choose from and research. Ones that have been researched since are shown, not offered. */
export function DigestList({ companies, researched, maxRun }: { companies: DigestCompany[]; researched: string[]; maxRun: number | null }) {
  const gone = new Set(researched);
  const open = companies.filter((c) => !gone.has(c.domain)).map((c) => c.domain);
  const [picked, setPicked] = useState<string[]>(open.slice(0, 10));
  const [start, startAction, starting] = useActionState<StartResult | null, FormData>(startRun, null);
  const cost = estimateCost(picked.length);
  const over = maxRun !== null && picked.length > maxRun;
  const toggle = (d: string) => setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row">
        <button type="button" className="linkbtn" onClick={() => setPicked(open.slice(0, 25))}>Select all</button>
        <button type="button" className="linkbtn" onClick={() => setPicked([])}>Clear</button>
      </div>
      <ul className="leads">
        {companies.map((c) => {
          const can = !gone.has(c.domain);
          const on = picked.includes(c.domain);
          return (
            <li key={c.domain} className={`lead${on ? " on" : ""}${can ? "" : " off"}`}>
              <label className="leadbox">
                <input type="checkbox" checked={on} disabled={!can} onChange={() => toggle(c.domain)} aria-label={`Research ${c.name}`} />
                <span className="tick" aria-hidden>{on ? <Icon name="check" /> : null}</span>
              </label>
              <div className="leadmain">
                <div className="row" style={{ gap: 8 }}>
                  <b>{c.name}</b>
                  <a className="mono small" href={`https://${c.domain}`} target="_blank" rel="noreferrer noopener">{c.domain}<Icon name="external" /></a>
                  {!can ? <span className="chip warn">Researched since</span> : null}
                </div>
                {c.about ? <p className="small about">&ldquo;{c.about}&rdquo;</p> : null}
                <ul className="because">{c.because.map((b) => <li key={b}>{b}</li>)}</ul>
              </div>
              <div />
            </li>
          );
        })}
      </ul>
      <form action={startAction} className="dock card">
        <input type="hidden" name="domains" value={JSON.stringify(picked)} />
        <input type="hidden" name="source" value="discover" />
        <div className="dockinfo">
          <b>{picked.length} selected</b>
          <span className="small muted">{picked.length === 0 ? "Choose at least one company." : `About ${(cost.tokens / 1000).toFixed(0)}k AI tokens and ${cost.minutes} ${cost.minutes === 1 ? "minute" : "minutes"}. You can leave the page; progress is saved.`}</span>
        </div>
        <label className="dockname"><span className="sr-only">Name this run</span><input type="text" name="note" maxLength={120} placeholder="Name this run (optional)" /></label>
        <button className="btn primary large" type="submit" disabled={starting || picked.length === 0 || over}>{starting ? "Starting…" : `Research ${picked.length || ""} ${picked.length === 1 ? "company" : "companies"}`}<Icon name="arrow" /></button>
        <div className="dockwarn">
          {over ? <Banner tone="bad" title={`Over the run limit of ${maxRun}`}>Choose fewer, or an admin can raise the limit in Settings.</Banner> : null}
          {start ? <Banner tone="bad" title="The run did not start">{start.message}</Banner> : null}
        </div>
      </form>
    </div>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { pushNotice } from "./notice-bell";
import { toast } from "./toast";
import { useCreep } from "./use-creep";
import { roughTime } from "@/lib/app/progress";
import type { RunStatus } from "@/lib/app/status";

interface Payload {
  runs: RunStatus[];
  canAdvance: boolean;
}

const WATCH_KEY = "sprinto.watching";
const SEEN_KEY = "sprinto.announced";
const FAST_MS = 5000;
const SLOW_MS = 25000;
const ADVANCE_MS = 6000;

const read = (key: string): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-50) : [];
  } catch {
    return [];
  }
};
const write = (key: string, ids: string[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(ids.slice(-50)));
  } catch {
    /* private window or blocked storage: the card still works for this visit */
  }
};

/** The round gauge on the card's button. */
function MainRing({ r }: { r: RunStatus }) {
  const shown = Math.round(useCreep(r.percent, r.creepTo, r.creepSeconds, !r.paused && !r.finished));
  return <span className="rc-ring" style={{ ["--p" as string]: shown }} aria-hidden><b>{shown}</b></span>;
}

/** One run's line in the card: its own bar, moving between records. */
function RunLine({ r }: { r: RunStatus }) {
  const shown = Math.round(useCreep(r.percent, r.creepTo, r.creepSeconds, !r.paused && !r.finished));
  return (
    <div className="rc-run">
      <div className="row between">
        <Link href={`/runs/${r.id}`}><b>{r.title}</b></Link>
        <span className="small muted">{shown}%</span>
      </div>
      <div className="bar-track t-brand live" role="progressbar" aria-valuenow={shown} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.title} progress`}><i style={{ width: `${Math.max(3, shown)}%` }} /></div>
      <p className="small muted" style={{ margin: 0 }}>{r.doing ?? "Working"}{r.remainingSeconds !== null ? `, ${roughTime(r.remainingSeconds)} to go` : ""}.</p>
    </div>
  );
}

/**
 * Lives in the app shell, so it keeps going whichever page is open. While a run has work left it shows a small progress card
 * (with an honest note that the person may go elsewhere), keeps the worker moving from this browser, and when a run finishes
 * it says so: a toast, a browser notification if the person allowed one, the tab title, and a card that stays until dismissed.
 * A run that finished while the person was away is announced the next time they open the app.
 */
export function RunWatcher() {
  const path = usePathname();
  const [data, setData] = useState<Payload | null>(null);
  const [done, setDone] = useState<RunStatus[]>([]);
  const [open, setOpen] = useState(true);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  const prevActive = useRef<Map<string, boolean>>(new Map());
  const busy = useRef(false);
  const titleBase = useRef("");

  useEffect(() => {
    if (typeof Notification !== "undefined") setPerm(Notification.permission);
    titleBase.current = document.title;
  }, []);

  const announce = useCallback((r: RunStatus, away: boolean) => {
    const text = `${r.title} is ready: ${r.qualified} ${r.qualified === 1 ? "company is" : "companies are"} worth a call.`;
    setDone((d) => (d.some((x) => x.id === r.id) ? d : [...d, r]));
    // Kept in the notification history too, so it is still there if the toast and the card were missed.
    pushNotice({ id: `run-${r.id}`, text: away ? `${r.title} finished while you were away: ${r.qualified} worth a call.` : text, href: "/leads" });
    toast(away ? `${r.title} finished while you were away.` : text, true);
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        const n = new Notification("Research finished", { body: text, tag: `run-${r.id}` });
        n.onclick = () => { window.focus(); window.location.href = "/leads"; };
      }
    } catch {
      /* some browsers refuse to construct a Notification outside a page action */
    }
    if (document.hidden) document.title = `✓ Ready · ${titleBase.current || "Sprinto Outbound"}`;
  }, []);

  useEffect(() => {
    const restore = () => { if (!document.hidden && document.title.startsWith("✓ Ready")) document.title = titleBase.current || document.title.replace(/^✓ Ready · /, ""); };
    document.addEventListener("visibilitychange", restore);
    return () => document.removeEventListener("visibilitychange", restore);
  }, []);

  const handle = useCallback((p: Payload, first: boolean) => {
    const watching = new Set(read(WATCH_KEY));
    const seen = new Set(read(SEEN_KEY));
    for (const r of p.runs) {
      const wasActive = prevActive.current.get(r.id) ?? (first ? watching.has(r.id) : false);
      if (!r.finished && !r.paused) watching.add(r.id);
      if (r.finished && wasActive && !seen.has(r.id) && r.total > 0) {
        seen.add(r.id);
        watching.delete(r.id);
        announce(r, first);
      }
      prevActive.current.set(r.id, !r.finished);
    }
    write(WATCH_KEY, [...watching]);
    write(SEEN_KEY, [...seen]);
  }, [announce]);

  useEffect(() => {
    let stopped = false;
    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let next = SLOW_MS;
      try {
        const res = await fetch("/api/runs/status", { cache: "no-store" });
        if (res.ok) {
          const p = (await res.json()) as Payload;
          if (!stopped) {
            setData(p);
            handle(p, first);
            first = false;
            if (p.runs.some((r) => !r.finished && !r.paused)) next = FAST_MS;
          }
        }
      } catch {
        /* offline: try again later */
      }
      if (!stopped) timer = setTimeout(poll, next);
    };
    void poll();
    const wake = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    document.addEventListener("visibilitychange", wake);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", wake); };
  }, [handle]);

  // Keep the worker moving from this browser, on any page except a run's own page, which does it itself. This runs in a
  // background tab too, though the browser may slow a hidden tab's timers; the scheduled worker still carries on if the tab closes.
  const working = !!data?.canAdvance && data.runs.some((r) => !r.finished && !r.paused);
  const onRunPage = /^\/runs\/[^/]+/.test(path) && path !== "/runs/new";
  useEffect(() => {
    if (!working || onRunPage) return;
    let stopped = false;
    const go = async () => {
      if (stopped || busy.current) return;
      busy.current = true;
      try { await fetch("/api/runs/advance", { method: "POST" }); } catch { /* the next pass tries again */ }
      busy.current = false;
    };
    void go();
    const id = setInterval(go, ADVANCE_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [working, onRunPage]);

  // A run's own page already shows its progress in full, so the floating card steps aside there (it still announces a finish).
  const running = onRunPage ? [] : (data?.runs ?? []).filter((r) => !r.finished && !r.paused);
  if (running.length === 0 && done.length === 0) return null;
  const main = running[0];

  const ask = async () => {
    try { setPerm(await Notification.requestPermission()); } catch { /* unsupported */ }
  };

  return (
    <aside className={`runcard${open ? "" : " min"}`} aria-label="Research progress">
      <button type="button" className="runcard-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Collapse progress" : "Show progress"}>
        {main ? <MainRing r={main} /> : <span className="rc-ring done" aria-hidden><Icon name="check" /></span>}
        {!open ? <span className="rc-min">{main ? "Working" : "Ready"}</span> : null}
      </button>
      {open ? (
        <div className="rc-body">
          {running.map((r) => <RunLine key={r.id} r={r} />)}
          {running.length ? (
            <p className="small rc-note">You are free to open other pages or tabs. Research carries on while this window stays open, and we will tell you here when it is ready.</p>
          ) : null}
          {running.length && perm === "default" ? <button type="button" className="linkbtn" onClick={ask}>Also notify me outside the browser when it finishes</button> : null}
          {done.map((r) => (
            <div key={r.id} className="rc-run ready">
              <div className="row between"><b><Icon name="check" /> {r.title} is ready</b><button type="button" className="icon-btn" onClick={() => setDone((d) => d.filter((x) => x.id !== r.id))} aria-label="Dismiss"><Icon name="x" /></button></div>
              <p className="small" style={{ margin: 0 }}>{r.qualified} {r.qualified === 1 ? "company is" : "companies are"} worth a call{r.needsPerson ? `, ${r.needsPerson} need${r.needsPerson === 1 ? "s" : ""} a person` : ""}.</p>
              <div className="row"><Link className="btn small primary" href="/leads">See the leads</Link>{r.needsPerson ? <Link className="btn small" href="/review">Review</Link> : null}</div>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

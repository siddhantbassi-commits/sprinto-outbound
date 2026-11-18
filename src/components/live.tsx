"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface TickSummary {
  busy?: boolean;
  error?: string;
  processed?: number;
  advanced?: number;
  parked?: number;
  retried?: number;
  failed?: number;
}

async function advance(): Promise<TickSummary> {
  const res = await fetch("/api/runs/advance", { method: "POST" });
  if (res.status === 401 || res.status === 403) return { error: "You do not have permission to run the worker." };
  return (await res.json().catch(() => ({ error: "The server did not answer." }))) as TickSummary;
}

const describe = (t: TickSummary) =>
  t.error ? t.error : t.busy ? "The worker is already running. It will catch up." : t.processed ? `Ran ${t.processed} step${t.processed === 1 ? "" : "s"}.` : "Nothing was due.";

/** Runs the worker once, now, and refreshes the page. For when you do not want to wait for the schedule. */
export function AdvanceButton({ label = "Run the worker now" }: { label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; text: string }>({ busy: false, text: "" });
  const run = useCallback(async () => {
    setState({ busy: true, text: "" });
    const t = await advance();
    setState({ busy: false, text: describe(t) });
    router.refresh();
  }, [router]);
  return (
    <span className="row">
      <button className="btn" type="button" onClick={run} disabled={state.busy}>{state.busy ? "Working…" : label}</button>
      <span className="small muted" role="status" aria-live="polite">{state.text}</span>
    </span>
  );
}

/**
 * While a run has work left, keeps the worker going from this page and refreshes as it goes, so watching a run is enough.
 * It stops when the work is done or when the person pauses it, and it carries on in a background tab (a browser may slow a hidden tab's timers). The scheduled worker does the same
 * job without anyone watching; this only makes a watched run feel live.
 */
export function LiveRun({ active }: { active: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  const [note, setNote] = useState("");
  const busy = useRef(false);

  useEffect(() => {
    if (!active || !on) return;
    let stopped = false;
    const loop = async () => {
      if (stopped || busy.current) return;
      busy.current = true;
      const t = await advance();
      busy.current = false;
      if (stopped) return;
      setNote(describe(t));
      router.refresh();
      if (t.error && !t.busy) setOn(false);
    };
    void loop();
    const id = setInterval(loop, 4000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [active, on, router]);

  if (!active) return <span className="small muted">Nothing left to do in this run.</span>;
  return (
    <span className="row">
      <span className="pill tone-info" role="status" aria-live="polite">{on ? <><span className="dot-live" aria-hidden /> Working live</> : "Paused"}</span>
      <button className="btn small" type="button" onClick={() => setOn(!on)}>{on ? "Stop watching" : "Keep going"}</button>
      <span className="small muted">{note}</span>
    </span>
  );
}

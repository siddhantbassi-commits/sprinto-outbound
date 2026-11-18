"use client";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { stepsFor, TOUR_KEY, type TourState } from "@/lib/app/tour";

type Phase = "idle" | "invite" | "tour";
interface Box { top: number; left: number; width: number; height: number }

const saved = (): TourState | null => {
  try {
    const v = localStorage.getItem(TOUR_KEY);
    return v === "done" || v === "skipped" ? v : null;
  } catch {
    return null;
  }
};
const save = (v: TourState) => {
  try { localStorage.setItem(TOUR_KEY, v); } catch { /* storage blocked: it will simply ask again next visit */ }
};

/** The first visible element for an anchor: the sidebar and the phone's top bar both render the navigation, and only one shows. */
function target(anchor: string): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(anchor)}"]`)];
  return all.find((el) => el.getClientRects().length > 0) ?? null;
}

/**
 * A small card that offers a tour the first time someone arrives, and walks through the product one real page at a time,
 * pointing at the part it is talking about. It never blocks the page: the highlight lets clicks through, Escape leaves, and
 * the arrow keys move. Whether it has been seen is remembered in this browser only, and it can be started again at any time.
 */
export function WelcomeTour({ canRun }: { canRun: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const steps = stepsFor(canRun);
  const [phase, setPhase] = useState<Phase>("idle");
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const next = useRef<HTMLButtonElement>(null);
  const step = steps[i];

  useEffect(() => {
    if (saved() !== null) return;
    const t = setTimeout(() => setPhase((p) => (p === "idle" ? "invite" : p)), 1600);
    return () => clearTimeout(t);
  }, []);

  const start = useCallback(() => { setI(0); setPhase("tour"); }, []);
  useEffect(() => {
    window.addEventListener("tour:start", start);
    return () => window.removeEventListener("tour:start", start);
  }, [start]);

  const finish = useCallback((how: TourState) => { save(how); setPhase("idle"); setBox(null); }, []);

  // Go to the page for this stop.
  useEffect(() => {
    if (phase !== "tour" || !step?.path) return;
    if (path !== step.path) router.push(step.path);
  }, [phase, step, path, router]);

  // Find what to point at, even if the page is still arriving, and keep the highlight on it as the window changes.
  useEffect(() => {
    if (phase !== "tour" || !step?.anchor) { setBox(null); return; }
    let stopped = false;
    const measure = () => {
      if (stopped) return;
      const el = target(step.anchor!);
      if (!el) return setBox(null);
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "center", behavior: "smooth" });
      setBox({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 });
    };
    measure();
    const id = setInterval(measure, 350);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { stopped = true; clearInterval(id); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [phase, step, path]);

  useEffect(() => {
    if (phase !== "tour") return;
    next.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish("skipped");
      else if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, steps.length - 1));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, i, steps.length, finish]);

  if (phase === "idle") return null;

  if (phase === "invite") {
    return (
      <aside className="tour invite" role="dialog" aria-label="Welcome">
        <span className="tour-ico" aria-hidden><Icon name="spark" /></span>
        <div className="stack tight">
          <b>New here?</b>
          <p className="small muted" style={{ margin: 0 }}>Take a one-minute tour of how Sprinto Outbound works, from finding companies to approving an email.</p>
          <div className="row">
            <button type="button" className="btn primary small" onClick={start}>Show me around<Icon name="arrow" /></button>
            <button type="button" className="btn ghost small" onClick={() => finish("skipped")}>Not now</button>
          </div>
        </div>
      </aside>
    );
  }

  const last = i === steps.length - 1;
  return (
    <>
      {box ? <div className="tour-ring" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} aria-hidden /> : null}
      <aside className="tour" role="dialog" aria-label="Tour" aria-live="polite">
        <div className="row between">
          <span className="tour-count">{i + 1} of {steps.length}</span>
          <button type="button" className="icon-btn" onClick={() => finish("skipped")} aria-label="Leave the tour"><Icon name="x" /></button>
        </div>
        <div className="stack tight" key={step?.id}>
          <b className="tour-title">{step?.title}</b>
          <p className="small" style={{ margin: 0 }}>{step?.body}</p>
        </div>
        <div className="tour-dots" aria-hidden>{steps.map((s, n) => <i key={s.id} className={n === i ? "now" : n < i ? "done" : ""} />)}</div>
        <div className="row between">
          <button type="button" className="btn ghost small" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}>Back</button>
          <button ref={next} type="button" className="btn primary small" onClick={() => (last ? finish("done") : setI((n) => n + 1))}>{last ? "Finish" : "Next"}<Icon name={last ? "check" : "arrow"} /></button>
        </div>
      </aside>
    </>
  );
}

/** The question mark in the app bar: take the tour again whenever. */
export function TourButton() {
  return (
    <button type="button" className="icon-btn light" onClick={() => window.dispatchEvent(new Event("tour:start"))} title="Take the tour" aria-label="Take the tour">
      <Icon name="help" />
    </button>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { INTRO_COOKIE } from "@/lib/app/enter";

const STEPS = ["Setting up the sample companies", "Reading their websites", "Scoring them against the ICP", "Opening your workspace"];
const MIN_MS = 2600;

/**
 * A short welcome while the sample workspace starts. The animation is cosmetic, but the wait is real: it ends only when the
 * workspace has answered. Reduced motion gets a still version, and a skip is always there.
 */
export function Intro({ to }: { to: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const done = useRef(false);

  const go = () => {
    if (done.current) return;
    done.current = true;
    try { document.cookie = `${INTRO_COOKIE}=1; path=/; max-age=86400; samesite=lax`; } catch { /* the welcome will just show again */ }
    setLeaving(true);
    setTimeout(() => router.replace(to), 380);
  };

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const min = still ? 0 : MIN_MS;
    const started = Date.now();
    const timers = STEPS.slice(1).map((_, i) => setTimeout(() => !cancelled && setStep(i + 1), ((i + 1) * min) / STEPS.length));
    fetch("/api/demo/warm", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("not ready"); })
      .then(() => { if (!cancelled) setTimeout(() => !cancelled && go(), Math.max(0, min - (Date.now() - started))); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") go(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className={`intro${leaving ? " leaving" : ""}`} aria-label="Welcome">
      <div className="intro-glow" aria-hidden />
      <div className="intro-body">
        <span className="intro-mark" aria-hidden><i /><b>S</b></span>
        <h1>Sprinto Outbound</h1>
        <p className="intro-tag">Research that shows its working.</p>
        <ol className="intro-steps" aria-live="polite">
          {STEPS.map((s, i) => <li key={s} className={i < step ? "done" : i === step ? "now" : ""}><span aria-hidden className="dot" />{s}</li>)}
        </ol>
        <div className="intro-bar" aria-hidden><i style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
        {failed ? (
          <div className="intro-fail" role="alert">
            <p>The demo is taking longer than usual to start.</p>
            <button type="button" className="btn primary" onClick={() => router.refresh()}>Try again</button>
          </div>
        ) : (
          <button type="button" className="intro-skip" onClick={go}>Skip</button>
        )}
        <p className="intro-note">A public demo with invented companies. Nothing is sent to anyone.</p>
      </div>
    </main>
  );
}

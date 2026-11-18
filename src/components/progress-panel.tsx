"use client";
import { Icon } from "./icons";
import { useCreep } from "./use-creep";
import { DOING, roughTime, WORK_STEPS, type RunEstimate } from "@/lib/app/progress";

const SHORT = ["Read", "Judge", "Find person", "Choose pains", "Write", "Hand over"];

/**
 * The bar a person watches while research runs: how far along it is, what is happening now, about how long is left, and a
 * plain note that they may go and do something else. The width animates between the page's refreshes, so it moves steadily
 * instead of jumping. The note says only what is true: work continues while this window stays open, and a scheduled worker
 * picks it up if it is closed.
 */
export function ProgressPanel({ est, paused }: { est: RunEstimate; paused: boolean }) {
  const shown = Math.round(useCreep(est.percent, est.creepTo, est.creepSeconds, !paused && !est.finished));
  if (est.finished) return null;
  return (
    <div className="pp" aria-label="Research progress">
      <div className="pp-top">
        <div className="pp-pct" aria-hidden>{shown}<span>%</span></div>
        <div className="pp-now">
          <b>{paused ? "Paused" : est.doing ?? "Working"}</b>
          <span className="small muted">
            {paused ? "No step will start until the run is resumed." : est.remainingSeconds !== null ? `${roughTime(est.remainingSeconds)} to go, across ${est.active} ${est.active === 1 ? "company" : "companies"} still being researched.` : ""}
          </span>
        </div>
      </div>
      <div className={`bar-track t-brand pp-bar${paused ? "" : " live"}`} role="progressbar" aria-valuenow={shown} aria-valuemin={0} aria-valuemax={100} aria-label="Research progress"><i style={{ width: `${Math.max(3, shown)}%` }} /></div>
      <ol className="pp-steps" aria-label="Stages">
        {WORK_STEPS.map((s, i) => (
          <li key={s} className={est.stageIndex === null ? "" : i < est.stageIndex ? "done" : i === est.stageIndex ? "now" : ""} title={DOING[s]}>
            <span className="dot" aria-hidden />{SHORT[i]}
          </li>
        ))}
      </ol>
      <p className="pp-note"><Icon name="info" /><span>You are free to open other pages or tabs. Research carries on while this window stays open, and a small card will follow you around the app and tell you the moment it is ready. If you close the window, a scheduled worker picks it up, only more slowly.</span></p>
    </div>
  );
}

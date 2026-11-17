/**
 * Whether the system can do its job, judged the same way everywhere it is shown. The inputs are plain values read from the
 * database and the environment; the verdict is a pure function of them, so each rule can be tested and the home page and
 * Settings can never disagree.
 */

export interface ReadinessInput {
  mode: "demo" | "supabase";
  testTo: string | null;
  icpSignedVersion: number | null;
  factsProblems: string[];
  geminiSet: boolean;
  gmailSet: boolean;
  hunter: { remaining: number } | { error: string } | null;
  lastTick: string | null;
  now: number;
  /** Companies waiting to be worked, which is what makes a quiet worker a problem. */
  waiting: number;
  reserve: number;
}

export interface ReadyItem {
  id: "test" | "icp" | "facts" | "gemini" | "gmail" | "hunter" | "worker";
  label: string;
  ok: boolean;
  /** Not needed to send. A missing optional item is shown quietly. */
  optional?: boolean;
  detail: string;
  href: string;
  action: string;
}

export interface Readiness {
  items: ReadyItem[];
  /** Everything required to start a run and send is in place. */
  ready: boolean;
  done: number;
  total: number;
}

const HOUR = 3_600_000;

export function buildReadiness(i: ReadinessInput): Readiness {
  const demo = i.mode === "demo";
  const items: ReadyItem[] = [
    { id: "test", label: "Test address", ok: !!i.testTo, detail: i.testTo ? `Mail goes only to ${i.testTo}` : "Not set: every send is refused", href: "/settings", action: "Set it" },
    { id: "icp", label: "ICP signed off", ok: i.icpSignedVersion !== null, detail: i.icpSignedVersion !== null ? `Version ${i.icpSignedVersion} is in use` : "Nothing is signed off, so no run can start", href: "/icp", action: "Review and sign off" },
    { id: "facts", label: "Sprinto claims verified", ok: i.factsProblems.length === 0, detail: i.factsProblems.length ? i.factsProblems[0]! : "Verified by a person, sender and address set", href: "/settings", action: "Verify" },
    { id: "gemini", label: "Gemini", ok: demo || i.geminiSet, detail: demo ? "Scripted model (demo)" : i.geminiSet ? "Key set" : "No key: nothing can be read or written", href: "/settings", action: "See how" },
    { id: "gmail", label: "Gmail", ok: demo || i.gmailSet, detail: demo ? "Test inbox (demo)" : i.gmailSet ? "OAuth configured" : "Not configured: nothing can be sent", href: "/settings", action: "See how" },
    {
      id: "hunter",
      label: "Hunter",
      optional: true,
      ok: !!i.hunter && !("error" in i.hunter),
      detail: !i.hunter ? "Not configured: only hand-picked contacts will work" : "error" in i.hunter ? i.hunter.error : `${i.hunter.remaining} credits left, ${i.reserve} kept in reserve`,
      href: "/settings",
      action: "See how",
    },
  ];
  // The worker only matters once there is work for it: a quiet worker with an empty queue is not a fault.
  const tick = i.lastTick ? new Date(i.lastTick).getTime() : null;
  const beating = tick !== null && i.now - tick < HOUR;
  items.push({
    id: "worker",
    label: "Worker",
    optional: i.waiting === 0,
    ok: beating || i.waiting === 0,
    detail: i.waiting === 0 ? (tick ? "Idle, nothing waiting" : "Has not run yet, nothing waiting") : beating ? "Running" : tick ? "Companies are waiting and it has not run in over an hour" : "Companies are waiting and it has never run",
    href: "/",
    action: "Run it now",
  });
  const required = items.filter((x) => !x.optional);
  return { items, ready: required.every((x) => x.ok), done: required.filter((x) => x.ok).length, total: required.length };
}

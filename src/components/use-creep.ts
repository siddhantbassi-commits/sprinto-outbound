"use client";
import { useEffect, useState } from "react";
import { creepValue } from "@/lib/app/progress";

/**
 * A step can take half a minute with nothing recorded until it ends, so a bar that only moves on records sits still and looks
 * broken. This lets the shown figure climb from where the work really is toward where it will be when the current step ends,
 * at the pace that step usually takes, and stops at 90% of the way so it never claims a step finished before it did. Each time
 * the real figure changes it starts again from the real figure, and it never goes backwards.
 */
export function useCreep(percent: number, creepTo: number, creepSeconds: number, running: boolean): number {
  const [shown, setShown] = useState(percent);
  useEffect(() => {
    setShown((s) => Math.max(percent, Math.min(s, creepTo)));
    if (!running || creepSeconds <= 0 || creepTo <= percent) return;
    const t0 = Date.now();
    const id = setInterval(() => setShown(creepValue(percent, creepTo, creepSeconds, (Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [percent, creepTo, creepSeconds, running]);
  return Math.max(percent, shown);
}

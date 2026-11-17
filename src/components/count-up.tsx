"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A figure that counts up to its value once, when it first appears. It always renders the final number in the markup that
 * is sent to the browser, so a screen reader, a printout, or a person with reduced motion sees the real figure at once.
 */
export function CountUp({ to, decimals = 0, ms = 900 }: { to: number; decimals?: number; ms?: number }) {
  const [shown, setShown] = useState(to);
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) { setShown(to); return; }
    first.current = false;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || to === 0) return;
    let raf = 0;
    const start = performance.now();
    setShown(0);
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(to * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{shown.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</span>;
}

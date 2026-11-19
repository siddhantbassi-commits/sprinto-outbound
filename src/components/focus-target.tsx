"use client";
import { useEffect } from "react";

/**
 * Makes a link like /settings#postal-address do what it says: scroll to that field and put the cursor in it. A plain anchor only
 * scrolls, and a link to the page you are already on would otherwise seem to do nothing.
 */
export function FocusTarget() {
  useEffect(() => {
    const focusHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const el = id ? document.getElementById(id) : null;
      if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
      (el as HTMLElement).focus({ preventScroll: true });
    };
    focusHash();
    // Next.js moves between same-page anchors without a hashchange event, so a click on any anchor is checked too.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href*='#']");
      if (a) setTimeout(focusHash, 80);
    };
    window.addEventListener("hashchange", focusHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", focusHash);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return null;
}

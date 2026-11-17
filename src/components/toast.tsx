"use client";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "./icons";

interface ToastItem {
  id: number;
  text: string;
  ok: boolean;
  out: boolean;
}

/** Shows the result of an action: `toast("Saved", true)` from anywhere in the browser. One host in the shell renders them. */
export function toast(text: string, ok = true): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("app:toast", { detail: { text, ok } }));
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const drop = useCallback((id: number) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, out: true } : x)));
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 240);
  }, []);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ text: string; ok: boolean }>).detail;
      const id = ++n;
      setItems((xs) => [...xs.slice(-3), { id, text: d.text, ok: d.ok, out: false }]);
      setTimeout(() => drop(id), d.ok ? 4200 : 7000);
    };
    window.addEventListener("app:toast", on);
    return () => window.removeEventListener("app:toast", on);
  }, [drop]);
  return (
    <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast${t.ok ? "" : " bad"}${t.out ? " out" : ""}`} role={t.ok ? "status" : "alert"}>
          <span className="t-ico" aria-hidden><Icon name={t.ok ? "check" : "alert"} /></span>
          <span>{t.text}</span>
          <button type="button" onClick={() => drop(t.id)} aria-label="Dismiss"><Icon name="x" /></button>
        </div>
      ))}
    </div>
  );
}

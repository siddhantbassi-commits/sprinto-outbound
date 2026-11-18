"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { addNotice, NOTICES_KEY, readNotices, SEEN_KEY, unreadCount, whenText, type Notice } from "@/lib/app/notices";

const load = (): Notice[] => {
  try {
    return readNotices(JSON.parse(localStorage.getItem(NOTICES_KEY) ?? "[]"));
  } catch {
    return [];
  }
};
const seenAt = (): number => {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
};

/** Records a notice in the history and tells the bell. Safe to call from anywhere in the browser. */
export function pushNotice(n: Omit<Notice, "at"> & { at?: number }): void {
  if (typeof window === "undefined") return;
  try {
    const list = addNotice(load(), { ...n, at: n.at ?? Date.now() });
    localStorage.setItem(NOTICES_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: the toast still shows, there is just no history */
  }
  window.dispatchEvent(new Event("app:notices"));
}

/** The bell in the app bar: a badge for what is new, and the history behind it, so a finished run is never lost. */
export function NoticeBell() {
  const [list, setList] = useState<Notice[]>([]);
  const [seen, setSeen] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const refresh = useCallback(() => { setList(load()); setSeen(seenAt()); }, []);
  useEffect(() => {
    refresh();
    window.addEventListener("app:notices", refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("app:notices", refresh); window.removeEventListener("storage", refresh); };
  }, [refresh]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const unread = unreadCount(list, seen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* not remembered */ }
      setSeen(Date.now());
    }
  };
  const clear = () => {
    try { localStorage.setItem(NOTICES_KEY, "[]"); } catch { /* not remembered */ }
    setList([]);
  };
  const now = Date.now();

  return (
    <div className="bellwrap" ref={box}>
      <button type="button" className="icon-btn light bell" onClick={toggle} aria-expanded={open} aria-label={unread ? `Notifications, ${unread} new` : "Notifications"} title="Notifications">
        <Icon name="bell" />
        {unread ? <span className="bell-dot" aria-hidden>{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="bellpanel" role="dialog" aria-label="Notifications">
          <div className="row between"><b>Notifications</b>{list.length ? <button type="button" className="linkbtn" onClick={clear}>Clear</button> : null}</div>
          {list.length === 0 ? <p className="small muted" style={{ margin: "10px 0 0" }}>Nothing yet. When a run finishes, it is recorded here so you cannot miss it.</p> : (
            <ul>
              {list.map((n) => (
                <li key={n.id}>
                  {n.href ? <Link href={n.href} onClick={() => setOpen(false)}>{n.text}</Link> : <span>{n.text}</span>}
                  <span className="small muted">{whenText(n.at, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

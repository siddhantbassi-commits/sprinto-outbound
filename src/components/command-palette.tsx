"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: IconName;
  group: "Go to" | "Companies" | "Actions";
}

/**
 * The fast path through the product: Cmd/Ctrl+K (or /) opens it, type to filter, arrows to move, Enter to go. Every entry is
 * a real route; nothing here is decoration.
 */
export function CommandPalette({ items }: { items: PaletteItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true']");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen((o) => !o);
        setQ("");
        setAt(0);
      } else if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => { setOpen(true); setQ(""); setAt(0); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("palette:open", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("palette:open", onOpen); };
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = items.filter((i) => !needle || `${i.label} ${i.hint ?? ""}`.toLowerCase().includes(needle));
    return hit.slice(0, 40);
  }, [items, q]);

  if (!open) return null;
  const go = (i: PaletteItem | undefined) => { if (!i) return; setOpen(false); router.push(i.href); };
  let last = "";
  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search and jump">
        <input
          ref={input}
          value={q}
          onChange={(e) => { setQ(e.target.value); setAt(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(a + 1, shown.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); go(shown[at]); }
          }}
          placeholder="Search companies, or jump to a page"
          aria-label="Search"
          autoComplete="off"
          spellCheck={false}
        />
        <ul role="listbox">
          {shown.length === 0 ? <li className="grp">No matches</li> : null}
          {shown.map((i, n) => {
            const head = i.group !== last ? <li key={`g-${i.group}`} className="grp" role="presentation">{i.group}</li> : null;
            last = i.group;
            return [
              head,
              <li key={i.id} role="option" aria-selected={n === at} onMouseEnter={() => setAt(n)}>
                <button type="button" onClick={() => go(i)}>
                  <Icon name={i.icon} />
                  <span>{i.label}</span>
                  {i.hint ? <span className="muted small" style={{ marginLeft: "auto" }}>{i.hint}</span> : null}
                </button>
              </li>,
            ];
          })}
        </ul>
        <div className="hint-row"><span><span className="kbd">↑</span> <span className="kbd">↓</span> move</span><span><span className="kbd">↵</span> open</span><span><span className="kbd">esc</span> close</span></div>
      </div>
    </div>
  );
}

/** The button in the app bar that opens the palette, so it is discoverable without knowing the shortcut. */
export function SearchButton() {
  return (
    <button type="button" className="search-btn" onClick={() => window.dispatchEvent(new Event("palette:open"))} aria-label="Search and jump">
      <Icon name="search" />
      <span className="label-long">Search companies, jump to a page</span>
      <span className="kbd">⌘K</span>
    </button>
  );
}

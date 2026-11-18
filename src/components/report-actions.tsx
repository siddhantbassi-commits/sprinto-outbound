"use client";
import { useRef, useState } from "react";

/** Copies the weekly report as plain text, or prints the page. If the browser blocks the clipboard, the text is selected for the person to copy. */
export function ReportActions({ text, label = "Copy the report", printLabel = "Print" }: { text: string; label?: string; printLabel?: string }) {
  const [state, setState] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("Copied.");
    } catch {
      ref.current?.select();
      setState("Your browser blocked copying, so the text is selected: press Ctrl+C (or ⌘C).");
    }
  }

  return (
    <span className="row">
      <button className="btn" type="button" onClick={copy}>{label}</button>
      <button className="btn" type="button" onClick={() => window.print()}>{printLabel}</button>
      <span className="small muted" role="status" aria-live="polite">{state}</span>
      <textarea ref={ref} readOnly value={text} aria-hidden tabIndex={-1} style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />
    </span>
  );
}

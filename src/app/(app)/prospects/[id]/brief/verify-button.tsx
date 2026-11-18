"use client";
import { useState, useTransition } from "react";
import { verifyContact } from "./actions";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";

/** Pays one Hunter credit to check the address properly. It says so on the button, and nothing happens until it is pressed. */
export function VerifyButton({ prospectId }: { prospectId: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="stack tight">
      <button type="button" className="btn small" disabled={pending} onClick={() => start(async () => { const r = await verifyContact(prospectId); setNote({ ok: r.ok, text: r.message }); toast(r.message, r.ok); })}>
        <Icon name="shield" />{pending ? "Checking…" : "Check this address (1 Hunter credit)"}
      </button>
      {note ? <p className="small" role="status" style={{ margin: 0, color: note.ok ? "var(--good)" : "var(--warn)" }}>{note.text}</p> : null}
    </div>
  );
}

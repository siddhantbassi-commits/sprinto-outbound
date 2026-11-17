"use client";
import { useActionState } from "react";
import { signOff, type SaveState } from "./actions";

export function SignOff({ version, id }: { version: number; id: string }) {
  const [r, action, pending] = useActionState<SaveState | null, FormData>(signOff, null);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="version" value={id} />
      <label style={{ display: "flex", flexDirection: "row", gap: 6, alignItems: "center", fontWeight: 400 }}><input type="checkbox" name="understood" /> I have read version {version}</label>
      <button className="btn small primary" type="submit" disabled={pending}>Sign off</button>
      {r ? <span className="small" role="status" style={{ color: r.ok ? "var(--good)" : "var(--bad)" }}>{r.message}</span> : null}
    </form>
  );
}

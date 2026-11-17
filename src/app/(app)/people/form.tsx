"use client";
import { useActionState } from "react";
import { changeRole, type ActionResult } from "./actions";

export function RoleForm({ user, role, self }: { user: string; role: string; self: boolean }) {
  const [r, action, pending] = useActionState<ActionResult | null, FormData>(changeRole, null);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="user" value={user} />
      <select name="role" defaultValue={role} aria-label="Role" style={{ width: "auto" }}>
        <option value="pending">Pending (no access)</option>
        <option value="viewer">Viewer</option>
        <option value="operator">Operator</option>
        <option value="admin">Admin</option>
        <option value="worker">Worker (the scheduler)</option>
      </select>
      <button className="btn small" type="submit" disabled={pending}>Save</button>
      {self ? <span className="small muted">this is you</span> : null}
      {r ? <span className="small" role="status" style={{ color: r.ok ? "var(--good)" : "var(--bad)" }}>{r.message}</span> : null}
    </form>
  );
}

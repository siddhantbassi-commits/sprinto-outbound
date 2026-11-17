import { redirect } from "next/navigation";
import { RoleForm } from "./form";
import { Banner, PageHead } from "@/components/ui";
import { dateTime } from "@/lib/app/format";
import { people } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";

export const metadata = { title: "People" };

export default async function People() {
  const s = (await getSession())!;
  if (s.user.role !== "admin") redirect("/");
  const list = await people(s.db);
  const changes = await s.db.select("role_changes", {}, { order: "id", ascending: false, limit: 10 });
  return (
    <div className="stack">
      <PageHead title="People" sub="Sign-in is by invitation. Invite someone from your Supabase dashboard; they arrive here as pending, with no access, until you approve them." />
      <Banner tone="info" title="What each role can do">
        <strong>Viewer</strong> reads everything but sees contact addresses masked. <strong>Operator</strong> starts runs, resumes prospects, adds suppressions and contacts. <strong>Admin</strong> also changes settings, the ICP, the facts file and roles. <strong>Worker</strong> is the scheduler&rsquo;s own account.
      </Banner>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Email</th><th>Joined</th><th>Role</th></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{p.email ?? "(no email)"}</td>
                <td className="small muted nowrap">{dateTime(p.created_at)}</td>
                <td><RoleForm user={p.id} role={p.role} self={p.id === s.user.id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {changes.length ? (
        <details className="card"><summary>Recent role changes</summary>
          <ul className="stack small" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {changes.map((c) => <li key={String(c.id)}>{list.find((p) => p.id === c.user_id)?.email ?? String(c.user_id).slice(0, 8)}: {String(c.old_role)} → <strong>{String(c.new_role)}</strong> <span className="muted">by {list.find((p) => p.id === c.created_by)?.email ?? "an admin"}, {dateTime(c.created_at as string)}</span></li>)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

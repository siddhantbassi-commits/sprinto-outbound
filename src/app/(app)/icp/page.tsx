import { IcpEditor, type FieldView } from "./editor";
import { SignOff } from "./signoff";
import { Banner, PageHead, Pill } from "@/components/ui";
import { dateTime } from "@/lib/app/format";
import { icpVersions } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";
import { configToValues, describeRubric, diffConfig, FIELDS, maxPoints } from "@/lib/icp/edit";

export const metadata = { title: "ICP" };

export default async function Icp({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const q = await searchParams;
  const s = (await getSession())!;
  const admin = s.user.role === "admin";
  const { versions, signed } = await icpVersions(s.db);
  const inUse = versions.find((v) => signed.has(v.id));
  const newest = versions[0];
  // Drafts start from the version in use, so "what changes" is always measured against what is actually running.
  const base = inUse ?? newest;
  const fields: FieldView[] = FIELDS.map(({ name, label, group, min, max, help }) => ({ name, label, group, min, max, help }));

  return (
    <div className="stack">
      <PageHead title="ICP and rulebook" sub="Who counts as a fit, in words and in numbers. The scoring is fixed code; only these numbers are yours to change, and every change is a new signed-off version." />

      {q.saved ? <Banner tone="good" title="Saved as a new version">It cannot be used for a run until you sign it off below.</Banner> : null}
      {!inUse ? <Banner tone="bad" title="No version has been signed off">No run can start until one is. Sign off a version below.</Banner> : null}
      {inUse && newest && newest.id !== inUse.id ? <Banner tone="warn" title={`Version ${newest.version} is saved but not signed off`}>Runs still use version {inUse.version} until it is.</Banner> : null}

      {base ? (
        <section className="card stack">
          <div><h2>The rubric in words{inUse ? ` (version ${inUse.version}, in use)` : ` (version ${base.version})`}</h2><p className="sub">Out of 100: {describeRubric(base.config).length > 0 ? `the strongest case adds up to ${maxPoints(base.config)} before the cap.` : ""}</p></div>
          {describeRubric(base.config).map((d) => (
            <div key={d.title}>
              <h3>{d.title}</h3>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{d.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          ))}
          {(base.blocklist?.domains ?? []).length ? <p className="small muted">Also never written to, by this version: {(base.blocklist?.domains ?? []).join(", ")}.</p> : null}
        </section>
      ) : null}

      {admin && base ? (
        <IcpEditor baseId={base.id} baseVersion={base.version} fields={fields} values={configToValues(base.config)} blocklist={(base.blocklist?.domains ?? []).join("\n")} />
      ) : (
        <Banner tone="info" title="Only an admin can change the ICP">You can read the rubric and every past version here. An admin can try a different definition and replay it against the companies already read.</Banner>
      )}

      <section className="card stack">
        <div><h2>Every version</h2><p className="sub">Each change is a new row with a reason. Nothing is edited in place.</p></div>
        <div className="tablewrap"><table>
          <thead><tr><th>Version</th><th>What changed</th><th>Status</th></tr></thead>
          <tbody>
            {versions.map((v, i) => {
              const prev = versions[i + 1];
              const changes = prev ? diffConfig(prev.config, v.config) : [];
              const blockChanged = prev ? JSON.stringify(prev.blocklist?.domains ?? []) !== JSON.stringify(v.blocklist?.domains ?? []) : false;
              return (
                <tr key={v.id}>
                  <td><strong>{v.version}</strong><div className="small muted">{dateTime(v.created_at)}</div></td>
                  <td className="small">
                    <div>{v.reason}</div>
                    {changes.length ? <div className="muted">{changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join(" · ")}{blockChanged ? " · blocklist changed" : ""}</div> : prev ? <div className="muted">{blockChanged ? "Blocklist changed" : "No weights changed"}</div> : <div className="muted">The starting rubric.</div>}
                  </td>
                  <td>{signed.has(v.id) ? <Pill tone="good">signed off{v.id === inUse?.id ? ", in use" : ""}</Pill> : admin ? <SignOff version={v.version} id={v.id} /> : <Pill tone="warn">not signed off</Pill>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}

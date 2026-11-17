import Link from "next/link";
import { Banner, Empty, LanePill, PageHead } from "@/components/ui";
import { ago, LANES } from "@/lib/app/format";
import { needsAttention } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";

export const metadata = { title: "Needs attention" };

const ORDER = ["unknown", "failed", "review", "held", "no_contact", "needs_more"];
const WHAT: Record<string, string> = {
  unknown: "Check your Sent folder for the X-Outbound-Run header, then say whether it went out. Nothing will retry these for you.",
  failed: "These stopped for a reason retrying cannot fix, or after three tries. Read the reason; you can put one back once it is sorted.",
  review: "Scored as a maybe, or waiting on a limit such as the daily send cap or Hunter credits. A person decides.",
  held: "A draft that did not pass the checks, or something the draft needed was missing. The reason says which.",
  no_contact: "No suitable named person was found. Add one by hand and try again.",
  needs_more: "Not enough on the site to judge. Nothing was guessed; you can try again later or leave it.",
};

export default async function Review() {
  const s = (await getSession())!;
  const items = await needsAttention(s.db);
  const groups = ORDER.map((lane) => ({ lane, rows: items.filter((i) => i.lane === lane) })).filter((g) => g.rows.length > 0);

  return (
    <div className="stack">
      <PageHead title="Needs attention" sub="Everything that stopped and is waiting on a person, with the reason. Nothing here is hidden or retried behind your back." />
      {groups.length === 0 ? (
        <div className="card"><Empty title="Nothing is waiting for you"><p>Every prospect is either moving, finished, or ruled out with a reason.</p><Link href="/">Back to runs</Link></Empty></div>
      ) : null}
      {items.some((i) => i.lane === "unknown") ? <Banner tone="bad" title="Some sends are unknown">An email may have gone out without us being told. Resolve these first.</Banner> : null}
      {groups.map((g) => (
        <section key={g.lane} className="stack">
          <div><h2>{LANES[g.lane]?.label} <span className="muted">({g.rows.length})</span></h2><p className="muted small" style={{ margin: 0 }}>{WHAT[g.lane]}</p></div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Company</th><th>Why it is here</th><th>Updated</th><th /></tr></thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.domain}</strong> <LanePill lane={r.lane} /></td>
                    <td className="small">{r.lane_reason}</td>
                    <td className="small nowrap muted">{ago(r.updated_at)}</td>
                    <td><Link className="btn small" href={`/prospects/${r.id}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

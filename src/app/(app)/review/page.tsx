import Link from "next/link";
import { Icon } from "@/components/icons";
import { Banner, Empty, LanePill, PageHead, Pill, SectionTitle } from "@/components/ui";
import { ago, LANES, plural } from "@/lib/app/format";
import { currentSettings, needsAttention } from "@/lib/app/queries";
import { approvalQueue } from "@/lib/app/review";
import { getSession } from "@/lib/app/runtime";
import { ReviewDesk } from "./desk";

export const metadata = { title: "Review" };

const ORDER = ["unknown", "failed", "review", "held", "no_contact", "needs_more"];
const WHAT: Record<string, string> = {
  unknown: "Check Sent for the X-Outbound-Run header, then record whether it went out. Nothing retries these.",
  failed: "Stopped for a reason retrying cannot fix, or after three tries. Read the reason; put it back once sorted.",
  review: "Scored as a maybe, or waiting on a limit such as the daily cap or Hunter credits.",
  held: "A draft that did not pass the checks, or something it needed was missing.",
  no_contact: "No suitable named person was found. Add one by hand and try again.",
  needs_more: "Not enough on the site to judge. Nothing was guessed.",
};

export default async function Review() {
  const s = (await getSession())!;
  const canDecide = s.user.role === "operator" || s.user.role === "admin";
  const [settings, queue, attention] = await Promise.all([currentSettings(s.db), approvalQueue(s.db, canDecide), needsAttention(s.db)]);
  const inQueue = new Set(queue.map((q) => q.prospectId));
  const others = attention.filter((a) => !inQueue.has(a.id));
  const groups = ORDER.map((lane) => ({ lane, rows: others.filter((i) => i.lane === lane) })).filter((g) => g.rows.length > 0);
  const sender = settings?.sender_name ? `${settings.sender_name}${settings.sender_title ? `, ${settings.sender_title}` : ""}` : "Sender not set";
  const approvalOn = settings?.require_approval !== false;

  return (
    <div className="stack" style={{ gap: 26 }}>
      <PageHead eyebrow="Work" title="Review" sub="Approve what goes out, and decide what the system could not.">
        {queue.length ? <Pill tone="warn">{plural(queue.length, "draft")} to approve</Pill> : null}
        {others.length ? <Pill tone="muted">{plural(others.length, "other item")}</Pill> : null}
      </PageHead>

      {!approvalOn ? (
        <Banner tone="warn" title="Approval is off">Drafts are sent without waiting for a person. An admin can turn approval back on in Settings.</Banner>
      ) : null}

      {approvalOn ? (
        queue.length ? (
          <section className="stack tight" aria-label="Drafts to approve">
            <SectionTitle icon="mail" title="Ready for your approval" sub="Nothing here has been sent. Each email goes out only after you approve it, with your edits if you make any." />
            <ReviewDesk items={queue} canDecide={canDecide} sender={sender} testTo={settings?.test_to ?? null} />
          </section>
        ) : (
          <div className="card"><Empty title="No drafts are waiting for approval" icon="check"><p className="small" style={{ margin: 0 }}>New drafts appear here as the pipeline finishes them.</p></Empty></div>
        )
      ) : null}

      {others.some((i) => i.lane === "unknown") ? <Banner tone="bad" title="Some sends are unknown">An email may have gone out without being recorded. Resolve these first.</Banner> : null}
      {groups.length === 0 && queue.length === 0 ? (
        <div className="card"><Empty title="Nothing is waiting on you" icon="check"><p className="small" style={{ margin: 0 }}>Every company is moving, finished, or ruled out with a reason.</p><Link href="/" className="btn small" style={{ marginTop: 8 }}>Back to runs</Link></Empty></div>
      ) : null}

      {groups.map((g) => (
        <section key={g.lane} className="stack tight">
          <SectionTitle title={`${LANES[g.lane]?.label ?? g.lane} (${g.rows.length})`} sub={WHAT[g.lane]} />
          <div className="tablewrap">
            <table>
              <thead><tr><th>Company</th><th>Why it is here</th><th>Updated</th><th /></tr></thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.domain}</strong> <LanePill lane={r.lane} /></td>
                    <td className="small">{r.lane_reason}</td>
                    <td className="small nowrap muted">{ago(r.updated_at)}</td>
                    <td><Link className="btn small" href={`/prospects/${r.id}`}>Open<Icon name="arrow" /></Link></td>
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

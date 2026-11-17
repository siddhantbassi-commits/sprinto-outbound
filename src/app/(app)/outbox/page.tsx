import { notFound } from "next/navigation";
import { Banner, Empty, PageHead } from "@/components/ui";
import { dateTime } from "@/lib/app/format";
import { env } from "@/lib/app/runtime";
import { getDemo } from "@/lib/demo/world";

export const metadata = { title: "Test inbox" };

/** Demo mode only: what the pretend Gmail "delivered". In the real product these land in your own Gmail inbox. */
export default async function Outbox() {
  if (env().mode !== "demo") notFound();
  const demo = await getDemo();
  return (
    <div className="stack">
      <PageHead title="Test inbox" sub="This is what would have landed in your inbox. The header above each email is the test-mode defence: who it would have gone to, and why." />
      <Banner tone="info" title="Pretend inbox">In demo mode nothing is sent anywhere. These are the exact messages the real sender built, held in memory.</Banner>
      {demo.outbox.length === 0 ? <div className="card"><Empty title="Nothing delivered yet" /></div> : demo.outbox.map((m) => (
        <article key={m.runId} className="card stack">
          <div className="row small muted"><span>To <strong>{m.to}</strong></span><span>{dateTime(m.at)}</span><span className="mono">X-Outbound-Run: {m.runId}</span></div>
          <div className="email"><div className="subject">Subject: {m.subject}</div>{m.text}</div>
        </article>
      ))}
    </div>
  );
}

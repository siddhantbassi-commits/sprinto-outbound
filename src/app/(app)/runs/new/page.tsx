import { redirect } from "next/navigation";
import { NewRunForm } from "./form";
import { Banner, PageHead } from "@/components/ui";
import { currentSettings } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";
import { LIVE_LIMITS } from "@/lib/demo/live";

export const metadata = { title: "New run" };

export default async function NewRun() {
  const s = (await getSession())!;
  if (s.user.role !== "operator" && s.user.role !== "admin") redirect("/");
  const settings = await currentSettings(s.db);
  return (
    <div className="stack" style={{ gap: 22 }}>
      <PageHead eyebrow="Work" title="New run" sub="Add the companies you want to look at. Each one is read, qualified, matched to a named person and written up, with every decision recorded." />
      {s.env.live ? (
        <Banner tone="info" title="New companies are read for real here">
          Paste any company's website and the real model reads its public pages and scores it against the ICP, with every fact tied to a quote from the page. Hunter then looks up a contact (capped, and shown only as an initial and a masked address), the real model picks the pains and writes the email, and nothing is sent: it lands only in the pretend test inbox. Limits: {LIVE_LIMITS.perRun} new companies per run, {LIVE_LIMITS.perVisitorPerHour} an hour from one connection, and a daily allowance for everyone.
        </Banner>
      ) : null}
      {!settings?.test_to ? <Banner tone="warn" title="Test mode has no address yet">You can start a run, but nothing will be sent until an admin sets the test address in Settings.</Banner> : null}
      <NewRunForm facts={{ approval: settings?.require_approval !== false, dailyCap: settings?.daily_send_cap ?? null, testTo: settings?.test_to ?? null, maxRun: settings?.max_run_size ?? null, demo: s.mode === "demo" }} />
    </div>
  );
}

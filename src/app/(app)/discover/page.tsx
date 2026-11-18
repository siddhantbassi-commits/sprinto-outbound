import { redirect } from "next/navigation";
import { DiscoverForm } from "./form";
import { Banner, PageHead } from "@/components/ui";
import { currentSettings } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";
import { defaultCriteria } from "@/lib/discovery/criteria";
import { ICP_V1 } from "@/lib/icp/config";

export const metadata = { title: "Discover companies" };
// A search asks Hunter three questions and looks at up to two dozen home pages; that fits well inside a minute.
export const maxDuration = 60;

export default async function Discover() {
  const s = (await getSession())!;
  if (s.user.role !== "operator" && s.user.role !== "admin") redirect("/");
  const settings = await currentSettings(s.db);
  return (
    <div className="stack" style={{ gap: 22 }}>
      <PageHead eyebrow="Work" title="Discover companies" sub="Start from who Sprinto should talk to. Set what a good customer looks like, see the companies that match, and choose which to research. Each one is read, scored against your ICP, matched to a named person and written up for a discovery call." />
      {!settings?.test_to ? <Banner tone="warn" title="Test mode has no address yet">You can research companies, but nothing will be sent until an admin sets the test address in Settings.</Banner> : null}
      <DiscoverForm initial={defaultCriteria(ICP_V1)} facts={{ approval: settings?.require_approval !== false, testTo: settings?.test_to ?? null }} />
    </div>
  );
}

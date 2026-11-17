import { redirect } from "next/navigation";
import { NewRunForm } from "./form";
import { Banner, PageHead } from "@/components/ui";
import { currentSettings } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";

export const metadata = { title: "New run" };

export default async function NewRun() {
  const s = (await getSession())!;
  if (s.user.role !== "operator" && s.user.role !== "admin") redirect("/");
  const settings = await currentSettings(s.db);
  return (
    <div className="stack">
      <PageHead title="New run" sub="Add the companies you want to look at. Each one is read, qualified, matched to a named person and written up, with every decision recorded." />
      {!settings?.test_to ? <Banner tone="warn" title="Test mode has no address yet">You can start a run, but nothing will be sent until an admin sets the test address in Settings.</Banner> : null}
      <NewRunForm />
    </div>
  );
}

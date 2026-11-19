import { Banner, PageHead } from "@/components/ui";
import { getSession } from "@/lib/app/runtime";
import { askSuggestions } from "@/lib/app/ask-suggestions";
import { AskForm } from "./ask-form";

export const metadata = { title: "Ask" };

export default async function Ask() {
  const s = (await getSession())!;
  const recent = await s.db.select("prospects", {}, { order: "updated_at", ascending: false, limit: 60 });
  const suggestions = askSuggestions(recent.map((r) => ({ domain: String(r.domain), verdict: (r.verdict as string | null) ?? null, lane: String(r.lane) })), s.mode === "demo");
  return (
    <div className="stack">
      <PageHead title="Ask" sub="Ask about what the system did, in plain English. It looks things up in the records and answers from them, and shows what it looked at." />
      {s.mode === "demo" ? <Banner tone="info" title="Demo stand-in">There is no model key in demo mode, so a simple keyword matcher chooses the lookups and writes the answer. The lookups, the checks and the limits are the real ones.</Banner> : null}
      <AskForm suggestions={suggestions} />
      <section className="card stack">
        <h2>What Ask can and cannot do</h2>
        <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
          <li>It only reads. It has seven fixed lookups and no way to send, skip, promote, edit or delete. Decisions are made in Needs attention.</li>
          <li>It sees exactly what you can see, and never a contact&rsquo;s name or email address. Open a company&rsquo;s Why page for those.</li>
          <li>Anything in its answer that no lookup returned, a company or a number, is flagged for you to check. Numbers it works out itself (a percentage, say) are flagged too, because the check cannot tell arithmetic from invention.</li>
          <li>Each question is a fresh start: it does not remember earlier ones. It is limited to 10 questions in 10 minutes and one at a time{s.guest ? ", and a guest gets 20 a day" : ""}, and spends a fixed amount of model effort per question.</li>
          <li>Text copied from websites can appear in the records. It is handed to the model as marked data, and instruction-like text in a lookup is flagged, but a determined page could still make an answer odd. That is why the evidence is always shown.</li>
        </ul>
      </section>
    </div>
  );
}

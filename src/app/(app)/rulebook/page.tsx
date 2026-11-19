import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageHead, Pill, SectionTitle } from "@/components/ui";
import { MAX_CALLS_PER_ROUND, MAX_ROUNDS } from "@/lib/agent/loop";
import { icpVersions, currentSettings } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";
import { ICP_V1, type IcpConfig } from "@/lib/icp/config";
import { describeRubric, maxPoints } from "@/lib/icp/edit";

export const metadata = { title: "Rulebook" };

type Who = "Code" | "Model, code checks" | "Model, within limits";

const PIPELINE: { n: number; name: string; who: Who; what: string }[] = [
  { n: 1, name: "Read the site", who: "Code", what: "Fetches the homepage and a short list of standard pages from the company's own domain, after reading robots.txt. Same domain only, a hard page and size cap, a delay between requests, and a refusal of internal addresses." },
  { n: 2, name: "Extract the facts", who: "Model, code checks", what: "Gemini fills named fields from the page text, each with a quote. Code confirms every quote appears on the page, sets a fact to unknown when it does not, and treats absence as a finding only where code can check it." },
  { n: 3, name: "Qualify", who: "Code", what: "A deterministic score from the facts, under a versioned ICP that a person signed off. If key facts are missing, the model may choose among five fixed lookups, but code decides when it knows enough." },
  { n: 4, name: "Find the person", who: "Code", what: "A hand-picked contact first, then the cached Hunter result, then one Hunter search if credits allow. Code ranks candidates by title, seniority and confidence. The model never sees the address." },
  { n: 5, name: "Choose two pains", who: "Model, within limits", what: "From a fixed library of pains for that role, code builds a shortlist, the model picks two and gives a reason citing evidence, and code rejects anything outside the shortlist." },
  { n: 6, name: "Draft the email", who: "Model, code checks", what: "Gemini writes from a quote the code selected. Twelve checks run in code (claims, numbers, length, banned phrases, a real hook). Two repairs at most, then the draft is held for a person." },
  { n: 7, name: "Send", who: "Code", what: "Reserved under a lock: the test address only (or the reviewer's own address, once confirmed by a code), daily cap, one email per domain per cooldown, suppression list, one live send per company. An uncertain result is never retried automatically." },
];

const WHO_TONE: Record<Who, "info" | "good" | "warn"> = { Code: "good", "Model, code checks": "info", "Model, within limits": "warn" };

export default async function Rulebook() {
  const s = (await getSession())!;
  const [{ versions, signed }, settings] = await Promise.all([icpVersions(s.db), currentSettings(s.db)]);
  const inUse = versions.find((v) => signed.has(v.id));
  const cfg: IcpConfig = inUse?.config ?? ICP_V1;
  const rubric = describeRubric(cfg);
  const tokens = settings?.tokens_per_domain ?? 60_000;

  const evidence: { q: string; data: string; where: string; sufficient: string; limit: string; unanswered: string; stop: string }[] = [
    { q: "Is it a business software product?", data: "What the company sells, and who buys it", where: "Homepage, /product, /about", sufficient: "A product type in saas, platform, api, devtool or infra, and an audience that is not consumer", limit: "The first read, plus the loop's rounds", unanswered: "Needs more. Nothing is guessed", stop: "Yes: not software or consumer ends it as not a fit" },
    { q: "Excluded or suppressed?", data: "The blocklist, the suppression list, and whether it already uses Sprinto", where: "Our own records, and a trust page naming Sprinto", sufficient: "The domain is on neither list and does not use Sprinto", limit: "No fetch needed", unanswered: "Not applicable: always answerable", stop: "Yes: any hit ends it as not a fit" },
    { q: "Too large to be the buyer?", data: "Headcount band", where: "/about, /careers, a stated team size", sufficient: "A band with a quote. Estimates are flagged", limit: "Shared with the loop", unanswered: "Flagged as unknown, not blocking", stop: `Yes: over 1,000 people is not a fit` },
    { q: "Enough read to judge?", data: "Characters and pages of real text", where: "Everything fetched", sufficient: `At least ${cfg.minChars.toLocaleString("en-GB")} characters from ${cfg.minPages} pages`, limit: "Shared with the loop", unanswered: "Needs more, never scored", stop: "Yes: too little ends it as needs more" },
    { q: "Where are they on compliance?", data: "Held, in progress, or none visible, with the framework", where: "/security, /trust, footer, a trust subdomain", sufficient: "A named status with a quote, or an absence that code can verify", limit: "One trust-page lookup", unanswered: "Counts as unknown toward coverage", stop: "No: a certified company scores low, it is not removed" },
    { q: "Is this the right stage?", data: "Enterprise signals, open security roles, recent funding or launch", where: "/pricing, /customers, /careers", sufficient: `${cfg.minKnownKeyFacts} of the 6 key facts known`, limit: `${MAX_ROUNDS} further rounds, ${MAX_CALLS_PER_ROUND} lookups at most per round`, unanswered: "Needs more: a person decides. Never guessed", stop: "No: the score decides" },
  ];

  const defences: { icon: "shield" | "lock" | "clock" | "list" | "flag" | "mail"; title: string; text: string }[] = [
    { icon: "lock", title: "Test mode is a lock, not a setting you can forget", text: "The recipient is a server value. The send function takes no recipient, and the database refuses a mismatch." },
    { icon: "shield", title: "A claim must be grounded", text: "Every extracted fact carries a quote that is checked against the page. Every claim about Sprinto comes from a file a person verified." },
    { icon: "flag", title: "Page text cannot give orders", text: "Website text reaches the model as marked data. Instruction-like text is flagged on the company's page, and the model's output can change no score and send no mail." },
    { icon: "clock", title: `Every loop has a ceiling`, text: `${MAX_ROUNDS} rounds, ${tokens.toLocaleString("en-GB")} tokens per company, then a person decides. The cap is the design.` },
    { icon: "list", title: "History cannot be rewritten", text: "Nineteen tables are append-only in Postgres itself. Each decision and each email keeps who, when and why." },
    { icon: "mail", title: "An uncertain send is never repeated", text: "If it is unknown whether Gmail accepted a message, only a person can resolve it, after checking the Sent folder." },
  ];

  return (
    <div className="stack" style={{ gap: 28 }}>
      <PageHead eyebrow="Control" title="Rulebook" sub="How a company is read, judged and written to. Generated from the live configuration, so this page cannot drift from what the system does.">
        <Pill tone={inUse ? "good" : "warn"}>{inUse ? `ICP version ${inUse.version}, signed off` : "No ICP signed off"}</Pill>
      </PageHead>

      <section className="stack">
        <SectionTitle icon="runs" title="The pipeline" sub="Seven steps. The model reads and writes; code decides, checks and sends." />
        <div className="stack tight">
          {PIPELINE.map((p) => (
            <div key={p.n} className="rule">
              <div className="rule-head">
                <span className="rule-num">{p.n}</span>
                <h3>{p.name}</h3>
                <span className="right"><Pill tone={WHO_TONE[p.who]}>{p.who}</Pill></span>
              </div>
              <p className="muted" style={{ margin: 0 }}>{p.what}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="stack">
        <SectionTitle icon="book" title="Evidence map" sub="For each question that decides a company: the fact that settles it, where it lives, what counts as an answer, how many tries it gets, and what happens when it stays unanswered." />
        <div className="stack tight">
          {evidence.map((e, i) => (
            <div key={e.q} className="rule">
              <div className="rule-head"><span className="rule-num">{i + 1}</span><h3>{e.q}</h3></div>
              <dl>
                <dt>Data that answers it</dt><dd>{e.data}</dd>
                <dt>Where it lives</dt><dd>{e.where}</dd>
                <dt>Sufficient when</dt><dd>{e.sufficient}</dd>
                <dt>Limit</dt><dd>{e.limit}</dd>
                <dt>If unanswered</dt><dd>{e.unanswered}</dd>
                <dt>Ends the assessment</dt><dd>{e.stop}</dd>
              </dl>
            </div>
          ))}
        </div>
        <p className="small muted">Worst case for one company: {MAX_ROUNDS} further rounds beyond the first read, at most {MAX_CALLS_PER_ROUND} lookups each, inside a {tokens.toLocaleString("en-GB")}-token budget. Two of three answered and one unknown never becomes a guess: it goes to a person with the reason attached.</p>
      </section>

      <section className="stack">
        <SectionTitle icon="target" title="The scoring rubric" sub={`Version ${cfg.version}. Strongest case adds to ${maxPoints(cfg)} before the 100-point cap.`} />
        <div className="grid two">
          {rubric.map((r) => (
            <div key={r.title} className="card">
              <h3>{r.title}</h3>
              <ul className="stack tight" style={{ margin: "10px 0 0", paddingLeft: 18 }}>{r.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      <section className="stack">
        <SectionTitle icon="shield" title="Defences" sub="What is enforced in code and in the database, not left to care." />
        <div className="grid two">
          {defences.map((d) => (
            <div key={d.title} className="card">
              <div className="sec-title"><h3 style={{ display: "flex", gap: 10, alignItems: "center" }}><Icon name={d.icon} />{d.title}</h3></div>
              <p className="muted" style={{ margin: "8px 0 0" }}>{d.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card hero stack">
        <SectionTitle icon="user" title="The human boundary" />
        <p style={{ margin: 0, maxWidth: "70ch" }}>The system researches, qualifies, finds a contact and drafts. A person owns the ICP, verifies every claim about Sprinto, reviews each email, and decides anything the system could not. In this build mail goes only to a test address; moving to real prospects would be a deliberate change by an admin, after review.</p>
      </section>

      <section className="card stack">
        <SectionTitle icon="flag" title="When this gets shut down" sub="Written down before the build, as the class asks. Checked against real decisions on the Scorecard." />
        <ul className="rules" style={{ borderTop: 0, paddingTop: 0 }}>
          <li><Icon name="flag" />Stop if the Growth Lead rewrites more than 50% of emails. The aim is under 20%.</li>
          <li><Icon name="flag" />Stop if running the system takes more time than it saves. The aim is under 2 minutes of person time per company.</li>
          <li><Icon name="flag" />Stop if the person chosen is right less than 60% of the time.</li>
        </ul>
        <div><Link className="btn" href="/scorecard">Open the Scorecard<Icon name="arrow" /></Link></div>
      </section>
    </div>
  );
}

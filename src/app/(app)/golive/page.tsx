import Link from "next/link";
import { Icon } from "@/components/icons";
import { Banner, PageHead, Pill, Ring, SectionTitle } from "@/components/ui";
import { dateTime } from "@/lib/app/format";
import { currentSettings, settingsPage, workerStatus } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";
import { builtInSafeguards, recommendedDailyCap, setupChecks, verdictOf, type Check } from "@/lib/golive/checks";
import { checkSenderDomain } from "@/lib/golive/checks";
import { demoResolver, dnsChecks, systemResolver } from "@/lib/golive/dns";
import { verifiedClaims, type SprintoFactsFile } from "@/lib/pitch/sprinto-facts";

export const metadata = { title: "Go-live readiness" };
export const maxDuration = 30;

const TONE = { pass: "good", warn: "warn", fail: "bad" } as const;
const WORD = { pass: "In place", warn: "Worth a look", fail: "Fix first" } as const;

function Row({ c }: { c: Check }) {
  return (
    <li className={c.status === "pass" ? "ok" : "no"}>
      <span className={`tick ${c.status}`} aria-hidden>{c.status === "pass" ? "✓" : c.status === "warn" ? "!" : "✕"}</span>
      <span>
        <strong>{c.label}</strong> <Pill tone={TONE[c.status]}>{WORD[c.status]}</Pill>
        <span className="muted"> {c.detail}</span>
        {c.fix ? <span className="gofix"><b>To do:</b> {c.fix}</span> : null}
      </span>
    </li>
  );
}

export default async function GoLive() {
  const s = (await getSession())!;
  const now = Date.now();
  const [settings, page, status] = await Promise.all([currentSettings(s.db), settingsPage(s.db), workerStatus(s.db)]);
  const file = page.file?.content as SprintoFactsFile | undefined;
  const signed = new Set(page.signoffs.map((x) => String(x.icp_version_id)));
  const emails = await s.db.select("emails", { status: "sent" }, { order: "sending_at", ascending: true, limit: 1 });
  const outcomes = await s.db.select("lead_outcomes", {}, { limit: 500, columns: "id" });
  // Demo mode never uses a real sender, even if one is in the environment of the machine it runs on.
  const from = s.mode === "demo" ? "outbound@example.com" : (s.env.gmail?.from ?? null);
  const firstSendAt = (emails[0]?.sending_at as string | undefined) ?? null;
  const lastTick = status.lastTick ? new Date(status.lastTick).getTime() : null;

  const sender = checkSenderDomain(from);
  const dns = await dnsChecks(from, s.mode === "demo" ? demoResolver : systemResolver);
  const setup = setupChecks({
    testTo: settings?.test_to ?? null,
    fromAddress: from,
    postalAddress: settings?.postal_address ?? null,
    senderName: settings?.sender_name ?? null,
    senderTitle: settings?.sender_title ?? null,
    verifiedClaims: file ? verifiedClaims(file).length : 0,
    icpSigned: page.icp.some((v) => signed.has(v.id)),
    approvalRequired: settings?.require_approval !== false,
    dailyCap: settings?.daily_send_cap ?? null,
    cooldownDays: settings?.mail_cooldown_days ?? 30,
    firstSendAt,
    suppressions: page.suppressions.length,
    outcomesRecorded: outcomes.length,
    gmailConnected: !!s.env.gmail || s.mode === "demo",
    workerRecent: lastTick !== null && now - lastTick < 3_600_000,
    now,
  });
  const domainChecks = [sender, ...dns];
  const all = [...domainChecks, ...setup];
  const v = verdictOf(all);
  const safeguards = builtInSafeguards({ testTo: settings?.test_to ?? null, cooldownDays: settings?.mail_cooldown_days ?? 30, suppressions: page.suppressions.length, outcomesRecorded: outcomes.length });
  const pass = all.filter((c) => c.status === "pass").length;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <PageHead eyebrow="Control" title="Go-live readiness" sub="Everything around the day mail goes to real prospects, checked: the sending domain's authentication, the sender's details, the safeguards already built in, and a sensible daily ramp." />

      <section className="card hero why-hero" aria-label="Summary">
        <Ring value={pass} max={all.length} label={`of ${all.length}`} tone={v.fails ? "bad" : v.warns ? "warn" : "good"} size={104} />
        <div className="stack tight" style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: "1.35rem" }}>{v.headline}</h2>
          <p style={{ margin: 0 }}>{pass} of {all.length} checks pass. {s.mode === "demo" ? "Demo mode: the domain checks use stand-in records." : "The domain checks were just read from the live DNS."}</p>
          <div className="row"><Pill tone="info">Test mode is on</Pill><span className="small muted">{settings?.test_to ? `Mail goes only to ${settings.test_to}.` : "No test address is set."}</span></div>
        </div>
      </section>

      <Banner tone="info" title="Going live is deliberately not a switch">
        The sender is built so that it cannot take a recipient: a draft has no way to name one. Sending to real prospects is therefore a code change that must be reviewed, not a setting that anyone can flip. This page tells you whether everything around that change is ready, and does not make it.
      </Banner>

      <section className="card stack" aria-label="The sending domain">
        <SectionTitle icon="mail" title="The sending domain" sub={from ? `Read live from the DNS for ${from}.` : "No sending address is set."} />
        <ul className="checks">{domainChecks.map((c) => <Row key={c.id} c={c} />)}</ul>
        {dns.length === 0 && sender.status === "pass" ? null : dns.length === 0 ? <p className="small muted" style={{ margin: 0 }}>The SPF, DKIM, DMARC and mail-server checks run once there is a sending address on a domain you control.</p> : null}
      </section>

      <section className="card stack" aria-label="Setup">
        <SectionTitle icon="sliders" title="Setup" sub="What a person has to have done." />
        <ul className="checks">{setup.map((c) => <Row key={c.id} c={c} />)}</ul>
        <p className="small muted" style={{ margin: 0 }}>Most of these are set in <Link href="/settings">Settings</Link>. The send ramp is advice, not a limit: the daily cap you set is what the database enforces. Recommended today: up to {recommendedDailyCap(firstSendAt, now)} a day{firstSendAt ? `, since the first send on ${dateTime(firstSendAt)}` : " (no email has been sent yet)"}.</p>
      </section>

      <section className="card stack" aria-label="Safeguards built in">
        <SectionTitle icon="shield" title="Safeguards that are already built in" sub="Enforced by the database or the sender, not by anyone remembering to." />
        <ul className="checks">
          {safeguards.map((g) => <li key={g.label} className="ok"><span className="tick pass" aria-hidden>✓</span><span><strong>{g.label}</strong> <span className="muted">{g.detail}</span></span></li>)}
        </ul>
      </section>

      <p className="small muted" style={{ margin: 0 }}><Icon name="info" /> These checks cannot tell you whether a list is lawful to contact in a given country, or whether a recipient has consented. That is a decision for a person, with the rules of the places you mail.</p>
    </div>
  );
}

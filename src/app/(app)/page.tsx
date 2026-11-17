import Link from "next/link";
import { AdvanceButton } from "@/components/live";
import { Banner, Empty, Meter, PageHead } from "@/components/ui";
import { ago, dateTime, plural } from "@/lib/app/format";
import { currentSettings, listRuns, workerStatus } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";

export const metadata = { title: "Runs" };
const STALE_MS = 60 * 60_000;

export default async function Runs() {
  const s = (await getSession())!;
  const [runs, status, settings] = await Promise.all([listRuns(s.db), workerStatus(s.db), currentSettings(s.db)]);
  const canRun = s.user.role === "operator" || s.user.role === "admin";
  const active = runs.reduce((n, r) => n + (r.counts.active ?? 0), 0);
  const sent = runs.reduce((n, r) => n + (r.counts.sent ?? 0), 0);

  // The page never shows an all-clear it did not check: the worker's last heartbeat is read, and old is called old.
  const lastTick = status.lastTick ? new Date(status.lastTick).getTime() : null;
  const stale = lastTick === null || Date.now() - lastTick > STALE_MS;

  return (
    <div className="stack">
      <PageHead title="Runs" sub="Each run is a list of domains, read, qualified and written up one step at a time.">
        {canRun ? <AdvanceButton /> : null}
        {canRun ? <Link href="/runs/new" className="btn primary">New run</Link> : null}
      </PageHead>

      {settings?.test_to ? (
        <Banner tone="info" title="Test mode">
          Every email goes to <strong>{settings.test_to}</strong> only. The real contact is named in a header above the email, and is never mailed.
        </Banner>
      ) : (
        <Banner tone="warn" title="Test mode has no address yet">Nothing can be sent until an admin sets the test address in Settings.</Banner>
      )}
      {active > 0 && stale ? (
        <Banner tone="warn" title={status.lastTick ? `The worker last ran ${ago(status.lastTick)}` : "The worker has never run"}>
          {plural(active, "prospect")} {active === 1 ? "is" : "are"} waiting. {canRun ? "Use “Run the worker now”, or open a run: watching a run keeps it moving." : "Ask an operator to run it."}
        </Banner>
      ) : null}

      <div className="grid">
        <div className="card stat"><b>{runs.length}</b><span>Runs</span></div>
        <div className="card stat"><b>{sent}</b><span>Test emails sent</span></div>
        <div className="card stat"><b>{active}</b><span>In progress now</span></div>
        <div className="card stat"><b title={status.lastTick ?? ""}>{status.lastTick ? ago(status.lastTick) : "never"}</b><span>Worker last ran</span></div>
      </div>

      {runs.length === 0 ? (
        <div className="card">
          <Empty title="No runs yet">
            <p>Paste a list of company domains and the system will read each site, decide whether it fits, find one named person and write an email.</p>
            {canRun ? <Link href="/runs/new" className="btn primary">Start your first run</Link> : <p>An operator can start one.</p>}
          </Empty>
        </div>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Run</th><th>Progress</th><th className="num">Domains</th><th className="num">Sent</th><th>Needs you</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const needs = (r.counts.review ?? 0) + (r.counts.held ?? 0) + (r.counts.unknown ?? 0) + (r.counts.failed ?? 0);
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/runs/${r.id}`}><strong>{r.note || `Run of ${plural(r.domain_count, "domain")}`}</strong></Link>
                      <div className="small muted">{dateTime(r.created_at)} · {r.source === "csv" ? "CSV" : "pasted"}{r.paused ? " · paused" : ""}</div>
                    </td>
                    <td><Meter counts={r.counts} /></td>
                    <td className="num">{r.domain_count}</td>
                    <td className="num">{r.counts.sent ?? 0}</td>
                    <td>{needs ? <Link href="/review">{needs} waiting</Link> : <span className="muted">Nothing</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

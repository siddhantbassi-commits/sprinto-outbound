import Link from "next/link";
import { readEnv } from "@/lib/env";

export const metadata = { title: "Not found" };

export default function NotFound() {
  const demo = readEnv().mode === "demo";
  return (
    <section className="card stack" style={{ maxWidth: 640, margin: "48px auto" }} aria-labelledby="nf-title">
      <h1 id="nf-title" style={{ margin: 0 }}>{demo ? "That sample record is not on this server" : "This page could not be found"}</h1>
      {demo ? (
        <>
          <p style={{ margin: 0 }}>
            The public demo keeps its sample workspace in a server&apos;s memory, and the host can answer a request from a different
            server than the one that created it, or restart a quiet one. When that happens a run or a company you just opened is
            missing here, even though it worked a moment ago.
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            Nothing is wrong with your browser. Go back to Today and start again: the eight sample companies and the work already done on
            them are always there. The real app keeps everything in a database, so this cannot happen there.
          </p>
        </>
      ) : (
        <p className="muted" style={{ margin: 0 }}>The page may have moved, or the address may be mistyped.</p>
      )}
      <div className="row" style={{ gap: 8 }}>
        <Link className="btn primary" href="/">Go to Today</Link>
        <Link className="btn" href="/leads">See the leads</Link>
      </div>
    </section>
  );
}

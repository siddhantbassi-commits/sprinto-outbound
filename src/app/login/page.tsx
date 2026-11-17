import { redirect } from "next/navigation";
import { requestLink } from "./actions";
import { Icon } from "@/components/icons";
import { Banner } from "@/components/ui";
import { readEnv } from "@/lib/env";

export const metadata = { title: "Sign in" };

const STEPS = [
  "Paste a list of company domains.",
  "Each site is read and judged against your ideal customer, with the evidence kept.",
  "A named person is found, and a short email is drafted from what the site says.",
  "You approve what goes out. In test mode it goes only to your own inbox.",
];

export default async function Login({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const env = readEnv();
  if (env.mode === "demo") redirect("/");
  const q = await searchParams;
  return (
    <main className="auth">
      <section className="auth-hero" aria-label="About Sprinto Outbound">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark" aria-hidden>S</span>
          <span className="brand-text"><b>Sprinto Outbound</b><small>Outreach, defensibly</small></span>
        </div>
        <div className="stack" style={{ gap: 18 }}>
          <h1>Research that <em>shows its working.</em></h1>
          <p>From a list of domains to a reviewed, well-grounded email, with every score traced to a quote from the company&rsquo;s own site.</p>
          <ol className="auth-steps">{STEPS.map((x) => <li key={x}>{x}</li>)}</ol>
        </div>
        <p className="small" style={{ display: "flex", gap: 8, alignItems: "center", margin: 0, opacity: 0.85 }}>
          <Icon name="shield" />Test mode: nothing is ever sent to a prospect.
        </p>
      </section>

      <section className="auth-form" aria-label="Sign in">
        <div className="card stack">
          <div>
            <span className="eyebrow">Invite only</span>
            <h2 style={{ fontSize: "1.5rem", marginTop: 8 }}>Sign in</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>Use your work email. If it has been invited, a one-time sign-in link is on its way. There is no password to remember.</p>
          </div>
          {q.sent ? <Banner tone="good" title="Check your email">If that address has been invited, a link has been sent. It works once, and it expires soon.</Banner> : null}
          {q.error === "send" ? <Banner tone="warn" title="The email could not be sent just now">The mail service is busy or rate-limited. Wait a few minutes and try once more.</Banner> : q.error ? <Banner tone="bad" title="That link did not work">It may have expired or been used already. Ask for a new one below.</Banner> : null}
          {!env.supabase ? <Banner tone="warn" title="Not set up yet">Supabase is not configured, so nobody can sign in. See supabase/README.md.</Banner> : null}
          <form action={requestLink} className="stack">
            <label>
              Work email
              <input type="email" name="email" required autoComplete="email" autoFocus placeholder="you@company.com" />
            </label>
            <button className="btn primary large" type="submit" disabled={!env.supabase}>Email me a sign-in link<Icon name="arrow" /></button>
          </form>
          <p className="small muted" style={{ margin: 0 }}>Need access? Ask an admin to invite you. Every action here is recorded with your name.</p>
        </div>
      </section>
    </main>
  );
}

import { redirect } from "next/navigation";
import { requestLink } from "./actions";
import { Banner } from "@/components/ui";
import { readEnv } from "@/lib/env";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const env = readEnv();
  if (env.mode === "demo") redirect("/");
  const q = await searchParams;
  return (
    <main className="login">
      <div className="card stack">
        <div>
          <h1>Sprinto Outbound</h1>
          <p className="muted">Sign in with your work email. This is invite-only: if your address has been invited, a sign-in link is on its way.</p>
        </div>
        {q.sent ? <Banner tone="good" title="Check your email">If that address has been invited, a link has been sent. It works once.</Banner> : null}
        {q.error ? <Banner tone="bad" title="That link did not work">It may have expired or been used already. Ask for a new one below.</Banner> : null}
        {!env.supabase ? <Banner tone="warn" title="Not set up yet">Supabase is not configured, so nobody can sign in. See supabase/README.md.</Banner> : null}
        <form action={requestLink} className="stack">
          <label>
            Email
            <input type="email" name="email" required autoComplete="email" autoFocus placeholder="you@company.com" />
          </label>
          <button className="btn primary" type="submit" disabled={!env.supabase}>Email me a sign-in link</button>
        </form>
      </div>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { NavLinks, type NavItem } from "@/components/nav";
import { Banner } from "@/components/ui";
import { needsAttention } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";
import { setDemoRole } from "../demo/actions";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { admin: "Admin", operator: "Operator", viewer: "Viewer", pending: "Waiting for approval" };

export default async function AppLayout({ children }: { children: ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");

  const demo = s.mode === "demo";
  const demoBar = demo ? (
    <div className="demo-bar">
      <strong>Demo mode</strong>
      <span>Sample companies, a pretend model and a pretend inbox. Nothing here is real and nothing leaves this computer.</span>
      <form action={setDemoRole}>
        <label htmlFor="demo-role" style={{ color: "inherit", display: "inline" }}>View as</label>
        <select id="demo-role" name="role" defaultValue={s.user.role}>
          <option value="admin">Admin</option>
          <option value="operator">Operator</option>
          <option value="viewer">Viewer</option>
          <option value="pending">New, not approved</option>
        </select>
        <button className="btn small" type="submit">Switch</button>
      </form>
    </div>
  ) : null;

  if (s.user.role === "pending") {
    return (
      <>
        {demoBar}
        <main className="login">
          <div className="card stack">
            <h1>Waiting for approval</h1>
            <Banner tone="info" title={`Signed in as ${s.user.email}`}>
              Your account exists but has not been given access yet. Ask an admin to approve it. Until then you cannot see anything here.
            </Banner>
            {demo ? null : <form action="/auth/signout" method="post"><button className="btn" type="submit">Sign out</button></form>}
          </div>
        </main>
      </>
    );
  }

  const attention = (await needsAttention(s.db)).filter((p) => p.lane !== "needs_more" && p.lane !== "no_contact").length;
  const role = s.user.role;
  const items: NavItem[] = [
    { href: "/", label: "Runs" },
    ...(role === "operator" || role === "admin" ? [{ href: "/runs/new", label: "New run" }] : []),
    { href: "/review", label: "Needs attention", badge: attention },
    { href: "/impact", label: "Impact" },
    { href: "/quality", label: "Quality" },
    { href: "/ask", label: "Ask" },
    { href: "/icp", label: "ICP and replay" },
    { href: "/settings", label: "Settings" },
    ...(role === "admin" ? [{ href: "/people", label: "People" }] : []),
    ...(demo ? [{ href: "/outbox", label: "Test inbox" }] : []),
  ];

  return (
    <>
      {demoBar}
      <div className="shell">
        <aside className="side">
          <Link href="/" className="brand"><span className="brand-mark" aria-hidden>S</span> Sprinto Outbound</Link>
          <NavLinks items={items} className="nav" />
          <div className="side-foot">
            <strong title={s.user.email}>{s.user.email}</strong>
            {ROLE_LABEL[role]}
            {demo ? null : (
              <form action="/auth/signout" method="post" style={{ marginTop: 8 }}>
                <button className="btn small" type="submit">Sign out</button>
              </form>
            )}
          </div>
        </aside>
        <div>
          <div className="topbar"><NavLinks items={items} /></div>
          <main className="main">{children}</main>
        </div>
      </div>
    </>
  );
}

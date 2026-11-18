import { cookies } from "next/headers";
import { NoticeBell } from "@/components/notice-bell";
import { RunWatcher } from "@/components/run-watcher";
import { TourButton, WelcomeTour } from "@/components/welcome-tour";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CommandPalette, SearchButton, type PaletteItem } from "@/components/command-palette";
import { Icon } from "@/components/icons";
import { NavLinks, type NavItem } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { ToastHost } from "@/components/toast";
import { Banner } from "@/components/ui";
import { LANES } from "@/lib/app/format";
import { companyIndex, currentSettings, needsAttention } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";
import { setDemoRole } from "../demo/actions";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { admin: "Admin", operator: "Operator", viewer: "Viewer", pending: "Awaiting approval" };
const initials = (email: string) => (email.split("@")[0] ?? "?").replace(/[^a-z0-9]+/gi, " ").trim().split(" ").slice(0, 2).map((x) => x[0]?.toUpperCase() ?? "").join("") || "?";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");

  const demo = s.mode === "demo";
  const demoBar = demo ? (
    <div className="demo-bar">
      <strong>Demo mode</strong>
      <span>Sample companies and a scripted model. No real mail is sent and nothing is sent anywhere.</span>
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
            <h1>Awaiting approval</h1>
            <Banner tone="info" title={`Signed in as ${s.user.email}`}>
              The account exists but has not been granted access. An admin can approve it from People.
            </Banner>
            {demo ? null : <form action="/auth/signout" method="post"><button className="btn" type="submit">Sign out</button></form>}
          </div>
        </main>
      </>
    );
  }

  const [needs, companies, settings, themeCookie] = await Promise.all([needsAttention(s.db), companyIndex(s.db), currentSettings(s.db), cookies().then((c) => c.get("theme")?.value)]);
  const attention = needs.filter((p) => p.lane !== "needs_more" && p.lane !== "no_contact").length;
  const role = s.user.role;
  const canRun = role === "operator" || role === "admin";
  const items: NavItem[] = [
    { href: "/", label: "Today", icon: "pulse", group: "Work" },
    ...(canRun ? [{ href: "/discover", label: "Discover", icon: "search", group: "Work" } as NavItem] : []),
    { href: "/runs", label: "Runs", icon: "runs", group: "Work" },
    ...(canRun ? [{ href: "/runs/new", label: "Paste a list", icon: "list", group: "Work" } as NavItem] : []),
    { href: "/leads", label: "Leads", icon: "target", group: "Work" },
    { href: "/digest", label: "Weekly digest", icon: "mail", group: "Work" },
    { href: "/review", label: "Review", icon: "bell", group: "Work", badge: attention },
    { href: "/impact", label: "Impact", icon: "chart", group: "Insight" },
    { href: "/scorecard", label: "Scorecard", icon: "flag", group: "Insight" },
    { href: "/learning", label: "What is working", icon: "spark", group: "Insight" },
    { href: "/quality", label: "Quality", icon: "pulse", group: "Insight" },
    { href: "/ask", label: "Ask", icon: "chat", group: "Insight" },
    { href: "/rulebook", label: "Rulebook", icon: "book", group: "Control" },
    { href: "/icp", label: "ICP and replay", icon: "target", group: "Control" },
    { href: "/settings", label: "Settings", icon: "sliders", group: "Control" },
    { href: "/golive", label: "Go-live readiness", icon: "shield", group: "Control" },
    ...(role === "admin" ? [{ href: "/people", label: "People", icon: "people", group: "Control" } as NavItem] : []),
    ...(demo ? [{ href: "/outbox", label: "Test inbox", icon: "mail", group: "Control" } as NavItem] : []),
  ];
  const palette: PaletteItem[] = [
    ...items.map((i) => ({ id: `nav-${i.href}`, label: i.label, href: i.href, icon: i.icon, group: "Go to" as const })),
    { id: "act-tour", label: "Take the tour", hint: "A one-minute walkthrough", href: "/", icon: "help" as const, group: "Actions" as const, action: "tour" as const },
    ...companies.map((c) => ({ id: `co-${c.id}`, label: c.domain, hint: LANES[c.lane]?.label ?? c.lane, href: `/prospects/${c.id}`, icon: "globe" as const, group: "Companies" as const })),
  ];

  const testTo = settings?.test_to ?? null;
  const safe = demo ? { on: true, title: "Demo mode", text: "No real mail is sent." } : testTo ? { on: true, title: "Test mode", text: `Mail goes only to ${testTo}` } : { on: false, title: "Sending is off", text: "No test address is set." };
  const theme = themeCookie === "light" || themeCookie === "dark" ? themeCookie : "auto";

  return (
    <>
      <a className="skip" href="#content">Skip to content</a>
      {demoBar}
      <div className="shell">
        <aside className="side">
          <Link href="/" className="brand" aria-label="Sprinto Outbound home">
            <span className="brand-mark" aria-hidden>S</span>
            <span className="brand-text"><b>Sprinto Outbound</b><small>Outreach, defensibly</small></span>
          </Link>
          <NavLinks items={items} className="nav" />
          <div className="side-foot">
            <div className={`safe-chip${safe.on ? "" : " off"}`}>
              <Icon name={safe.on ? "shield" : "lock"} />
              <span><b>{safe.title}</b>{safe.text}</span>
            </div>
            <div className="me">
              <span className="avatar" aria-hidden>{initials(s.user.email)}</span>
              <span className="me-text"><b title={s.user.email}>{s.user.email}</b><span>{ROLE_LABEL[role]}</span></span>
              {demo ? null : (
                <form action="/auth/signout" method="post">
                  <button className="icon-btn" type="submit" title="Sign out" aria-label="Sign out"><Icon name="logout" /></button>
                </form>
              )}
            </div>
          </div>
        </aside>
        <div className="canvas">
          <div className="topbar"><NavLinks items={items} /></div>
          <div className="appbar">
            <SearchButton />
            <span className="grow" />
            <NoticeBell />
            <TourButton />
            <ThemeToggle current={theme} />
          </div>
          <main className="main" id="content">{children}</main>
        </div>
      </div>
      <CommandPalette items={palette} />
      <ToastHost />
      <RunWatcher />
      <WelcomeTour canRun={canRun} />
    </>
  );
}

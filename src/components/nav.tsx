"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  group: "Work" | "Insight" | "Control";
  badge?: number;
}

const GROUPS: NavItem["group"][] = ["Work", "Insight", "Control"];

export function NavLinks({ items, className }: { items: NavItem[]; className?: string }): ReactNode {
  const path = usePathname();
  const active = (href: string) => {
    if (href === "/") return path === "/";
    // A company's brief belongs to Leads; its Why page and its run belong to Runs.
    if (href === "/leads") return path === "/leads" || path.startsWith("/leads/") || /^\/prospects\/[^/]+\/brief/.test(path);
    if (href === "/runs") return path === "/runs" || (path.startsWith("/runs/") && path !== "/runs/new") || (path.startsWith("/prospects/") && !/\/brief/.test(path));
    return path === href || path.startsWith(`${href}/`);
  };
  return (
    <nav className={className} aria-label="Main">
      {GROUPS.map((g) => {
        const here = items.filter((i) => i.group === g);
        if (here.length === 0) return null;
        return (
          <div key={g} role="group" aria-label={g}>
            <div className="nav-group" aria-hidden>{g}</div>
            {here.map((i) => (
              <Link key={i.href} href={i.href} data-tour={`nav${i.href}`} aria-current={active(i.href) ? "page" : undefined}>
                <Icon name={i.icon} />
                {i.label}
                {i.badge ? <span className="count" aria-label={`${i.badge} waiting`}>{i.badge}</span> : null}
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

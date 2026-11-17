"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

export function NavLinks({ items, className }: { items: NavItem[]; className?: string }): ReactNode {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/runs/") && path !== "/runs/new" || path.startsWith("/prospects/") : path === href || path.startsWith(`${href}/`));
  return (
    <nav className={className} aria-label="Main">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined}>
          {i.label}
          {i.badge ? <span className="count">{i.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/workbench/program", match: ["/workbench"], label: "Workbench" },
  { href: "/review", match: ["/review"], label: "Code review" },
  { href: "/docs", match: ["/docs", "/guide", "/isa"], label: "Docs" },
  { href: "/faq", match: ["/faq"], label: "FAQ" },
];

export function SiteNav() {
  const path = usePathname() ?? "/";
  return (
    <nav className="site-nav" aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.match.some((m) => path.startsWith(m)) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

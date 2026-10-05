"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS } from "@/lib/content/docs";

/** Documentation sidebar; becomes a compact wrapped list on small screens. */
export function DocsNav() {
  const path = usePathname() ?? "";
  return (
    <nav aria-label="Documentation" className="docs-nav">
        {DOCS.map((g) => (
          <div key={g.title} className="docs-nav__group">
            <p className="docs-nav__title">{g.title}</p>
            <ul>
              {g.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} aria-current={path === l.href ? "page" : undefined}>
                    {l.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </nav>
  );
}

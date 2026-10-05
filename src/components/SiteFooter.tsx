import Link from "next/link";
import { BrandMark } from "./Brand";
import { SITE } from "@/lib/site";

const GROUPS: { title: string; links: [string, string][] }[] = [
  {
    title: "Product",
    links: [
      ["Run the demo", "/try"],
      ["Workbench", "/workbench/program"],
      ["Code review", "/review"],
    ],
  },
  {
    title: "Docs",
    links: [
      ["Guide", "/guide"],
      ["Review rules", "/docs/review-rules"],
      ["Troubleshooting", "/docs/troubleshooting"],
      ["FAQ", "/faq"],
    ],
  },
  {
    title: "Legal",
    links: [
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["MIT License", "/license"],
    ],
  },
];

/** Minimal site footer: brand and promise, three link groups, one line of fine print. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <Link href="/" className="brand brand--footer">
            <BrandMark size={22} />
            <span>{SITE.name}</span>
          </Link>
          <p>{SITE.tagline}. Free and open source. Your files never leave this device.</p>
        </div>
        <nav aria-label="Footer" className="site-footer__nav">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h2 className="site-footer__title">{g.title}</h2>
              <ul>
                {g.links.map(([label, href]) => (
                  <li key={href}>
                    <Link href={href}>{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="site-footer__base">
        <span>
          © {new Date().getFullYear()} {SITE.author}
        </span>
        <span>
          <a href={SITE.repo}>Source on GitHub</a>
          <span aria-hidden="true"> · </span>
          <Link href="/privacy#analytics">Analytics choices</Link>
        </span>
      </div>
    </footer>
  );
}

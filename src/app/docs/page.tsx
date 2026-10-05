import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/DocPage";
import { DOCS, TASKS } from "@/lib/content/docs";

const DESCRIPTION =
  "Pipelith documentation: the fastest path for each task, the full guide, check-comment syntax, every code review rule, a glossary of pipeline terms and troubleshooting.";

export const metadata: Metadata = {
  title: "Documentation",
  description: DESCRIPTION,
  alternates: { canonical: "/docs" },
};

export default function DocsHome() {
  return (
    <DocPage path="/docs" title="Documentation" description={DESCRIPTION} lede="Pick what you want to do; each row is the shortest path to it.">
      <section aria-labelledby="tasks-h" className="stack stack--tight">
        <h2 id="tasks-h">I want to…</h2>
        <ul className="tasks">
          {TASKS.map((t) => (
            <li key={t.goal}>
              <Link href={t.href} className="tasks__row">
                <span className="tasks__goal">{t.goal}</span>
                <span className="tasks__action">{t.action} →</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {DOCS.map((g) => (
        <section key={g.title} aria-labelledby={`g-${g.title}`} className="stack stack--tight">
          <h2 id={`g-${g.title}`}>{g.title}</h2>
          <ul className="doc-cards">
            {g.links
              .filter((l) => l.href !== "/docs")
              .map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="doc-card">
                    <strong>{l.title}</strong>
                    <span className="small muted">{l.summary}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </DocPage>
  );
}

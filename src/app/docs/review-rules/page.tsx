import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/DocPage";
import { Badge } from "@/components/ui";
import { RULE_CATEGORIES, RULES } from "@/lib/review/rules";

const DESCRIPTION = `All ${RULES.length} VHDL code review rules in Pipelith — syntax, structure, connectivity, processes, pipeline and style — with what each catches, why it matters and how to fix it.`;

export const metadata: Metadata = {
  title: "Code review rules",
  description: DESCRIPTION,
  alternates: { canonical: "/docs/review-rules" },
};

const SEV = { error: ["Error", "fail"], warning: ["Warning", "warn"], info: ["Note", undefined] } as const;

export default function ReviewRulesPage() {
  return (
    <DocPage
      path="/docs/review-rules"
      title="Code review rules"
      description={DESCRIPTION}
      lede={
        <>
          Every check <Link href="/review">Code review</Link> runs. <strong>Errors</strong> stop a compiler or simulator, or are certainly
          wrong; <strong>warnings</strong> are likely bugs; <strong>notes</strong> are suggestions. Each finding in a review links here.
        </>
      }
    >
      <nav aria-label="Rule categories" className="chips">
        {RULE_CATEGORIES.map((c) => (
          <a key={c} href={`#cat-${c.toLowerCase()}`} className="chip">
            {c} <span className="muted">{RULES.filter((r) => r.category === c).length}</span>
          </a>
        ))}
      </nav>
      {RULE_CATEGORIES.map((c) => (
        <section key={c} id={`cat-${c.toLowerCase()}`} aria-labelledby={`h-${c}`} className="stack stack--tight">
          <h2 id={`h-${c}`}>{c}</h2>
          <ul className="rules">
            {RULES.filter((r) => r.category === c).map((r) => (
              <li key={r.id} id={r.id} className="rule">
                <div className="rule__head">
                  <Badge tone={SEV[r.severity][1]}>{SEV[r.severity][0]}</Badge>
                  <h3>{r.title}</h3>
                  <a href={`#${r.id}`} className="mono xsmall muted rule__id" aria-label={`Link to rule ${r.id}`}>
                    {r.id}
                  </a>
                </div>
                <p className="small">{r.why}</p>
                <p className="small">
                  <strong>Fix:</strong> {r.fix}
                </p>
                {r.alt && <p className="xsmall muted">Severity: {SEV[r.severity][0].toLowerCase()}, or {r.alt}.</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </DocPage>
  );
}

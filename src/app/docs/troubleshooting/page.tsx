import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/DocPage";
import { PROBLEM_GROUPS, PROBLEMS } from "@/lib/content/troubleshooting";

const DESCRIPTION =
  "Fixes for common Pipelith problems: .zip uploads and the structure check, missing packages and headers, assembler errors, GHDL, Icarus Verilog, Verilator and ModelSim compile problems, VHDL-2008, unmapped signals, short waveforms and timing differences.";

export const metadata: Metadata = {
  title: "Troubleshooting",
  description: DESCRIPTION,
  alternates: { canonical: "/docs/troubleshooting" },
};

const slug = (g: string) => g.toLowerCase().replace(/[^a-z]+/g, "-");

export default function TroubleshootingPage() {
  return (
    <DocPage
      path="/docs/troubleshooting"
      title="Troubleshooting"
      description={DESCRIPTION}
      lede="Find the message you see; each entry says why it happens and what to do."
      extraLd={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: PROBLEMS.map((p) => ({
          "@type": "Question",
          name: p.symptom.replace(/[“”]/g, ""),
          acceptedAnswer: { "@type": "Answer", text: [p.answer, ...(p.steps ?? [])].join(" ") },
        })),
      }}
    >
      <nav aria-label="Problem areas" className="chips">
        {PROBLEM_GROUPS.map((g) => (
          <a key={g} href={`#${slug(g)}`} className="chip">
            {g}
          </a>
        ))}
      </nav>
      {PROBLEM_GROUPS.map((g) => (
        <section key={g} id={slug(g)} aria-labelledby={`h-${slug(g)}`} className="stack stack--tight">
          <h2 id={`h-${slug(g)}`}>{g}</h2>
          <div className="faq-list">
            {PROBLEMS.filter((p) => p.group === g).map((p) => (
              <details key={p.id} id={p.id} className="faq-item">
                <summary>{p.symptom}</summary>
                <div className="stack stack--tight small">
                  <p>{p.answer}</p>
                  {p.steps && (
                    <ol>
                      {p.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                  )}
                  {p.link && (
                    <p>
                      <Link href={p.link.href}>{p.link.label} →</Link>
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
      <p className="muted small">
        Still stuck? Read the <Link href="/guide">Guide</Link> or the <Link href="/faq">FAQ</Link>, or open an issue on the project&apos;s
        GitHub page.
      </p>
    </DocPage>
  );
}

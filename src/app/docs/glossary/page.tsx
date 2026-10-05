import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/DocPage";
import { GLOSSARY } from "@/lib/content/glossary";
import { SITE } from "@/lib/site";

const DESCRIPTION =
  "Plain definitions of pipeline and processor-verification terms: hazards, forwarding, stalls, load-use, branch resolution, reference models, testbenches, VCD and more.";

export const metadata: Metadata = {
  title: "Glossary of pipeline terms",
  description: DESCRIPTION,
  alternates: { canonical: "/docs/glossary" },
};

export default function GlossaryPage() {
  const terms = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
  return (
    <DocPage
      path="/docs/glossary"
      title="Glossary"
      description={DESCRIPTION}
      lede="The words Pipelith uses, one sentence each."
      extraLd={{
        "@context": "https://schema.org",
        "@type": "DefinedTermSet",
        name: `${SITE.name} glossary`,
        url: `${SITE.url}/docs/glossary`,
        hasDefinedTerm: terms.map((t) => ({
          "@type": "DefinedTerm",
          name: t.term,
          description: t.definition,
          url: `${SITE.url}/docs/glossary#${t.id}`,
        })),
      }}
    >
      <dl className="glossary">
        {terms.map((t) => (
          <div key={t.id} id={t.id} className="glossary__item">
            <dt>{t.term}</dt>
            <dd>
              {t.definition}
              {t.see && (
                <>
                  {" "}
                  <Link href={t.see.href} className="small">
                    {t.see.label} →
                  </Link>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </DocPage>
  );
}

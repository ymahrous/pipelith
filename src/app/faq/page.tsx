import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { FAQ } from "@/lib/content/faq";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description:
    "Answers about Pipelith: what to upload, how to structure the .zip, 5- vs 6-stage pipelines, forwarding settings, waveform comparison, privacy and cost.",
  alternates: { canonical: "/faq" },
  openGraph: { title: "Pipelith FAQ", url: "/faq" },
};

const slugOf = (q: string) =>
  q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

export default function FaqPage() {
  const groups = [...new Set(FAQ.map((f) => f.group))];
  return (
    <div className="step">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: SITE.url + "/" },
            { "@type": "ListItem", position: 2, name: "FAQ", item: SITE.url + "/faq" },
          ],
        }}
      />
      <header className="step-head">
        <h1>Frequently asked questions</h1>
        <p>
          Short answers first. For step-by-step instructions see the <Link href="/guide">Guide</Link>.
        </p>
      </header>
      <div className="split">
        <div className="stack">
          {groups.map((g) => (
            <section key={g} className="stack stack--tight" aria-labelledby={`g-${slugOf(g)}`}>
              <h2 id={`g-${slugOf(g)}`}>{g}</h2>
              <div className="faq-list">
                {FAQ.filter((f) => f.group === g).map((f) => (
                  <details key={f.q} id={slugOf(f.q)} className="faq-item">
                    <summary>
                      <h3>{f.q}</h3>
                    </summary>
                    <p>{f.a}</p>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
        <aside className="panel stack stack--tight" aria-label="More help">
          <h2>Still stuck?</h2>
          <ul className="prose small">
            <li>
              <Link href="/guide#needs">What each option needs</Link>
            </li>
            <li>
              <Link href="/review">Code review, with the .zip structure guide</Link>
            </li>
            <li>
              <Link href="/privacy">Privacy policy</Link> and <Link href="/terms">terms</Link>
            </li>
            <li>
              Report a problem on <a href={SITE.repo}>GitHub</a>
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}

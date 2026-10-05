import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of use",
  description:
    "Terms for using Pipelith: free, no account, your files stay yours and on your device, provided as is without warranty, MIT-licensed source.",
  alternates: { canonical: "/terms" },
};

const TOC = [
  ["agreement", "Agreement"],
  ["service", "The service"],
  ["content", "Your content"],
  ["use", "Acceptable use"],
  ["output", "Results and generated files"],
  ["license", "Software license"],
  ["third", "Third-party tools and services"],
  ["warranty", "No warranty"],
  ["liability", "Limitation of liability"],
  ["changes", "Changes and availability"],
  ["law", "Governing law"],
  ["contact", "Contact"],
] as const;

export default function TermsPage() {
  return (
    <div className="step">
      <header className="step-head">
        <h1>Terms of use</h1>
        <p>Last updated {SITE.legalUpdatedText}.</p>
      </header>
      <div className="split">
        <article className="prose stack legal">
          <section id="agreement" className="stack stack--tight">
            <h2>1. Agreement</h2>
            <p>
              These terms apply to your use of the Pipelith website operated by {SITE.author} (“we”, “us”). By
              using the site you agree to them. If you don&apos;t agree, please don&apos;t use the site. Our{" "}
              <Link href="/privacy">privacy policy</Link> explains how data is handled and is part of these terms.
            </p>
          </section>

          <section id="service" className="stack stack--tight">
            <h2>2. The service</h2>
            <p>
              Pipelith helps you review, assemble, simulate and compare pipelined processor designs. It is free,
              needs no account, and runs in your browser. Features may change over time.
            </p>
          </section>

          <section id="content" className="stack stack--tight">
            <h2>3. Your content</h2>
            <ul>
              <li>
                <strong>You keep all rights</strong> to the code, programs, waveforms and other material you open in the
                app. We claim no ownership or license over it.
              </li>
              <li>
                <strong>We never receive it.</strong> Your material is processed on your own device. Because of that, we
                can&apos;t recover it for you — keep your own copies.
              </li>
              <li>
                Only open material you have the right to use. If you share a share link, you are responsible for who sees
                the program in it.
              </li>
            </ul>
          </section>

          <section id="use" className="stack stack--tight">
            <h2>4. Acceptable use</h2>
            <p>Please don&apos;t:</p>
            <ul>
              <li>attack, probe or overload the site or its hosting, or try to get around its security measures;</li>
              <li>use automated tools to request pages at a rate that degrades the service for others;</li>
              <li>use the site to break the law or infringe anyone&apos;s rights;</li>
              <li>present the site, its name or its results as endorsing a product or certification it doesn&apos;t.</li>
            </ul>
            <p>Responsible security research reported under our security policy is welcome.</p>
          </section>

          <section id="output" className="stack stack--tight">
            <h2>5. Results and generated files</h2>
            <p>
              Reviews, simulations, timing estimates, comparisons, testbenches, scripts and reports are produced
              automatically. They can be incomplete or wrong — static analysis can miss bugs and report false positives,
              and the reference model and timing estimate are interpretations of a specification. You may use generated
              files for any purpose. The guide, documentation, rule descriptions and troubleshooting advice are general
              information, not a guarantee that following them makes a design correct. Read generated scripts before running
              them, and{" "}
              <strong>
                don&apos;t rely on the site as the only verification for designs where failure could cause harm, financial
                loss or a safety risk
              </strong>
              .
            </p>
          </section>

          <section id="license" className="stack stack--tight">
            <h2>6. Software license</h2>
            <p>
              The source code of Pipelith is available under the <Link href="/license">MIT License</Link>. That
              license governs copying, changing and redistributing the software; these terms govern use of this website.
            </p>
          </section>

          <section id="third" className="stack stack--tight">
            <h2>7. Third-party tools and services</h2>
            <p>
              The hardware step relies on simulators such as GHDL, ModelSim, Questa or Vivado, which you obtain and run
              under their own terms. The site may be hosted and measured by Vercel as described in the privacy policy. Links
              to other sites are provided for convenience; we aren&apos;t responsible for their content.
            </p>
          </section>

          <section id="warranty" className="stack stack--tight">
            <h2>8. No warranty</h2>
            <p>
              The site and everything it produces are provided <strong>“as is” and “as available”</strong>, without
              warranties of any kind, express or implied, including fitness for a particular purpose, accuracy and
              non-infringement, to the extent the law allows.
            </p>
          </section>

          <section id="liability" className="stack stack--tight">
            <h2>9. Limitation of liability</h2>
            <p>
              To the extent the law allows, we are not liable for indirect, incidental or consequential damages, or for loss
              of data, profits or time, arising from use of the site or its results. Because the service is free, our total
              liability for any claim is limited to zero, except where the law doesn&apos;t allow liability to be limited —
              for example for intent or gross negligence, or under mandatory consumer law where you live.
            </p>
          </section>

          <section id="changes" className="stack stack--tight">
            <h2>10. Changes and availability</h2>
            <p>
              We may change, suspend or stop the site, or update these terms. The date at the top shows the latest version;
              continuing to use the site after a change means you accept it. Nothing you store lives on our side, so a
              change never deletes your work.
            </p>
          </section>

          <section id="law" className="stack stack--tight">
            <h2>11. Governing law</h2>
            <p>
              These terms are governed by the laws that apply at the operator&apos;s place of residence, without prejudice to
              mandatory consumer protection rules of the country where you live. If a provision is found invalid, the rest
              stays in effect.
            </p>
          </section>

          <section id="contact" className="stack stack--tight">
            <h2>12. Contact</h2>
            <p>
              Questions about these terms: open an issue or use the contact details on the project&apos;s{" "}
              <a href={SITE.repo}>GitHub page</a>.
            </p>
          </section>
        </article>
        <aside className="panel stack stack--tight" aria-label="On this page">
          <h2>On this page</h2>
          <ul className="prose small">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

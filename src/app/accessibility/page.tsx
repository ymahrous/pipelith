import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Accessibility statement",
  description:
    "Pipelith aims to meet WCAG 2.2 level AA: keyboard and screen-reader access, dark mode, larger text, a high-legibility typeface and reduced motion. Known limitations and how to report a problem.",
  alternates: { canonical: "/accessibility" },
};

const TOC = [
  ["commitment", "Our commitment"],
  ["status", "Conformance status"],
  ["features", "What you can expect"],
  ["settings", "Display settings"],
  ["limitations", "Known limitations"],
  ["compatibility", "Compatibility"],
  ["method", "How we check"],
  ["feedback", "Feedback and contact"],
  ["enforcement", "If you are not satisfied"],
] as const;

export default function AccessibilityPage() {
  return (
    <div className="step">
      <header className="step-head">
        <h1>Accessibility statement</h1>
        <p>Last updated {SITE.legalUpdatedText}.</p>
      </header>
      <div className="split">
        <article className="prose stack legal">
          <section id="commitment" className="stack stack--tight">
            <h2>Our commitment</h2>
            <p>
              {SITE.name} should work for every student and engineer who designs processors, whatever their eyesight, hearing,
              mobility or way of reading. We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA, the
              W3C standard that also underlies EN 301 549 in the European Union, Section 508 in the United States and similar
              rules elsewhere.
            </p>
          </section>

          <section id="status" className="stack stack--tight">
            <h2>Conformance status</h2>
            <p>
              <strong>Partially conformant.</strong> The site is designed and tested against WCAG 2.2 AA, and we fix every
              problem we find, but it has not been audited by an independent organisation and the limitations below remain.
            </p>
          </section>

          <section id="features" className="stack stack--tight">
            <h2>What you can expect</h2>
            <ul>
              <li>
                <strong>Keyboard:</strong> every feature works without a mouse. A <em>Skip to content</em> link comes first, focus
                is always visible, tabs follow the usual arrow-key pattern, and menus close with Escape.
              </li>
              <li>
                <strong>Screen readers:</strong> pages use headings, landmarks and labelled controls; results, errors and
                “copied” messages are announced; status is never shown by colour alone (every badge has a word: Error, Warning,
                Match).
              </li>
              <li>
                <strong>Reading:</strong> plain language, one idea per sentence, every term defined in the{" "}
                <Link href="/docs/glossary">glossary</Link>, and a <Link href="/docs/start">Getting started</Link> page for
                newcomers.
              </li>
              <li>
                <strong>Zoom and reflow:</strong> text resizes to 200% and pages reflow down to 320 pixels wide without sideways
                scrolling, apart from wide data tables, which scroll on their own.
              </li>
              <li>
                <strong>Contrast:</strong> text meets at least 4.5:1 against its background in both the light and dark themes.
              </li>
              <li>
                <strong>No time limits</strong> and nothing that flashes. Animations stop when you ask for reduced motion.
              </li>
              <li>
                <strong>Help:</strong> errors say what went wrong and how to fix it, and every review finding links to its rule.
              </li>
            </ul>
          </section>

          <section id="settings" className="stack stack--tight">
            <h2>Display settings</h2>
            <p>
              <strong>Display</strong> at the top of every page lets you choose light or dark colours (or follow your device),
              larger text, the <strong>Atkinson Hyperlegible</strong> typeface — designed by the Braille Institute for readers
              with low vision — instead of the default Recursive, and reduced motion. The choices are saved in this browser only;
              your browser&apos;s zoom and your system&apos;s settings keep working as well.
            </p>
          </section>

          <section id="limitations" className="stack stack--tight">
            <h2>Known limitations</h2>
            <ul>
              <li>
                The pipeline diagram and the trace in Simulate are large tables: screen readers can navigate them cell by cell,
                but reading a whole run that way is slow. The same information is in the stall breakdown, the trace text and the
                downloadable reports.
              </li>
              <li>
                Waveforms are visual by nature. The Compare step turns them into text — the first divergence, a summary and a
                table per signal — but the waveform files themselves need a viewer such as GTKWave or Surfer, which we don&apos;t
                control.
              </li>
              <li>The program editor is a plain text area without syntax colouring.</li>
              <li>Linked sites (GitHub, simulator and viewer sites, Vercel&apos;s documentation) have their own accessibility.</li>
            </ul>
          </section>

          <section id="compatibility" className="stack stack--tight">
            <h2>Compatibility</h2>
            <p>
              {SITE.name} is built with HTML, CSS, WAI-ARIA and JavaScript, and is designed for current versions of Chrome, Edge,
              Firefox and Safari on desktop and mobile, with NVDA, JAWS, VoiceOver and TalkBack.
            </p>
          </section>

          <section id="method" className="stack stack--tight">
            <h2>How we check</h2>
            <p>
              Automated end-to-end tests run on every change at desktop and phone sizes and fail on sideways scrolling and on any
              console or Content-Security-Policy error; pages are checked by hand with the keyboard and with screen readers.
            </p>
          </section>

          <section id="feedback" className="stack stack--tight">
            <h2>Feedback and contact</h2>
            <p>
              If something is hard or impossible to use, please tell us: open an issue on{" "}
              <a href={SITE.repo}>GitHub</a> with the page address, what you tried and what assistive technology you use. We read
              every report and will suggest another way to get what you need while we fix it.
            </p>
          </section>

          <section id="enforcement" className="stack stack--tight">
            <h2>If you are not satisfied</h2>
            <p>
              If our answer doesn&apos;t solve the problem, you can contact the body that enforces accessibility law where you
              live. See also our <Link href="/privacy">privacy policy</Link> and <Link href="/terms">terms of use</Link>.
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

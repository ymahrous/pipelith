import type { Metadata } from "next";
import Link from "next/link";
import { AnalyticsOptOut } from "@/components/AnalyticsOptOut";
import { SITE } from "@/lib/site";
import { ANALYTICS_OPT_OUT_KEY } from "@/lib/util/privacy";
import { DISPLAY_KEY } from "@/lib/util/display";
import { STORAGE_KEY } from "@/lib/session/session";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "How Pipelith handles data: your code, programs and waveforms are processed only in your browser; no accounts or cookies; optional cookieless Vercel analytics with opt-out; your rights under GDPR, UK GDPR, CCPA/CPRA, LGPD, PIPEDA and other laws.",
  alternates: { canonical: "/privacy" },
};

const TOC = [
  ["summary", "Summary"],
  ["who", "Who is responsible"],
  ["local", "What stays in your browser"],
  ["storage", "Browser storage"],
  ["share", "Share links"],
  ["ai", "AI assistant prompts"],
  ["analytics", "Analytics and performance measurement"],
  ["hosting", "Hosting and server logs"],
  ["cookies", "Cookies and similar technologies"],
  ["basis", "Legal bases"],
  ["retention", "How long data is kept"],
  ["transfers", "International transfers"],
  ["rights", "Your rights"],
  ["regional", "Rights in specific regions"],
  ["children", "Children"],
  ["security", "Security"],
  ["changes", "Changes to this policy"],
  ["contact", "Contact"],
] as const;

export default function PrivacyPage() {
  return (
    <div className="step">
      <header className="step-head">
        <h1>Privacy policy</h1>
        <p>Last updated {SITE.legalUpdatedText}.</p>
      </header>
      <div className="split">
        <article className="prose stack legal">
          <section id="summary" className="stack stack--tight">
            <h2>Summary</h2>
            <ul>
              <li>
                <strong>Your files never leave your device.</strong> VHDL, Verilog and SystemVerilog code, assembly programs,
                memory images, waveforms, register values and reports are opened and processed by JavaScript running in your
                browser. They are not sent to us or to anyone else.
              </li>
              <li>
                <strong>No accounts, no cookies, no advertising, no selling of data.</strong>
              </li>
              <li>
                <strong>Anonymous measurements, only on Vercel.</strong> When this site is hosted on Vercel, it counts page
                views and measures page speed with Vercel Web Analytics and Speed Insights. These use no cookies, only the page
                path is reported (never the rest of the URL), and you can switch them off below.
              </li>
            </ul>
          </section>

          <section id="who" className="stack stack--tight">
            <h2>Who is responsible</h2>
            <p>
              This site is operated by {SITE.author} (“we”, “us”). If you run your own copy of Pipelith, you are the
              operator of that copy and this policy describes only the software&apos;s default behaviour.
            </p>
          </section>

          <section id="local" className="stack stack--tight">
            <h2>What stays in your browser</h2>
            <p>Everything you give the app is handled locally:</p>
            <ul>
              <li>Programs you type or open (.asm, .mem) and their assembly, simulation and checks.</li>
              <li>Codebases you upload for Code review (.zip, folders, .vhd, .v and .sv files) and the review results.</li>
              <li>Expected waveforms and AI restructuring prompts — both are generated in your browser.</li>
              <li>Waveforms (.vcd, .vcd.gz) and final register values you upload or type for comparison.</li>
              <li>Hardware kits, reports and exports you download — they are generated in your browser.</li>
              <li>
                Files you drop on the home page&apos;s quick start. They are handed to the page that opens them inside this
                browser tab&apos;s memory and are never sent anywhere; codebases and waveforms are dropped again when you leave
                the page.
              </li>
            </ul>
            <p>
              The server never receives these files: the pages make no network requests that carry them, and the site&apos;s
              Content-Security-Policy only allows connections back to this site itself. The only file the app fetches is
              the sample material it ships with (example waveforms and the reference processor&apos;s source).
            </p>
          </section>

          <section id="storage" className="stack stack--tight">
            <h2>Browser storage</h2>
            <p>The app saves up to three things in your browser&apos;s local storage so your work survives a reload:</p>
            <ul>
              <li>
                <code>{STORAGE_KEY}</code> — your current program, IN-port values, interrupts, model and pipeline settings,
                design language, checks, typed final values and the compile order. It is not sent anywhere. Uploaded codebases
                and waveforms are <em>not</em> stored; they are dropped when you leave the page.
              </li>
              <li>
                <code>{DISPLAY_KEY}</code> — present only if you change Display settings (colours, text size, typeface, motion).
              </li>
              <li>
                <code>{ANALYTICS_OPT_OUT_KEY}</code> — present only if you opt out of measurements below.
              </li>
            </ul>
            <p>
              These entries exist only to provide what you ask for, never leave your device and identify no one. You can delete
              them at any time by clearing this site&apos;s data in your browser settings.
            </p>
          </section>

          <section id="share" className="stack stack--tight">
            <h2>Share links</h2>
            <p>
              <em>Copy share link</em> puts your program and settings into the link itself, after the <code>#</code>. Browsers
              never send that part of a URL to a server, and our measurements remove it before anything is reported. Anyone
              you give the link to can read the program, so share it only with people you trust.
            </p>
          </section>

          <section id="ai" className="stack stack--tight">
            <h2>AI assistant prompts</h2>
            <p>
              When an upload isn&apos;t structured the way Code review needs, Pipelith can write a prompt for an AI assistant.
              It is built in your browser and contains your file names, the language and pipeline depth you chose and the
              problems found — none of your code. Pipelith never sends it anywhere: you copy or download it yourself. If you
              paste it into an AI service, that service&apos;s own terms and privacy policy apply to what you send.
            </p>
          </section>

          <section id="analytics" className="stack stack--tight">
            <h2>Analytics and performance measurement</h2>
            <p>
              When the site is served by Vercel, it loads Vercel Web Analytics and Vercel Speed Insights from this site&apos;s
              own address. Copies hosted elsewhere don&apos;t load them at all, and the operator can disable them with a
              setting.
            </p>
            <ul>
              <li>
                <strong>Web Analytics</strong> counts page views. According to Vercel, it works without cookies, and visitors
                are distinguished only by a hash of the request that changes every day, so they can&apos;t be followed across
                days or sites. Reported data includes the page path, the referring site, browser, operating system, device
                type and country.
              </li>
              <li>
                <strong>Speed Insights</strong> measures how fast pages load and respond (Core Web Vitals such as LCP, INP and
                CLS) together with the page path, device type and browser.
              </li>
              <li>
                <strong>What we strip first:</strong> before any event is sent, the URL is reduced to the site address and
                the page path. Query strings and the <code>#</code> part — which holds share-link programs — are removed.
              </li>
              <li>
                <strong>When nothing is sent:</strong> if your browser sends Global Privacy Control or Do Not Track, or if you
                opt out here.
              </li>
            </ul>
            <AnalyticsOptOut />
            <p className="small">
              Vercel acts as our processor for these measurements. See Vercel&apos;s documentation on{" "}
              <a href="https://vercel.com/docs/analytics/privacy-policy">Web Analytics privacy</a> and{" "}
              <a href="https://vercel.com/docs/speed-insights/privacy-policy">Speed Insights privacy</a>, and its{" "}
              <a href="https://vercel.com/legal/privacy-policy">privacy policy</a>.
            </p>
          </section>

          <section id="hosting" className="stack stack--tight">
            <h2>Hosting and server logs</h2>
            <p>
              Like any website, the hosting provider receives technical request data — IP address, time, requested path, user
              agent — to deliver pages and protect against abuse. We don&apos;t use these logs to identify or profile anyone,
              and they never contain your files, because your files are never sent.
            </p>
          </section>

          <section id="cookies" className="stack stack--tight">
            <h2>Cookies and similar technologies</h2>
            <p>
              Pipelith sets no cookies, and neither do the measurements described above. The local-storage entries listed
              under <a href="#storage">Browser storage</a> are strictly necessary for features you use (keeping your work and
              your display choices) and are not used for tracking or advertising, so under the EU ePrivacy rules and similar
              laws no consent banner is needed.
            </p>
          </section>

          <section id="basis" className="stack stack--tight">
            <h2>Legal bases</h2>
            <p>Where the EU or UK General Data Protection Regulation applies:</p>
            <ul>
              <li>
                Delivering the site and keeping it secure, including server logs: our legitimate interest in providing a
                working, safe service (Article 6(1)(f)).
              </li>
              <li>
                Anonymous page-view and speed measurement: our legitimate interest in understanding use and keeping the site
                fast (Article 6(1)(f)), with the opt-outs above.
              </li>
              <li>
                Saving your session in local storage: done because you use the app and need your work to persist; it never
                leaves your device.
              </li>
            </ul>
          </section>

          <section id="retention" className="stack stack--tight">
            <h2>How long data is kept</h2>
            <ul>
              <li>Local storage: until you clear it or start a new program.</li>
              <li>Uploaded codebases and waveforms: only while the page is open.</li>
              <li>Measurements: kept by Vercel in aggregate according to its retention rules for these products.</li>
              <li>Server logs: kept by the hosting provider for a short period according to its policies.</li>
            </ul>
          </section>

          <section id="transfers" className="stack stack--tight">
            <h2>International transfers</h2>
            <p>
              Your files and work stay on your device, so they are never transferred. Hosting logs and, on Vercel, the anonymous
              measurements are handled by the hosting provider, which may process them outside your country — Vercel is based in
              the United States. Vercel&apos;s privacy policy and data processing addendum describe the safeguards it uses for
              international transfers.
            </p>
          </section>

          <section id="rights" className="stack stack--tight">
            <h2>Your rights</h2>
            <p>
              Depending on where you live, you may have the right to access, correct, delete or restrict the processing of
              personal data about you, to object to processing based on legitimate interests, and to complain to your data
              protection authority. We don&apos;t keep personal data ourselves and the measurements can&apos;t be linked to
              you, so there is usually nothing to look up — but you can still contact us and we will help, including with
              requests to Vercel.
            </p>
          </section>

          <section id="regional" className="stack stack--tight">
            <h2>Rights in specific regions</h2>
            <ul>
              <li>
                <strong>European Union, EEA and United Kingdom (GDPR, UK GDPR):</strong> access, rectification, erasure,
                restriction, portability and objection, and the right to lodge a complaint with your supervisory authority. We
                make no decisions about you by automated means.
              </li>
              <li>
                <strong>California (CCPA/CPRA) and other US states with privacy laws:</strong> we do not sell or share personal
                information, use it for targeted advertising or profile anyone; Global Privacy Control is honoured
                automatically. You may ask what we hold (in practice, nothing linked to you) and will not be treated differently
                for using your rights.
              </li>
              <li>
                <strong>Brazil (LGPD), Canada (PIPEDA), Switzerland (FADP), South Africa (POPIA), Japan (APPI), South Korea
                (PIPA), India (DPDP Act), Australia (Privacy Act) and elsewhere:</strong> you have comparable rights to know,
                correct and delete data about you and to complain to your regulator. Contact us as described below and we will
                answer under the law that applies to you.
              </li>
            </ul>
          </section>

          <section id="children" className="stack stack--tight">
            <h2>Children</h2>
            <p>
              The site is a technical tool for students and engineers and is not directed at children under 13. It doesn&apos;t
              knowingly collect data from anyone.
            </p>
          </section>

          <section id="security" className="stack stack--tight">
            <h2>Security</h2>
            <p>
              The site uses HTTPS, a strict Content-Security-Policy, no third-party scripts and size-limited parsers for every
              file you open. The full review is in the project&apos;s security audit. Report vulnerabilities as described in{" "}
              <a href={`${SITE.repo}/security`}>the security policy</a>.
            </p>
          </section>

          <section id="changes" className="stack stack--tight">
            <h2>Changes to this policy</h2>
            <p>
              If this policy changes, the date at the top changes too. Material changes — for example, any new kind of data
              leaving your browser — will also be announced on the home page.
            </p>
          </section>

          <section id="contact" className="stack stack--tight">
            <h2>Contact</h2>
            <p>
              Questions or requests: open an issue or use the contact details on the project&apos;s{" "}
              <a href={SITE.repo}>GitHub page</a>. See also the <Link href="/terms">terms of use</Link>.
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

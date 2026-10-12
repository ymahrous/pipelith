import "./globals.css";

import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { headers } from "next/headers";
import { BrandMark } from "@/components/Brand";
import { DisplayMenu } from "@/components/DisplayMenu";
import { DisplayScript } from "@/components/DisplayScript";
import { HdlPicker } from "@/components/HdlPicker";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { SessionProvider } from "@/components/SessionProvider";
import { VercelMetrics } from "@/components/VercelMetrics";
import { JsonLd } from "@/components/JsonLd";
import { metricsEnabled, SITE } from "@/lib/site";

// Self-hosted fonts (SIL Open Font License, see src/app/fonts). Recursive's casual
// axis makes headings and controls playful while body text stays linear and plain;
// Atkinson Hyperlegible is the high-legibility choice in Display settings.
const recursive = localFont({
  src: "./fonts/recursive-sans-casual.woff2",
  weight: "300 1000",
  variable: "--font-recursive",
  display: "swap",
  adjustFontFallback: "Arial",
});
const recursiveMono = localFont({
  src: "./fonts/recursive-mono.woff2",
  weight: "300 1000",
  variable: "--font-recursive-mono",
  display: "swap",
  adjustFontFallback: false,
});
const readable = localFont({
  src: "./fonts/atkinson-hyperlegible-next.woff2",
  weight: "200 800",
  variable: "--font-readable",
  display: "swap",
  preload: false,
  adjustFontFallback: "Arial",
});
const readableMono = localFont({
  src: "./fonts/atkinson-hyperlegible-mono.woff2",
  weight: "200 800",
  variable: "--font-readable-mono",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  authors: [{ name: SITE.author }],
  creator: SITE.author,
  keywords: [
    "pipelined processor",
    "RISC processor",
    "VHDL code review",
    "Verilog code review",
    "SystemVerilog linter",
    "VHDL linter",
    "Verilog testbench generator",
    "expected waveform",
    "processor verification",
    "5-stage pipeline",
    "6-stage pipeline",
    "data forwarding",
    "hazard detection",
    "GHDL",
    "Icarus Verilog",
    "Verilator",
    "ModelSim",
    "VCD waveform comparison",
    "instruction set simulator",
    "computer architecture",
    "Pipelith",
    "pipeline verification",
  ],
  category: "technology",
  referrer: "no-referrer",
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large" } },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#edf1ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0c2124" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading headers opts every page into per-request rendering, which the CSP nonce needs.
  await headers();
  return (
    <html lang="en" className={`${recursive.variable} ${recursiveMono.variable} ${readable.variable} ${readableMono.variable}`}>
      <head>
        <DisplayScript />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SessionProvider>
          <header className="site-header">
            <div className="site-header__inner">
              <Link href="/" className="brand">
                <BrandMark />
                <span className="brand__name">{SITE.name}</span>
              </Link>
              <SiteNav />
              <div className="site-tools">
                <HdlPicker />
                <DisplayMenu />
              </div>
            </div>
          </header>
          <main id="main">{children}</main>
          <SiteFooter />
        </SessionProvider>
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: SITE.name,
            alternateName: "Pipelith pipeline verification",
            slogan: SITE.tagline,
            url: SITE.url + "/",
            description: SITE.description,
            inLanguage: "en",
            publisher: { "@type": "Person", name: SITE.author },
          }}
        />
        {metricsEnabled() && <VercelMetrics />}
      </body>
    </html>
  );
}

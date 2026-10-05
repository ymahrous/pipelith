/** Site-wide constants for metadata, structured data and legal pages. */

function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit && /^https?:\/\/[^\s]+$/.test(explicit)) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel && /^[a-z0-9.-]+$/i.test(vercel)) return `https://${vercel}`;
  return "http://localhost:3000";
}

/** The product name. Change it here; everything else reads it. */
export const BRAND = "Pipelith";

export const SITE = {
  name: BRAND,
  tagline: "Pipeline verification for RISC processors",
  url: siteUrl(),
  description:
    "Pipelith is a free, browser-based tool to validate and test pipelined RISC processors: review VHDL code with suggested fixes, assemble and simulate programs on a reference ISA model, and compare your VHDL simulation's waveform against it. Supports 5- and 6-stage pipelines. No login; your files never leave the browser.",
  author: "Yousef Mahrous",
  repo: "https://github.com/ymahrous/risc-pipelined-processor",
  legalUpdated: "2026-10-05",
  legalUpdatedText: "5 October 2026",
};

/** Vercel analytics run only on Vercel, and can be switched off with an env var. */
export function metricsEnabled(): boolean {
  return process.env.VERCEL === "1" && process.env.NEXT_PUBLIC_DISABLE_ANALYTICS !== "1";
}

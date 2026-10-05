import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

const PAGES: { path: string; priority: number; freq: "weekly" | "monthly" | "yearly" }[] = [
  { path: "/", priority: 1, freq: "weekly" },
  { path: "/review", priority: 0.9, freq: "monthly" },
  { path: "/workbench/program", priority: 0.9, freq: "monthly" },
  { path: "/guide", priority: 0.8, freq: "monthly" },
  { path: "/docs", priority: 0.8, freq: "monthly" },
  { path: "/docs/checks", priority: 0.6, freq: "monthly" },
  { path: "/docs/review-rules", priority: 0.7, freq: "monthly" },
  { path: "/docs/troubleshooting", priority: 0.7, freq: "monthly" },
  { path: "/docs/glossary", priority: 0.6, freq: "monthly" },
  { path: "/faq", priority: 0.8, freq: "monthly" },
  { path: "/isa", priority: 0.6, freq: "monthly" },
  { path: "/privacy", priority: 0.3, freq: "yearly" },
  { path: "/terms", priority: 0.3, freq: "yearly" },
  { path: "/license", priority: 0.2, freq: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(SITE.legalUpdated);
  return PAGES.map((p) => ({ url: `${SITE.url}${p.path}`, lastModified, changeFrequency: p.freq, priority: p.priority }));
}

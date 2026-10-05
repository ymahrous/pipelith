/** Documentation map: drives the docs sidebar, the hub, the sitemap and llms.txt. */

export interface DocLink {
  href: string;
  title: string;
  summary: string;
}

export interface DocGroup {
  title: string;
  links: DocLink[];
}

export const DOCS: readonly DocGroup[] = [
  {
    title: "Get started",
    links: [
      { href: "/docs", title: "Overview", summary: "Where to start, and which page answers which question." },
      { href: "/guide", title: "Guide", summary: "The full walkthrough: options, pipeline settings, running GHDL or ModelSim, reading results." },
      { href: "/try", title: "Run the demo", summary: "See a real bug found in one click — no files needed." },
    ],
  },
  {
    title: "Reference",
    links: [
      { href: "/docs/checks", title: "Check comments", summary: "Every comment syntax that becomes an automatic check, such as #R1=5 or C --> 1." },
      { href: "/docs/review-rules", title: "Review rules", summary: "Every Code review rule: what it catches, why it matters and how to fix it." },
      { href: "/isa", title: "Instruction set", summary: "Opcodes, encodings, flags and memory map of the reference ISA." },
      { href: "/docs/glossary", title: "Glossary", summary: "Pipeline and verification terms in one sentence each." },
    ],
  },
  {
    title: "Help",
    links: [
      { href: "/docs/troubleshooting", title: "Troubleshooting", summary: "Fixes for upload errors, assembler messages, simulator problems and odd comparisons." },
      { href: "/faq", title: "FAQ", summary: "Short answers about uploads, pipelines, results, privacy and cost." },
    ],
  },
];

export const DOC_PAGES = DOCS.flatMap((g) => g.links);

/** Common goals mapped to the fastest path. Shown on the docs hub. */
export const TASKS: readonly { goal: string; href: string; action: string }[] = [
  { goal: "See what Pipelith does", href: "/try", action: "Run the demo" },
  { goal: "Find bugs in my VHDL", href: "/review", action: "Upload a .zip to Code review" },
  { goal: "Check that a program does what its comments say", href: "/workbench/program", action: "Open it in the workbench" },
  { goal: "Compare my processor with the ISA", href: "/guide#hardware", action: "Download the hardware kit, run it, drop wave.vcd" },
  { goal: "Check results without a waveform", href: "/workbench/compare", action: "Type the final register values" },
  { goal: "Fix an error message", href: "/docs/troubleshooting", action: "Look it up in Troubleshooting" },
];

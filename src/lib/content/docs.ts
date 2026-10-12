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
      { href: "/docs/start", title: "Getting started", summary: "New to processor design? What a pipeline is, which tools to install, and your first check in ten minutes." },
      { href: "/guide", title: "Guide", summary: "The full walkthrough: options, languages, pipeline settings, running GHDL, Icarus Verilog, Verilator or ModelSim, reading results." },
      { href: "/try", title: "Run the demo", summary: "See a real bug found in one click — no files needed." },
    ],
  },
  {
    title: "Reference",
    links: [
      { href: "/docs/checks", title: "Check comments", summary: "Every comment syntax that becomes an automatic check, such as #R1=5 or C --> 1." },
      { href: "/docs/review-rules", title: "Review rules", summary: "Every Code review rule for VHDL, Verilog and SystemVerilog: what it catches, why it matters and how to fix it." },
      { href: "/waveforms", title: "Standard test waveforms", summary: "Expected waveforms of the standard tests for 5 and 6 stages, simulations of the reference designs, and how to read them." },
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
  { goal: "Learn the basics first", href: "/docs/start", action: "Read Getting started (ten minutes)" },
  { goal: "Find bugs in my VHDL, Verilog or SystemVerilog", href: "/review", action: "Upload a .zip to Code review" },
  { goal: "Sort out an upload the review can't read", href: "/guide#review", action: "Copy the AI prompt from the structure check" },
  { goal: "See what a correct pipeline's waveform looks like", href: "/waveforms", action: "Download an expected waveform" },
  { goal: "Check that a program does what its comments say", href: "/workbench/program", action: "Open it in the workbench" },
  { goal: "Compare my processor with the ISA", href: "/guide#hardware", action: "Download the hardware kit, run it, drop wave.vcd" },
  { goal: "Check results without a waveform", href: "/workbench/compare", action: "Type the final register values" },
  { goal: "Fix an error message", href: "/docs/troubleshooting", action: "Look it up in Troubleshooting" },
];

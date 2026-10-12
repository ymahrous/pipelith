import { FAQ } from "@/lib/content/faq";
import { DOC_PAGES } from "@/lib/content/docs";
import { GLOSSARY } from "@/lib/content/glossary";
import { RULES } from "@/lib/review/rules";
import { geometry } from "@/lib/pipeline/pipeline";
import { REVIEW_LIMITS } from "@/lib/review/intake";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

/** llms.txt (https://llmstxt.org): a plain-text map of the site for AI answer engines. */
export function GET() {
  const g5 = geometry(5);
  const g6 = geometry(6);
  const u = (p: string) => `${SITE.url}${p}`;
  const body = `# ${SITE.name}

> ${SITE.description}

${SITE.name} is a free, open-source (MIT) web app by ${SITE.author}. Everything runs in the visitor's browser; there are no accounts and uploaded files are never sent to a server.

## Main pages

- [Code review](${u("/review")}): upload a VHDL, Verilog or SystemVerilog codebase (.zip, folder or source files; mixed languages work) and get findings with file, line, explanation and a suggested fix. Checks syntax, structure (missing packages, headers and units), connectivity (component/entity mismatches, widths, multiple drivers, implicit nets, wires assigned in always blocks), processes (sensitivity lists, latches, blocking vs non-blocking assignments, logic outside the clock edge) and pipeline structure for the selected depth and forwarding. When an upload is badly structured it writes a prompt for any AI assistant to reorganise the files (file names only, never code).
- [Workbench](${u("/workbench/program")}): six steps — Program, Assemble, Simulate, Check, Compare, Report — to run a program on a reference ISA model, estimate pipeline timing, download the expected waveform, generate a testbench and simulator scripts in VHDL, Verilog or SystemVerilog, and compare a VCD waveform or final register values from your design.
- [Standard test waveforms](${u("/waveforms")}): expected waveforms of the four standard test programs for 5- and 6-stage pipelines (built from the model and the timing estimate), real simulations of the bundled 6-stage VHDL (GHDL) and 5-stage Verilog (Icarus) reference designs, and how to read a waveform.
- [Getting started](${u("/docs/start")}): for new digital designers — what is checked, five pipeline ideas, free tools per language, a first check in ten minutes.
- [Guide](${u("/guide")}): how each option works, what files are needed, design language, pipeline depth and forwarding, expected waveforms, running GHDL, Icarus Verilog, Verilator, ModelSim/Questa or Vivado.
- [FAQ](${u("/faq")}): short answers to common questions.
- [Instruction set](${u("/isa")}): the 32-bit RISC ISA the reference model implements.
- [Run the demo](${u("/try")}): one click, no files — the bundled Memory test compared with a GHDL waveform of the reference processor.
- Quick start: files dropped on the [home page](${u("/")}) open where they belong (.zip/.vhd → Code review, .asm/.mem → Assemble, program + .vcd or final values → Compare).
- [Documentation](${u("/docs")}): ${DOC_PAGES.filter((d) => d.href.startsWith("/docs/")).map((d) => `[${d.title}](${u(d.href)})`).join(", ")}.
- [Privacy policy](${u("/privacy")}) · [Terms of use](${u("/terms")}) · [Accessibility statement](${u("/accessibility")}) · [MIT License](${u("/license")})

## Key facts

- Design languages: VHDL (IEEE 1076-2008), Verilog (IEEE 1364-2005) and SystemVerilog (IEEE 1800-2017), chosen with HDL at the top of every page; code review reads all three, including mixed designs.
- Pipeline depths: 5 stages (${g5.stages.join(" ")}) and 6 stages (${g6.stages.join(" ")}).
- Forwarding settings: full forwarding, selected paths (5 stages: ${g5.forwardingSources.join(", ")}; 6 stages: ${g6.forwardingSources.join(", ")}) or none; optional register-file write-through.
- Accepted files: .asm and .mem programs; .vcd and .vcd.gz waveforms; typed or .txt final register values; codebases as .zip, folder or files — .vhd/.vhdl, .v/.vh, .sv/.svh (up to ${REVIEW_LIMITS.files} files, ${REVIEW_LIMITS.fileBytes / 1024 / 1024} MB each, ${REVIEW_LIMITS.zipBytes / 1024 / 1024} MB per zip).
- Zip structure: all source files of one design including every package, header and component, any folder layout, no nested zips or password protection.
- Simulators: GHDL (VHDL), Icarus Verilog and Verilator (Verilog, SystemVerilog), ModelSim/Questa (all) via generated scripts; Vivado and any tool that writes VCD.
- Reference designs: a 6-stage VHDL processor and a 5-stage Verilog/SystemVerilog processor, both with simulated waveforms of the standard tests.
- Accessibility: aims at WCAG 2.2 AA; Display settings for dark mode, larger text, the Atkinson Hyperlegible typeface and reduced motion.
- Privacy: no cookies; optional cookieless Vercel Web Analytics and Speed Insights on Vercel deployments, with URLs reduced to the path and Do Not Track / Global Privacy Control honoured.

## Code review rules

${RULES.map((r) => `- ${r.id} (${r.category}, ${r.severity}): ${r.title}. ${r.why}`).join("\n")}

## Glossary

${GLOSSARY.map((t) => `- ${t.term}: ${t.definition}`).join("\n")}

## FAQ

${FAQ.map((f) => `### ${f.q}\n\n${f.a}`).join("\n\n")}
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

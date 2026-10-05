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

- [Code review](${u("/review")}): upload a VHDL codebase (.zip, folder or .vhd files) and get findings with file, line, explanation and a suggested fix. Checks syntax, structure, connectivity (component/entity mismatches, widths, multiple drivers, unused inputs), processes (sensitivity lists, latches, logic outside the clock edge) and pipeline structure for the selected depth and forwarding.
- [Workbench](${u("/workbench/program")}): six steps — Program, Assemble, Simulate, Check, Compare, Report — to run a program on a reference ISA model, estimate pipeline timing and compare a VCD waveform or final register values from your design.
- [Guide](${u("/guide")}): how each option works, what files are needed, pipeline depth and forwarding, running GHDL/ModelSim/Vivado.
- [FAQ](${u("/faq")}): short answers to common questions.
- [Instruction set](${u("/isa")}): the 32-bit RISC ISA the reference model implements.
- [Run the demo](${u("/try")}): one click, no files — the bundled Memory test compared with a GHDL waveform of the reference processor.
- Quick start: files dropped on the [home page](${u("/")}) open where they belong (.zip/.vhd → Code review, .asm/.mem → Assemble, program + .vcd or final values → Compare).
- [Documentation](${u("/docs")}): ${DOC_PAGES.filter((d) => d.href.startsWith("/docs/")).map((d) => `[${d.title}](${u(d.href)})`).join(", ")}.
- [Privacy policy](${u("/privacy")}) · [Terms of use](${u("/terms")}) · [MIT License](${u("/license")})

## Key facts

- Pipeline depths: 5 stages (${g5.stages.join(" ")}) and 6 stages (${g6.stages.join(" ")}).
- Forwarding settings: full forwarding, selected paths (5 stages: ${g5.forwardingSources.join(", ")}; 6 stages: ${g6.forwardingSources.join(", ")}) or none; optional register-file write-through.
- Accepted files: .asm and .mem programs; .vcd and .vcd.gz waveforms; typed or .txt final register values; VHDL codebases as .zip, folder or files (up to ${REVIEW_LIMITS.files} files, ${REVIEW_LIMITS.fileBytes / 1024 / 1024} MB each, ${REVIEW_LIMITS.zipBytes / 1024 / 1024} MB per zip).
- Zip structure: all VHDL files of one design including every package and component, any folder layout, no nested zips or password protection.
- Simulators: GHDL, ModelSim, Questa via generated scripts; any tool that writes VCD.
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

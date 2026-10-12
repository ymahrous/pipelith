import type { Metadata } from "next";
import Link from "next/link";
import { GOALS, REVIEW_OPTION } from "@/components/goals";
import { HdlTabs } from "@/components/HdlTabs";
import { geometry } from "@/lib/pipeline/pipeline";
import { ZipGuide } from "@/components/review/ZipGuide";
import { JsonLd } from "@/components/JsonLd";
import { SITE } from "@/lib/site";
import { STEPS } from "@/components/steps";

export const metadata: Metadata = {
  title: "Guide",
  description:
    "How to use Pipelith with VHDL, Verilog or SystemVerilog: what each option needs, structuring a .zip for code review, 5- vs 6-stage pipelines, forwarding, expected waveforms, running GHDL, Icarus Verilog, Verilator or ModelSim, and reading results.",
  alternates: { canonical: "/guide" },
};

const TOC = [
  ["needs", "What you need"],
  ["flow", "How a validation run works"],
  ["depth", "5 or 6 pipeline stages"],
  ["language", "VHDL, Verilog or SystemVerilog"],
  ["review", "Code review"],
  ["zip", "Structuring the .zip"],
  ["forwarding", "Forwarding settings"],
  ["comments", "Writing checks as comments"],
  ["waveforms", "Expected waveforms"],
  ["hardware", "Running your hardware"],
  ["reading", "Reading the comparison"],
  ["other", "Using it with another processor"],
  ["display", "Display and accessibility"],
  ["privacy", "Privacy and security"],
  ["limits", "Limits"],
] as const;

export default function GuidePage() {
  return (
    <div className="step">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "HowTo",
          name: "Validate a pipelined RISC processor against its instruction set",
          description: "Run a program on the reference model, simulate your VHDL, Verilog or SystemVerilog design with a generated testbench, and compare the results.",
          tool: [
            { "@type": "HowToTool", name: "GHDL (VHDL)" },
            { "@type": "HowToTool", name: "Icarus Verilog or Verilator (Verilog, SystemVerilog)" },
            { "@type": "HowToTool", name: "ModelSim, Questa or Vivado (any language)" },
          ],
          step: STEPS.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.title, url: `${SITE.url}/workbench/${s.slug}` })),
        }}
      />
      <header className="step-head">
        <h1>Guide</h1>
        <p>Everything you need to take a program from source to a verdict on your RTL.</p>
        <p className="small muted">
          New to processor design? Start with <Link href="/docs/start">Getting started</Link>. Short on time?{" "}
          <Link href="/try">Run the demo</Link> (one click, no files), or drop your files on the <Link href="/">home page</Link> and
          Pipelith opens each one where it belongs. Reference pages:{" "}
          <Link href="/docs/checks">check comments</Link>, <Link href="/docs/review-rules">review rules</Link>,{" "}
          <Link href="/docs/troubleshooting">troubleshooting</Link>, <Link href="/docs/glossary">glossary</Link>.
        </p>
      </header>
      <div className="split">
        <article className="prose stack">
          <section id="needs" className="stack stack--tight">
            <h2>What you need</h2>
            <p>Choose one of three options at the start of the workbench. Each needs different files:</p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Option</th>
                    <th scope="col">You provide</th>
                    <th scope="col">Steps</th>
                  </tr>
                </thead>
                <tbody>
                  {[...GOALS, { id: "review", ...REVIEW_OPTION, steps: "Code review page" }].map((g) => (
                    <tr key={g.id}>
                      <td>
                        <strong>{g.title}</strong>
                      </td>
                      <td>
                        <ul>
                          {g.needs.map((n) => (
                            <li key={n}>{n}</li>
                          ))}
                        </ul>
                      </td>
                      <td>{g.steps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Files the workbench accepts</h3>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">File</th>
                    <th scope="col">Where</th>
                    <th scope="col">What it is</th>
                    <th scope="col">Limit</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>.asm</code>
                    </td>
                    <td>Program</td>
                    <td>Assembly source. Comments become checks and IN-port values.</td>
                    <td>512 KB</td>
                  </tr>
                  <tr>
                    <td>
                      <code>.mem</code>
                    </td>
                    <td>Program</td>
                    <td>Assembled image: one 32-digit binary word per line, from address 0.</td>
                    <td>4096 words</td>
                  </tr>
                  <tr>
                    <td>
                      <code>.vcd</code>, <code>.vcd.gz</code>
                    </td>
                    <td>Compare</td>
                    <td>
                      Waveform of your design running the same program. Needs clock, reset and R0–R7; SP, flags, OUT and
                      fetch PC add more checks.
                    </td>
                    <td>512 MB unpacked</td>
                  </tr>
                  <tr>
                    <td>
                      <code>.zip</code>, folder or source files (<code>.vhd</code>, <code>.v</code>, <code>.sv</code> and
                      headers)
                    </td>
                    <td>Code review</td>
                    <td>Your whole design in VHDL, Verilog or SystemVerilog (or a mix), including packages and headers. Other files are ignored; .asm files are listed.</td>
                    <td>1,500 files, 2 MB each, 50 MB zip</td>
                  </tr>
                  <tr>
                    <td>
                      <code>.txt</code> or typed
                    </td>
                    <td>Compare</td>
                    <td>
                      Final register values, e.g. <code>R1=19 SP=FFF Z=0</code>. Checks the end state only.
                    </td>
                    <td>8 KB</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="small muted">Every file is read in your browser. None is sent to a server.</p>
          </section>

          <section id="flow" className="stack stack--tight">
            <h2>How a validation run works</h2>
            <p>
              The workbench holds two models of the same processor. The <strong>reference model</strong> executes the ISA
              exactly as written, one instruction per step, with no pipeline. Your <strong>hardware</strong> is your RTL — VHDL,
              Verilog or SystemVerilog — simulated in GHDL, Icarus Verilog, Verilator, ModelSim/Questa or Vivado. Because a
              pipeline commits results at different cycles, the two are
              compared by the <em>sequence of values</em> each register, the stack pointer, the flags and the OUT port take
              — not by timing.
            </p>
            <ol>
              <li>
                <strong>Program</strong> — load a bundled test, an <code>.asm</code> or <code>.mem</code> file, or write one.
              </li>
              <li>
                <strong>Assemble</strong> — fix errors; read the warnings, which point at things the original assembler
                accepts silently.
              </li>
              <li>
                <strong>Simulate</strong> — confirm the program does what you meant on the reference model. Set IN-port
                values and interrupts here.
              </li>
              <li>
                <strong>Check</strong> — expectations written in comments are tested. Failures mean the comment and the ISA
                disagree.
              </li>
              <li>
                <strong>Compare</strong> — download the hardware kit, simulate your RTL, and load <code>wave.vcd</code>.
              </li>
              <li>
                <strong>Report</strong> — export Markdown or JSON, or share the setup as a link.
              </li>
            </ol>
          </section>

          <section id="depth" className="stack stack--tight">
            <h2>5 or 6 pipeline stages</h2>
            <p>
              Choose your design&apos;s depth in the Program step or on the Code review page. The instruction set — and so the
              reference model and every check — is the same for both. The depth changes:
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col" />
                    <th scope="col">5 stages</th>
                    <th scope="col">6 stages</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    ["Stages", (d: 5 | 6) => geometry(d).stages.join(" → ")],
                    ["Pipeline registers", (d: 5 | 6) => geometry(d).registers.join(", ")],
                    ["Forwarding into EX from", (d: 5 | 6) => geometry(d).forwardingSources.join(", ")],
                    ["Conditional branch resolved in", (d: 5 | 6) => geometry(d).stages[geometry(d).branchResolve]],
                    ["Load-use stall with full forwarding (dependent instruction right behind)", (d: 5 | 6) => `${geometry(d).memory - geometry(d).execute} cycle(s)`],
                    ["Taken-branch flush (after the immediate word)", (d: 5 | 6) => `${geometry(d).branchResolve - 1} cycle(s)`],
                  ] as const).map(([label, f]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>{f(5)}</td>
                      <td>{f(6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul>
              <li>
                <strong>Simulate</strong> shows a cycle estimate, the stall breakdown and a pipeline diagram for the selected
                depth.
              </li>
              <li>
                <strong>Compare</strong> sizes the testbench from that estimate, looks for the depth&apos;s usual signal names
                (for example <code>ex_ccr</code> on 5 stages, <code>ex1_ccr</code> on 6), and says whether your design&apos;s
                cycle count is consistent with the depth.
              </li>
              <li>
                <strong>Code review</strong> checks for that depth&apos;s pipeline registers and forwarding paths, and warns if
                the code looks like the other depth.
              </li>
            </ul>
          </section>

          <section id="language" className="stack stack--tight">
            <h2>VHDL, Verilog or SystemVerilog</h2>
            <p>
              Choose your design language with <strong>HDL</strong> at the top of any page. It is one setting for the whole site:
              the hardware kit writes its testbench and scripts in that language, <em>Try the reference processor</em> loads a
              design in it, and examples in the docs switch to it. Code review always reads every language it finds, so mixed
              designs work.
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Language</th>
                    <th scope="col">Files</th>
                    <th scope="col">Free simulators</th>
                    <th scope="col">Bundled reference design</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>VHDL (IEEE 1076-2008)</td>
                    <td>
                      <code>.vhd</code>, <code>.vhdl</code>
                    </td>
                    <td>GHDL</td>
                    <td>6 stages (IF ID EX1 EX2 MEM WB)</td>
                  </tr>
                  <tr>
                    <td>Verilog (IEEE 1364-2005)</td>
                    <td>
                      <code>.v</code>, headers <code>.vh</code>
                    </td>
                    <td>Icarus Verilog, Verilator</td>
                    <td>5 stages (IF ID EX MEM WB)</td>
                  </tr>
                  <tr>
                    <td>SystemVerilog (IEEE 1800-2017)</td>
                    <td>
                      <code>.sv</code>, headers <code>.svh</code>
                    </td>
                    <td>Icarus Verilog (-g2012), Verilator</td>
                    <td>5 stages (the Verilog design in SystemVerilog style)</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>ModelSim/Questa and the Vivado simulator handle all three.</p>
          </section>

          <section id="review" className="stack stack--tight">
            <h2>Code review</h2>
            <p>
              On the <Link href="/review">Code review</Link> page, upload your VHDL, Verilog or SystemVerilog as a .zip, a folder
              or individual files. The review parses every file and checks the following (every rule is listed in{" "}
              <Link href="/docs/review-rules">Code review rules</Link>):
            </p>
            <ul>
              <li>
                <strong>Syntax</strong> — unclosed blocks (with the line of the opener), mismatched <code>end</code>s, broken
                literals.
              </li>
              <li>
                <strong>Structure</strong> — architectures without entities, instances of units that don&apos;t exist,
                duplicate entities.
              </li>
              <li>
                <strong>Connectivity</strong> — component declarations that disagree with their entity (missing ports, wrong
                modes or widths), unknown or unconnected ports, width mismatches, multiple drivers, undriven signals, unused
                inputs such as a reset that is never read.
              </li>
              <li>
                <strong>Processes</strong> — incomplete sensitivity lists, latches, logic outside the clock edge, missing
                clock or asynchronous reset in the list, <code>case</code> without <code>when others</code>, mixed reset
                polarity, delays in RTL. In Verilog: blocking (<code>=</code>) assignments in clocked blocks, non-blocking (
                <code>&lt;=</code>) ones in combinational logic, both on one variable, <code>always</code> without events, and a
                reset tested with the wrong polarity.
              </li>
              <li>
                <strong>Pipeline</strong> — the registers, stages, forwarding and hazard units expected for the selected depth,
                and fields latched by a pipeline register but never passed on.
              </li>
              <li>
                <strong>Style</strong> — non-standard arithmetic packages, unconstrained integers, initial values, file names;
                in Verilog also <code>casex</code>, missing <code>`timescale</code> in some files, and no{" "}
                <code>`default_nettype none</code>.
              </li>
            </ul>
            <p>
              Verilog adds connection checks of its own: wires assigned in <code>always</code> blocks, <code>reg</code>s driven
              by <code>assign</code>, and undeclared names that silently become 1-bit wires. Macros (<code>`define</code>),{" "}
              <code>`ifdef</code> and <code>`include</code> are expanded first, so the review sees what the compiler sees.
            </p>
            <p>
              After an upload, a <strong>structure check</strong> says whether the upload looks like one complete design. If it
              doesn&apos;t — missing packages or headers, a unit nobody defines, two copies of one — it offers a ready-made prompt
              you can paste into any AI assistant to reorganise the files. The prompt lists your file names and the problems, never
              your code, and Pipelith doesn&apos;t send it anywhere.
            </p>
            <p>
              Every finding has a file and line, the reason it matters, and a suggested fix (often with code). The Design
              overview shows the hierarchy and a dependency-ordered compile list, which you can send to the hardware kit.
              Static analysis can&apos;t catch logic bugs — run programs in the workbench for those.
            </p>
          </section>

          <section id="zip" className="stack stack--tight">
            <h2>Structuring the .zip for code review</h2>
            <p>
              Put every source file of one design — including all packages, headers and components — in one folder, then zip it.
              The details, an example layout for your language and instructions for each operating system:
            </p>
            <ZipGuide open />
          </section>

          <section id="forwarding" className="stack stack--tight">
            <h2>Forwarding settings</h2>
            <p>
              Next to the depth, choose what your design forwards. The same setting is used by Simulate, Compare and Code
              review.
            </p>
            <ul>
              <li>
                <strong>Full forwarding</strong> — every result can be bypassed to the execute stage from each later pipeline
                register (5 stages: {geometry(5).forwardingSources.join(", ")}; 6 stages:{" "}
                {geometry(6).forwardingSources.join(", ")}). Only load-use dependencies stall.
              </li>
              <li>
                <strong>Some paths</strong> — tick the pipeline registers your forwarding mux actually reads. A dependency the
                ticked paths can&apos;t serve stalls until the value reaches a path that exists, or the register file.
              </li>
              <li>
                <strong>No forwarding</strong> — every dependent instruction waits in decode until the producer has written
                back. Expect many more cycles, especially on 6 stages.
              </li>
              <li>
                <strong>Register file writes before it reads</strong> — tick this if write-back and decode can use the
                register file in the same cycle (write in the first half, read in the second). Untick it and each such
                dependency costs one more cycle.
              </li>
            </ul>
            <p>
              The <strong>timing estimate</strong> and stall breakdown change immediately; the <strong>Compare</strong>{" "}
              verdict says whether your design&apos;s cycle count fits the selection; and <strong>Code review</strong> expects
              a forwarding unit fed from the ticked paths — or, with no forwarding, a hazard unit that stalls every dependency —
              and tells you when the code forwards from paths you didn&apos;t tick.
            </p>
          </section>

          <section id="comments" className="stack stack--tight">
            <h2>Writing checks as comments</h2>
            <p>Put expectations after the instruction they follow. Numbers are hex.</p>
            <pre className="code-block">{`IN   R1          #R1=30
PUSH R4          #SP=FFE, M[FFF]=300
AND  R5,R1,R5    #R5=0, Z = 1
NOT  R5          #R5=FFFF_FFFF, C--> no change, N=1
JZ   50          #Jump taken
SETC             #this statement shouldn't be executed`}</pre>
            <p>
              A value on an <code>IN</code> line also sets what the IN port supplies (<code>#R1=30</code> or{" "}
              <code>#add 30 in R1</code>). Checks are evaluated after the first time their line executes. The full syntax is in{" "}
              <Link href="/docs/checks">Check comments</Link>.
            </p>
          </section>

          <section id="waveforms" className="stack stack--tight">
            <h2>Expected waveforms</h2>
            <p>
              An expected waveform is what a correct design with your depth and forwarding should show for a program: clock,
              reset, the fetch PC, every register, SP, the flags, OUT, memory writes and the instruction in each stage, cycle by
              cycle. Pipelith builds it from the reference model and the timing estimate — no simulator or RTL needed — as a
              standard VCD you can open in GTKWave or Surfer next to your own.
            </p>
            <ul>
              <li>
                <strong>For the open program:</strong> <em>Download expected waveform (.vcd)</em> under Pipeline timing in{" "}
                <Link href="/workbench/simulate">Simulate</Link>.
              </li>
              <li>
                <strong>For the standard tests:</strong> <Link href="/waveforms">Standard test waveforms</Link> has the expected
                waveforms for 5 and 6 stages, and real simulations of both reference designs.
              </li>
            </ul>
            <p>
              Values appear when the producing instruction reaches the stage that writes them: registers and OUT at write-back,
              flags at execute, SP and memory in the memory stage. Your design may differ by a cycle here and there — the Compare
              step checks the order of values, not the exact cycle.
            </p>
          </section>

          <section id="hardware" className="stack stack--tight">
            <h2>Running your hardware</h2>
            <p>
              In <Link href="/workbench/compare">Compare</Link>, set the RTL folder (relative to where you unzip the kit) and
              download it. It contains <code>program.mem</code>, a testbench in your design language and scripts for the
              simulators that read it.
            </p>
            <HdlTabs
              label="Simulator instructions by language"
              panels={{
                vhdl: (
                  <>
                    <h3>GHDL</h3>
                    <pre className="code-block">{`unzip program-hardware-run.zip -d run && cd run
chmod +x run_ghdl.sh
./run_ghdl.sh ../risc-pipelined-processor/src/rtl`}</pre>
                    <h3>ModelSim or Questa</h3>
                    <pre className="code-block">{`# edit "set RTL ..." at the top of run_modelsim.do, then in the transcript:
do run_modelsim.do`}</pre>
                    <h3>Vivado simulator</h3>
                    <pre className="code-block">{`# after compiling the RTL and tb_processor.vhd (VHDL-2008):
open_vcd wave.vcd
log_vcd [get_objects -r /tb_processor/*]
run all
close_vcd`}</pre>
                  </>
                ),
                verilog: (
                  <>
                    <h3>Icarus Verilog</h3>
                    <pre className="code-block">{`unzip program-hardware-run.zip -d run && cd run
chmod +x run_icarus.sh
./run_icarus.sh path/to/your/rtl`}</pre>
                    <h3>Verilator 5</h3>
                    <pre className="code-block">{`chmod +x run_verilator.sh
./run_verilator.sh path/to/your/rtl     # builds obj_dir/Vtb_processor, then runs it`}</pre>
                    <h3>ModelSim or Questa</h3>
                    <pre className="code-block">{`# edit "set RTL ..." at the top of run_modelsim.do, then in the transcript:
do run_modelsim.do`}</pre>
                    <h3>Vivado simulator</h3>
                    <pre className="code-block">{`xvlog -i path/to/your/rtl <your .v files> tb_processor.v
xelab tb_processor -s tb
xsim tb -runall                 # the testbench writes wave.vcd itself`}</pre>
                  </>
                ),
                systemverilog: (
                  <>
                    <h3>Icarus Verilog</h3>
                    <pre className="code-block">{`unzip program-hardware-run.zip -d run && cd run
chmod +x run_icarus.sh
./run_icarus.sh path/to/your/rtl        # compiles with -g2012`}</pre>
                    <h3>Verilator 5</h3>
                    <pre className="code-block">{`chmod +x run_verilator.sh
./run_verilator.sh path/to/your/rtl`}</pre>
                    <h3>ModelSim or Questa</h3>
                    <pre className="code-block">{`# edit "set RTL ..." at the top of run_modelsim.do (it uses vlog -sv), then:
do run_modelsim.do`}</pre>
                    <h3>Vivado simulator</h3>
                    <pre className="code-block">{`xvlog -sv -i path/to/your/rtl <your .sv files> tb_processor.sv
xelab tb_processor -s tb
xsim tb -runall`}</pre>
                  </>
                ),
              }}
            />
            <p>
              The Verilog and SystemVerilog testbenches read the fetch PC through a hierarchical reference (
              <code>uut.pc_out</code>) and expect the interrupt input to be called <code>intr</code>, because SystemVerilog
              reserves <code>int</code>. Edit the names at the top of the testbench if yours differ.
            </p>
            <p>
              The testbench holds reset over a full falling and rising edge (the reference design loads PC from M[0] on that
              pair of edges), drives IN.PORT from the fetch PC so every IN reads the value the model used, and pulses the
              interrupt line when a chosen address is fetched.
            </p>
          </section>

          <section id="reading" className="stack stack--tight">
            <h2>Reading the comparison</h2>
            <ul>
              <li>
                <strong>Differs</strong> — the hardware produced a different value at that position. The row shows which
                instruction the model expected it from.
              </li>
              <li>
                <strong>Extra write</strong> — the hardware changed the value when the model did not, often a flushed
                instruction that still wrote back.
              </li>
              <li>
                <strong>Ends early</strong> — the trace stops before the model&apos;s last value. Run more cycles, or the
                write never happened.
              </li>
              <li>
                <strong>Fetch PC</strong> — flags the first fetch from an address the program never uses: control flow went
                wrong there.
              </li>
            </ul>
            <p>Start with the first divergence in time; later differences are usually consequences of it.</p>
          </section>

          <section id="other" className="stack stack--tight">
            <h2>Using it with another processor</h2>
            <p>
              If your design has different signal names, open <em>Signal mapping</em> under the results and pick the right
              ones. Registers, SP and the OUT port need 32-bit signals; the flags signal can be any width, with Z, N and C in
              bits 0, 1 and 2.
            </p>
            <p>
              For a different instruction set, add a processor profile. See <code>CONTRIBUTING.md</code> in the repository.
            </p>
          </section>

          <section id="display" className="stack stack--tight">
            <h2>Display and accessibility</h2>
            <p>
              <strong>Display</strong> at the top of every page sets the colours (light, dark or your device&apos;s setting), a
              larger text size, the typeface — Recursive, or Atkinson Hyperlegible, designed for readers with low vision — and
              whether anything moves. The choices are kept in this browser. Everything works with a keyboard and a screen reader;
              see the <Link href="/accessibility">accessibility statement</Link>.
            </p>
          </section>

          <section id="privacy" className="stack stack--tight">
            <h2>Privacy and security</h2>
            <ul>
              <li>No accounts, no cookies, no third-party scripts — fonts are served from this site.</li>
              <li>
                On Vercel, anonymous cookieless page-view and speed measurements (Vercel Web Analytics and Speed Insights) with
                URLs reduced to the page path; Do Not Track and Global Privacy Control are respected, and the{" "}
                <Link href="/privacy#analytics">privacy page</Link> has an opt-out switch.
              </li>
              <li>Files you open are read in the browser. Nothing is uploaded; the server only serves the app.</li>
              <li>
                Your session and display preferences are kept in this browser&apos;s local storage. Clearing site data removes
                them.
              </li>
              <li>
                The AI restructuring prompt is only copied to your clipboard or downloaded; Pipelith never sends it to any AI
                service.
              </li>
              <li>
                Share links carry the program after <code>#</code>, the part of a URL browsers do not send to servers.
              </li>
              <li>
                A strict Content-Security-Policy blocks inline and third-party scripts. Uploaded text is never rendered as
                HTML.
              </li>
              <li>
                The generated scripts only call the simulator (<code>ghdl</code>, <code>iverilog</code>, <code>verilator</code>{" "}
                or ModelSim) on files in the kit and the folder you name. Read them before running — they are short.
              </li>
            </ul>
          </section>

          <section id="limits" className="stack stack--tight">
            <h2>Limits</h2>
            <ul>
              <li>Programs up to 512 KB of source, 4096 words of memory, and 200,000 model steps.</li>
              <li>Waveforms up to 512 MB; only the mapped signals are kept in memory.</li>
              <li>Memory contents are not compared (most dumps don&apos;t include memory arrays); registers and SP are.</li>
              <li>
                Interrupt timing in a pipeline differs from an instruction-level model, so interrupt tests are compared on a
                best-effort basis.
              </li>
              <li>
                Code review is static analysis. In Verilog, macros defined in files that aren&apos;t in the upload are unknown, so
                the review is more careful (fewer “never used” notes) in files that use them.
              </li>
            </ul>
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

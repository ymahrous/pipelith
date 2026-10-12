import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/DocPage";
import { HdlTabs } from "@/components/HdlTabs";
import { SITE } from "@/lib/site";

const DESCRIPTION =
  "New to processor design? What Pipelith checks, the five pipeline ideas you need, the free tools to install for VHDL, Verilog or SystemVerilog, and your first check in about ten minutes.";

export const metadata: Metadata = {
  title: "Getting started for new digital designers",
  description: DESCRIPTION,
  alternates: { canonical: "/docs/start" },
};

const STEPS: { name: string; text: React.ReactNode; plain: string }[] = [
  {
    name: "See a real bug found",
    plain: "Open Run the demo: a bundled test is compared with a simulation of the reference processor and the first wrong value is highlighted.",
    text: (
      <>
        Open <Link href="/try">Run the demo</Link>. A bundled test is compared with a simulation of the reference processor,
        and the first wrong value is highlighted — a real PUSH bug. Nothing to install.
      </>
    ),
  },
  {
    name: "Describe your design",
    plain: "Choose your language with HDL at the top of the page, then the pipeline depth and forwarding in the Program step.",
    text: (
      <>
        Choose your language with <strong>HDL</strong> at the top of the page. In <Link href="/workbench/program">Program</Link>,
        pick the pipeline depth (5 or 6 stages) and what your design forwards. Not sure? Keep the defaults.
      </>
    ),
  },
  {
    name: "Watch a program run",
    plain: "Open a standard test, step through it in Simulate, look at the pipeline diagram and download its expected waveform.",
    text: (
      <>
        Open a standard test such as <em>Memory and stack</em>, then step through it in{" "}
        <Link href="/workbench/simulate">Simulate</Link>. Look at the pipeline diagram, and download the{" "}
        <strong>expected waveform</strong> to see what a correct design shows in a waveform viewer.
      </>
    ),
  },
  {
    name: "Review your code",
    plain: "Upload your design to Code review as a .zip and fix errors first, then warnings.",
    text: (
      <>
        Upload your design to <Link href="/review">Code review</Link> as a .zip. Fix <strong>errors</strong> first (the compiler
        would stop on them), then <strong>warnings</strong>. If the structure check complains, copy its AI prompt into an
        assistant to sort your files out.
      </>
    ),
  },
  {
    name: "Compare your hardware",
    plain: "Download the hardware kit in Compare, run its script in your simulator and drop the wave.vcd it writes back in.",
    text: (
      <>
        In <Link href="/workbench/compare">Compare</Link>, download the hardware kit, run its script with your simulator, and drop
        the <code>wave.vcd</code> it writes back in. Start with the <strong>first divergence</strong>: later differences are
        usually its consequences.
      </>
    ),
  },
];

const install = (rows: [string, string][]) => (
  <div className="table-wrap">
    <table className="data">
      <thead>
        <tr>
          <th scope="col">System</th>
          <th scope="col">Install</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([os, cmd]) => (
          <tr key={os}>
            <td>{os}</td>
            <td className="mono">{cmd}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default function StartPage() {
  return (
    <DocPage
      path="/docs/start"
      title="Getting started"
      description={DESCRIPTION}
      lede="New to processor design, or to Pipelith? The ideas in plain words, the free tools for your language, and your first check in about ten minutes."
      extraLd={{
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: "Check a pipelined processor with Pipelith for the first time",
        totalTime: "PT10M",
        step: STEPS.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.name, text: s.plain })),
        url: `${SITE.url}/docs/start`,
      }}
    >
      <section className="stack stack--tight" aria-labelledby="what-h">
        <h2 id="what-h">What Pipelith checks</h2>
        <p>
          Your processor must do exactly what its <Link href="/isa">instruction set</Link> says. Pipelith runs each program on a{" "}
          <strong>reference model</strong> — a simple program that executes one instruction at a time and is right by
          definition — and compares the values your design produces with it. The first register, flag or fetch where they
          disagree is where your bug is. Before that, <strong>Code review</strong> reads your source files and catches mistakes
          a simulation would only show as mysterious <code>X</code> values.
        </p>
      </section>

      <section className="stack stack--tight" aria-labelledby="ideas-h">
        <h2 id="ideas-h">Five ideas you need</h2>
        <ol className="prose">
          <li>
            A <strong>pipeline</strong> splits each instruction into <strong>stages</strong> (fetch, decode, execute, memory,
            write-back) so several instructions are in flight at once — like an assembly line.
          </li>
          <li>
            <strong>Pipeline registers</strong> sit between stages and carry each instruction&apos;s values forward on every clock
            edge.
          </li>
          <li>
            A <strong>hazard</strong> is when the next instruction can&apos;t safely continue: it needs a result that isn&apos;t
            written yet, or a branch hasn&apos;t been decided.
          </li>
          <li>
            <strong>Forwarding</strong> sends a result straight back to the execute stage so the next instruction doesn&apos;t
            wait for it to be written.
          </li>
          <li>
            When forwarding can&apos;t help, the pipeline <strong>stalls</strong> (waits a cycle) or <strong>flushes</strong>{" "}
            (throws away instructions fetched after a taken branch).
          </li>
        </ol>
        <p className="small">
          Every term is explained in one sentence in the <Link href="/docs/glossary">glossary</Link>.
        </p>
      </section>

      <section className="stack stack--tight" aria-labelledby="tools-h">
        <h2 id="tools-h">Install the tools (all free)</h2>
        <p>
          You only need a simulator to run your own design. Reviewing code, running programs on the model and expected
          waveforms all work in the browser with nothing installed.
        </p>
        <HdlTabs
          label="Tools by language"
          panels={{
            vhdl: (
              <>
                <p>
                  <strong>GHDL</strong> compiles and simulates VHDL and writes the waveform the Compare step reads.
                </p>
                {install([
                  ["Ubuntu, Debian, WSL", "sudo apt install ghdl"],
                  ["macOS (Homebrew)", "brew install ghdl"],
                  ["Windows", "MSYS2: pacman -S mingw-w64-ucrt-x86_64-ghdl-llvm — or use WSL"],
                ])}
              </>
            ),
            verilog: (
              <>
                <p>
                  <strong>Icarus Verilog</strong> is the easiest start; <strong>Verilator</strong> (version 5 or later) is faster
                  for long programs. The hardware kit has scripts for both.
                </p>
                {install([
                  ["Ubuntu, Debian, WSL", "sudo apt install iverilog verilator"],
                  ["macOS (Homebrew)", "brew install icarus-verilog verilator"],
                  ["Windows", "MSYS2: pacman -S mingw-w64-ucrt-x86_64-iverilog — or use WSL"],
                ])}
              </>
            ),
            systemverilog: (
              <>
                <p>
                  <strong>Icarus Verilog</strong> handles the SystemVerilog the bundled design uses (with <code>-g2012</code>, which
                  the kit passes); <strong>Verilator</strong> 5 supports much more of the language.
                </p>
                {install([
                  ["Ubuntu, Debian, WSL", "sudo apt install iverilog verilator"],
                  ["macOS (Homebrew)", "brew install icarus-verilog verilator"],
                  ["Windows", "MSYS2: pacman -S mingw-w64-ucrt-x86_64-iverilog — or use WSL"],
                ])}
              </>
            ),
          }}
        />
        <p className="small">
          To look at waveforms, install <strong>GTKWave</strong> (<code>sudo apt install gtkwave</code>) or use{" "}
          <strong>Surfer</strong>, which also runs in the browser. ModelSim/Questa and Vivado work too if your course uses them.
        </p>
      </section>

      <section className="stack stack--tight" aria-labelledby="first-h">
        <h2 id="first-h">Your first check in ten minutes</h2>
        <ol className="prose">
          {STEPS.map((s) => (
            <li key={s.name}>
              <strong>{s.name}.</strong> {s.text}
            </li>
          ))}
        </ol>
      </section>

      <section className="stack stack--tight" aria-labelledby="stuck-h">
        <h2 id="stuck-h">When you&apos;re stuck</h2>
        <ul className="prose">
          <li>
            <Link href="/docs/troubleshooting">Troubleshooting</Link> lists the app&apos;s messages and what to do about each.
          </li>
          <li>
            Every review finding links to its rule in <Link href="/docs/review-rules">Review rules</Link>, with why it matters and
            how to fix it.
          </li>
          <li>
            Upload in a mess? The structure check on the Code review page gives you a prompt to paste into an AI assistant.
          </li>
          <li>
            Short answers are in the <Link href="/faq">FAQ</Link>; the full walkthrough is the <Link href="/guide">Guide</Link>.
          </li>
          <li>
            Something wrong with Pipelith itself? Tell us on <a href={SITE.repo}>GitHub</a>.
          </li>
        </ul>
      </section>

      <section className="stack stack--tight" aria-labelledby="comfort-h">
        <h2 id="comfort-h">Make it comfortable</h2>
        <p>
          <strong>Display</strong> at the top of every page switches to dark colours, larger text, the Atkinson Hyperlegible
          typeface or reduced motion. Everything works with a keyboard: Tab moves between controls, arrow keys move between tabs,
          and <em>Skip to content</em> is the first stop on every page. See the{" "}
          <Link href="/accessibility">accessibility statement</Link>.
        </p>
      </section>
    </DocPage>
  );
}

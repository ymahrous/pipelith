import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd, articleLd } from "@/components/JsonLd";
import { WaveformLibrary } from "@/components/WaveformLibrary";
import { SITE } from "@/lib/site";

const DESCRIPTION =
  "Download waveforms for the standard test programs: what a correct 5- or 6-stage pipelined processor should show, and real simulations of the VHDL (GHDL) and Verilog (Icarus) reference designs. With a guide to reading them.";

export const metadata: Metadata = {
  title: "Standard test waveforms",
  description: DESCRIPTION,
  alternates: { canonical: "/waveforms" },
};

const SIGNALS: [string, string][] = [
  ["clk, reset", "The clock (100 ns period) and the active-low reset, held across two rising edges so PC can load M[0]."],
  ["pc_out", "The fetch PC: the address being fetched in each cycle. Holds still during stalls."],
  ["if_pc … wb_pc", "The address of the instruction in each stage (ex_pc on 5 stages, ex1_pc and ex2_pc on 6). x means a bubble: a stall or a flushed slot."],
  ["bubble", "1 in cycles where nothing new is fetched (a stall, a flush, an immediate word or a multi-cycle instruction)."],
  ["r0 … r7", "The registers. They change when the instruction that writes them reaches write-back."],
  ["sp_value", "The stack pointer (starts at FFF). PUSH, POP, CALL, RET, INT and RTI change it in the memory stage."],
  ["ex_ccr / ex1_ccr", "The flags: bit 0 is Z, bit 1 N, bit 2 C. ALU instructions set them in execute; a taken JZ/JN/JC clears its flag where branches resolve."],
  ["out_port, in_port", "The OUT port (changes at write-back of OUT) and the value the IN port supplies when an IN is fetched."],
  ["mem_write, mem_addr, mem_data", "One pulse per memory write (STD, PUSH, CALL, INT), with its address and data."],
];

export default function WaveformsPage() {
  return (
    <div className="step">
      <JsonLd data={articleLd(SITE, { path: "/waveforms", title: "Standard test waveforms", description: DESCRIPTION })} />
      <header className="step-head">
        <h1>Standard test waveforms</h1>
        <p>
          For each standard test program: the waveform a correct 5- or 6-stage pipeline should produce, and real simulations
          of the two reference processors. Open them in a waveform viewer next to your own, or compare yours in the{" "}
          <Link href="/workbench/compare">Compare step</Link>.
        </p>
      </header>
      <div className="split">
        <section className="stack" aria-labelledby="tests-h">
          <h2 id="tests-h">The four standard tests</h2>
          <WaveformLibrary />
        </section>
        <aside className="panel stack stack--tight" aria-label="About these waveforms">
          <h2>Expected or simulated?</h2>
          <p className="small">
            <strong>Expected</strong> waveforms come from the reference model and the pipeline timing estimate for your
            settings. Every value is exactly what the ISA says; the timing is what an in-order pipeline with that forwarding
            should need. No simulator or RTL is involved.
          </p>
          <p className="small">
            <strong>Simulated</strong> waveforms are real runs of the bundled designs with the same hardware kit you can
            download: the 6-stage VHDL processor in GHDL (it has real bugs — the Memory and Branch tests show them) and the
            5-stage Verilog processor in Icarus Verilog (it matches the model on every test).
          </p>
        </aside>
      </div>

      <section className="section stack" aria-labelledby="read-h">
        <h2 id="read-h">Reading a waveform</h2>
        <p className="prose">
          A VCD (value change dump) is a text file listing every change of every signal over time. Waveform viewers draw it as
          rows of traces: one row per signal, time running left to right. Start with <code>clk</code>, <code>pc_out</code> and
          the stage rows to see instructions move through the pipeline, then follow the register you care about.
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Signal</th>
                <th scope="col">What it shows</th>
              </tr>
            </thead>
            <tbody>
              {SIGNALS.map(([s, d]) => (
                <tr key={s}>
                  <td className="mono">{s}</td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Free viewers</h3>
        <ul className="prose small">
          <li>
            <strong>GTKWave</strong> — the classic desktop viewer for Windows, macOS and Linux: <code>gtkwave wave.vcd</code>.
          </li>
          <li>
            <strong>Surfer</strong> — a modern viewer that also runs in the browser (
            <a href="https://surfer-project.org">surfer-project.org</a>); open the .vcd file from your computer.
          </li>
          <li>
            <strong>VS Code</strong> — waveform extensions such as WaveTrace or VaporView open .vcd files in the editor.
          </li>
        </ul>
        <p className="small muted">
          Files ending in .vcd.gz are compressed: most viewers open them directly, or unpack them with{" "}
          <code>gunzip file.vcd.gz</code> (7-Zip on Windows). Pipelith reads both.
        </p>
      </section>
    </div>
  );
}

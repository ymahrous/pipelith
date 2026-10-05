import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_PROFILE } from "@/lib/isa/risc6";
import type { InstructionDef } from "@/lib/isa/profile";
import { geometry } from "@/lib/pipeline/pipeline";

export const metadata: Metadata = {
  title: "Instruction set",
  description:
    "The 32-bit pipelined RISC instruction set used by the reference model: encoding, every instruction, flags, vectors, and 5- and 6-stage pipeline layouts.",
  alternates: { canonical: "/isa" },
};

const bin5 = (n: number) => n.toString(2).padStart(5, "0");

export default function IsaPage() {
  const p = DEFAULT_PROFILE;
  const groups = p.instructions.reduce<Record<string, InstructionDef[]>>((acc, i) => {
    (acc[i.group] ??= []).push(i);
    return acc;
  }, {});
  const hex = (n: number) => "0x" + n.toString(16).toUpperCase();
  return (
    <div className="step">
      <header className="step-head">
        <h1>Instruction set</h1>
        <p>
          {p.name}. {p.description} This is the specification the reference model implements; the same table drives the
          assembler and disassembler.
        </p>
      </header>

      <section className="section" aria-labelledby="enc-h">
        <div className="section__head">
          <h2 id="enc-h">Instruction word</h2>
          <p>Two-word instructions put a 32-bit immediate or offset in the next word.</p>
        </div>
        <div className="bitfield" role="img" aria-label="Bits 31 to 27 opcode, 26 to 24 Rsrc1, 23 to 21 Rsrc2, 20 to 18 Rdst, 17 to 16 index, 15 to 0 unused">
          <div>
            <b>Opcode</b>
            <span>31–27</span>
          </div>
          <div>
            <b>Rsrc1</b>
            <span>26–24</span>
          </div>
          <div>
            <b>Rsrc2</b>
            <span>23–21</span>
          </div>
          <div>
            <b>Rdst</b>
            <span>20–18</span>
          </div>
          <div>
            <b>Idx</b>
            <span>17–16</span>
          </div>
          <div>
            <b>Unused</b>
            <span>15–0</span>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="sys-h">
        <div className="section__head">
          <h2 id="sys-h">Machine</h2>
        </div>
        <dl className="kv">
          <dt>Memory</dt>
          <dd>
            {p.memoryWords} words × {p.wordBits} bits (Von Neumann: code and data share it)
          </dd>
          <dt>Registers</dt>
          <dd>R0–R{p.registerCount - 1}, 32 bits</dd>
          <dt>Flags</dt>
          <dd>Z (zero), N (negative), C (carry)</dd>
          <dt>Stack pointer</dt>
          <dd>starts at {hex(p.spInit)}; PUSH writes then decrements</dd>
          <dt>Reset</dt>
          <dd>PC ← M[{p.resetVector}]</dd>
          <dt>External interrupt</dt>
          <dd>pushes PC, PC ← M[{p.extIntVector}]</dd>
          <dt>INT n</dt>
          <dd>
            pushes return address and flags, PC ← M[{p.intVectorBase} + n], n ∈ 0–{p.maxIntIndex}
          </dd>
          <dt>Comments</dt>
          <dd>#, ; or //. All numbers are hexadecimal.</dd>
        </dl>
      </section>

      {Object.entries(groups).map(([g, list]) => (
        <section key={g} className="section" aria-labelledby={`g-${g}`}>
          <div className="section__head">
            <h2 id={`g-${g}`}>{g}</h2>
          </div>
          <div className="panel panel--flush">
            <div className="table-wrap">
              <table className="data isa-table">
                <thead>
                  <tr>
                    <th scope="col">Syntax</th>
                    <th scope="col">Opcode</th>
                    <th scope="col">Words</th>
                    <th scope="col">Operation</th>
                    <th scope="col">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((i) => (
                    <tr key={i.mnemonic}>
                      <td>{i.syntax}</td>
                      <td className="mono">{bin5(i.opcode)}</td>
                      <td className="num">{i.words}</td>
                      <td>{i.summary}</td>
                      <td>{i.flags}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ))}

      <section className="section" aria-labelledby="pipe-h">
        <div className="section__head">
          <h2 id="pipe-h">Pipelines</h2>
          <p>The same instruction set runs on a 5- or 6-stage pipeline. The workbench supports both.</p>
        </div>
        <div className="panel panel--flush">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Depth</th>
                  <th scope="col">Stages</th>
                  <th scope="col">Pipeline registers</th>
                  <th scope="col">Branch resolved in</th>
                </tr>
              </thead>
              <tbody>
                {([5, 6] as const).map((d) => {
                  const g = geometry(d);
                  return (
                    <tr key={d}>
                      <td>{d}</td>
                      <td>{g.stageNames.join(" → ")}</td>
                      <td className="mono">{g.registers.join(", ")}</td>
                      <td>{g.stages[g.branchResolve]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section prose" aria-labelledby="amb-h">
        <h2 id="amb-h">Where the spec is ambiguous</h2>
        <ul className="small">
          <li>
            <strong>IADD immediate.</strong> The ISA sheet says both “sign-extended” and “zero-extended”. The model uses the
            immediate word as written unless you turn on sign extension in Simulate.
          </li>
          <li>
            <strong>SUB carry.</strong> The test programs treat C as “no borrow”; you can switch to “borrow”.
          </li>
          <li>
            <strong>External interrupt and RTI.</strong> The interrupt pushes only PC, but RTI pops flags and PC. The model
            warns when that leaves the stack off by one word.
          </li>
          <li>
            <strong>INT index bit.</strong> The assembler encodes the index in bits 17–16; the ISA sheet places it at bit 17.
          </li>
        </ul>
        <p className="small">
          <Link href="/workbench/program">Open the workbench</Link>
        </p>
      </section>
    </div>
  );
}

/**
 * Runs whenever Icarus Verilog is installed: generates the Verilog and
 * SystemVerilog kits for every bundled program, simulates the 5-stage
 * reference designs in reference/ and compares the waveforms with the
 * reference model. Both designs must match the model on every channel.
 * With Verilator 5 installed, the kit's Verilator script is run as well.
 *
 *   npx vitest run src/lib/icarus.integration.test.ts
 *
 * Refresh public/samples/verilog/*.vcd.gz after changing the Verilog design
 * with UPDATE_SAMPLES=1.
 */
import { execFileSync, execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { toMemFile } from "./asm/assembler";
import { autoMap, compareTrace, judgeTiming, mappedPaths } from "./compare/compare";
import { EXAMPLES } from "./examples/programs";
import type { Hdl } from "./hdl";
import { describeForwarding, estimateTiming, geometry, suggestedCycles } from "./pipeline/pipeline";
import { analyze } from "./session/analyze";
import { emptySession } from "./session/session";
import { generateTestbench } from "./tb/testbench";
import { VcdParser } from "./vcd/parser";

const has = (cmd: string) => {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const hasIcarus = has("iverilog -V");
const hasVerilator = (() => {
  try {
    return Number(/Verilator (\d+)/.exec(execSync("verilator --version").toString())?.[1] ?? 0) >= 5;
  } catch {
    return false;
  }
})();

const RTL: Record<"verilog" | "systemverilog", string> = {
  verilog: join(__dirname, "../../reference/verilog/rtl"),
  systemverilog: join(__dirname, "../../reference/systemverilog/rtl"),
};

function run(hdl: "verilog" | "systemverilog", id: string, script = "run_icarus.sh") {
  const ex = EXAMPLES.find((e) => e.id === id)!;
  const a = analyze({ ...emptySession(), source: ex.source, stages: 5, hdl });
  const dir = mkdtempSync(join(tmpdir(), `pipelith-${hdl}-${id}-`));
  const tb = generateTestbench({
    profile: a.profile,
    memFileName: "program.mem",
    inputs: a.inputs,
    interrupts: [],
    cycles: suggestedCycles(a.timing!),
    rtlRoot: RTL[hdl],
    stages: 5,
    forwardingNote: describeForwarding(geometry(5), a.timing!.forwarding),
    hdl,
  });
  writeFileSync(join(dir, "program.mem"), toMemFile(a.memory, a.profile));
  for (const f of tb.files) writeFileSync(join(dir, f.name), f.content);
  chmodSync(join(dir, script), 0o755);
  execFileSync(`./${script}`, { cwd: dir, stdio: "pipe" });
  const text = readFileSync(join(dir, "wave.vcd"), "utf8");
  const p = new VcdParser((s) => mappedPaths(autoMap(s, a.profile.hardware, 5)));
  p.push(text);
  const vcd = p.end();
  const map = autoMap(vcd.signals, a.profile.hardware, 5);
  const rep = compareTrace(a.sim!, vcd, map, 8, new Set(a.memory.keys()));
  return { a, rep, text, map };
}

const designs: ("verilog" | "systemverilog")[] = ["verilog", "systemverilog"];

describe.skipIf(!hasIcarus)("Icarus Verilog round trip on the 5-stage reference designs", () => {
  for (const hdl of designs) {
    describe.skipIf(!existsSync(RTL[hdl]))(hdl, () => {
      for (const ex of EXAMPLES) {
        it(`${ex.file}: every channel matches the model and the timing fits 5 stages`, () => {
          const { a, rep, text, map } = run(hdl, ex.id);
          expect(map.registers.every((r) => r !== null)).toBe(true);
          expect(map.flags).toMatch(/\.ccr$/);
          const bad = rep.channels.filter((c) => c.status !== "match").map((c) => `${c.label}: ${c.summary}`);
          expect(bad).toEqual([]);
          const est = estimateTiming(a.sim!, a.profile, 5);
          const verdict = judgeTiming(rep.lastChangeCycle!, est.lastResultCycle, 5);
          expect(verdict.tone).toBe("ok");
          if (process.env.UPDATE_SAMPLES && hdl === "verilog") {
            const out = join(__dirname, "../../public/samples/verilog");
            mkdirSync(out, { recursive: true });
            writeFileSync(join(out, `${ex.id}.vcd.gz`), gzipSync(text, { level: 9 }));
          }
        }, 60_000);
      }
    });
  }

  describe.skipIf(!hasVerilator)("Verilator 5", () => {
    for (const hdl of designs) {
      it(`${hdl}: the Verilator script simulates Branch.asm and every channel matches`, () => {
        const { rep } = run(hdl, "branch", "run_verilator.sh");
        expect(rep.channels.filter((c) => c.status !== "match").map((c) => c.label)).toEqual([]);
      }, 600_000);
    }
  });

  it("the kit's script names every file of the design", () => {
    const a = analyze({ ...emptySession(), source: EXAMPLES[0].source, hdl: "verilog" as Hdl });
    const tb = generateTestbench({ profile: a.profile, memFileName: "program.mem", inputs: a.inputs, interrupts: [], cycles: 50, rtlRoot: "rtl", hdl: "verilog" });
    const script = tb.files.find((f) => f.name === "run_icarus.sh")!.content;
    expect(script.match(/^ {2}"\$RTL\//gm)?.length).toBe(a.profile.hardware.verilog!.compileOrder.length);
  });
});

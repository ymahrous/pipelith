/**
 * Opt-in: generates the testbench for every bundled program, runs it in GHDL
 * against real RTL and compares the waveform with the reference model.
 *
 *   RTL_DIR=/path/to/risc-pipelined-processor/src/rtl npm test
 *
 * Skipped when GHDL or RTL_DIR is missing. Use it to refresh
 * public/samples/*.vcd.gz after an RTL change (set UPDATE_SAMPLES=1).
 */
import { execFileSync, execSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { toMemFile } from "./asm/assembler";
import { autoMap, compareTrace, mappedPaths } from "./compare/compare";
import { EXAMPLES } from "./examples/programs";
import { analyze } from "./session/analyze";
import { emptySession } from "./session/session";
import { generateTestbench } from "./tb/testbench";
import { VcdParser } from "./vcd/parser";
import { reviewCodebase } from "./review/review";
import { readdirSync, statSync } from "node:fs";
import { relative } from "node:path";

const rtl = process.env.RTL_DIR;
let hasGhdl = false;
try {
  execSync("ghdl --version", { stdio: "ignore" });
  hasGhdl = true;
} catch {
  /* not installed */
}

describe.skipIf(!rtl || !hasGhdl)("GHDL round trip", () => {
  it("compiles the RTL in the order Code review computes", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    const files = walk(rtl!).filter((p) => p.endsWith(".vhd")).map((p) => ({ path: relative(rtl!, p), text: readFileSync(p, "utf8") }));
    const r = reviewCodebase(files, 6);
    const a = analyze({ ...emptySession(), source: EXAMPLES[0].source });
    const tb = generateTestbench({ profile: a.profile, memFileName: "program.mem", inputs: a.inputs, interrupts: [], cycles: 50, rtlRoot: rtl!, compileOrder: r.compileOrder });
    const dir = mkdtempSync(join(tmpdir(), "pipelith-order-"));
    writeFileSync(join(dir, "program.mem"), toMemFile(a.memory, a.profile));
    for (const f of tb.files) writeFileSync(join(dir, f.name), f.content);
    chmodSync(join(dir, "run_ghdl.sh"), 0o755);
    execFileSync("./run_ghdl.sh", { cwd: dir, stdio: "ignore" });
    expect(readFileSync(join(dir, "wave.vcd"), "utf8").length).toBeGreaterThan(1000);
  }, 120_000);

  for (const ex of EXAMPLES) {
    it(`simulates ${ex.file} and compares the waveform`, () => {
      const a = analyze({ ...emptySession(), source: ex.source });
      const dir = mkdtempSync(join(tmpdir(), `pipelith-${ex.id}-`));
      const tb = generateTestbench({
        profile: a.profile,
        memFileName: "program.mem",
        inputs: a.inputs,
        interrupts: [],
        cycles: a.sim!.events.length * 8 + 50,
        rtlRoot: rtl!,
      });
      writeFileSync(join(dir, "program.mem"), toMemFile(a.memory, a.profile));
      for (const f of tb.files) writeFileSync(join(dir, f.name), f.content);
      chmodSync(join(dir, "run_ghdl.sh"), 0o755);
      execFileSync("./run_ghdl.sh", { cwd: dir, stdio: "ignore" });
      const text = readFileSync(join(dir, "wave.vcd"), "utf8");
      if (process.env.UPDATE_SAMPLES) {
        writeFileSync(join(__dirname, "../../public/samples", `${ex.id}.vcd.gz`), gzipSync(text, { level: 9 }));
      }
      const p = new VcdParser((s) => mappedPaths(autoMap(s, a.profile.hardware)));
      p.push(text);
      const vcd = p.end();
      const rep = compareTrace(a.sim!, vcd, autoMap(vcd.signals, a.profile.hardware), 8, new Set(a.memory.keys()));
      expect(rep.channels.some((c) => c.status !== "missing")).toBe(true);
    }, 120_000);
  }
});

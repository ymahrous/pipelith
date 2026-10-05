import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../examples/programs";
import { analyze } from "../session/analyze";
import { emptySession } from "../session/session";
import { VcdParser } from "../vcd/parser";
import { autoMap, compareTrace, mappedPaths } from "./compare";

/** Real GHDL waveforms of the reference RTL, produced by the generated testbench. */
function run(id: string) {
  const ex = EXAMPLES.find((e) => e.id === id)!;
  const a = analyze({ ...emptySession(), source: ex.source });
  const text = gunzipSync(readFileSync(join(__dirname, "../../../public/samples", `${id}.vcd.gz`))).toString("utf8");
  const p = new VcdParser((s) => mappedPaths(autoMap(s, a.profile.hardware)));
  p.push(text);
  const vcd = p.end();
  const map = autoMap(vcd.signals, a.profile.hardware);
  return { map, rep: compareTrace(a.sim!, vcd, map, 8, new Set(a.memory.keys())) };
}
const status = (rep: ReturnType<typeof run>["rep"], id: string) => rep.channels.find((c) => c.id === id)?.status;

describe("hardware comparison on real GHDL traces", () => {
  it("finds the processor instance and its signals", () => {
    const { map } = run("one-operand");
    expect(map.registers[1]).toBe("tb_processor.uut.r1");
    expect(map.clock).toBe("tb_processor.uut.clk");
    expect(map.pc).toBe("tb_processor.uut.pc_out");
  });

  it("TwoOperand: the RTL matches the model on every channel", () => {
    const { rep } = run("two-operand");
    expect(rep.failed).toBe(0);
    expect(rep.resetReleaseNs).toBe(210);
  });

  it("OneOperand: registers and OUT match; flags show IN/SETC changing flags", () => {
    const { rep } = run("one-operand");
    expect(["r1", "r2", "out", "sp"].map((c) => status(rep, c))).toEqual(["match", "match", "match", "match"]);
    const flags = rep.channels.find((c) => c.id === "flags")!;
    expect(flags.status).toBe("mismatch");
    expect(flags.summary).toMatch(/inserts/);
  });

  it("Memory: POP returns the wrong value (PUSH stores R0)", () => {
    const { rep } = run("memory");
    const r1 = rep.channels.find((c) => c.id === "r1")!;
    expect(r1.status).toBe("mismatch");
    expect(r1.summary).toMatch(/POP R1/);
    expect(status(rep, "sp")).toBe("match");
  });

  it("Branch: control flow leaves the program after the first taken JZ", () => {
    const { rep } = run("branch");
    const pc = rep.channels.find((c) => c.id === "pc")!;
    expect(pc.status).toBe("mismatch");
    expect(pc.summary).toMatch(/0x10000000/);
  });
});

describe("comparison logic", () => {
  it("reports missing mappings instead of failing", () => {
    const ex = EXAMPLES[0];
    const a = analyze({ ...emptySession(), source: ex.source });
    const p = new VcdParser(() => new Set());
    p.push("$timescale 1ns $end $scope module t $end $var reg 1 ! clk $end $upscope $end $enddefinitions $end #0 0! #5 1!");
    const vcd = p.end();
    const rep = compareTrace(a.sim!, vcd, autoMap(vcd.signals, a.profile.hardware), 8);
    expect(rep.channels.every((c) => c.status === "missing")).toBe(true);
    expect(rep.failed).toBe(0);
  });
});

describe("timing against the selected depth", () => {
  it("the reference RTL's run time fits the 6-stage estimate better than the 5-stage one", async () => {
    const { estimateTiming } = await import("../pipeline/pipeline");
    const { judgeTiming } = await import("./compare");
    const ex = EXAMPLES.find((e) => e.id === "one-operand")!;
    const a = analyze({ ...emptySession(), source: ex.source });
    const { rep } = run("one-operand");
    expect(rep.lastChangeCycle).not.toBeNull();
    const six = judgeTiming(rep.lastChangeCycle!, estimateTiming(a.sim!, a.profile, 6).lastResultCycle, 6);
    const five = judgeTiming(rep.lastChangeCycle!, estimateTiming(a.sim!, a.profile, 5).lastResultCycle, 5);
    expect(six.ratio).toBe(1); // 17 cycles in GHDL, 17 estimated
    expect(six.tone).toBe("ok");
    expect(Math.abs(six.ratio - 1)).toBeLessThan(Math.abs(five.ratio - 1));
  });
});

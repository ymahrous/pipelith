import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../examples/programs";
import { analyze } from "../session/analyze";
import { emptySession } from "../session/session";
import { assemble } from "../asm/assembler";
import { risc6 } from "../isa/risc6";
import { simulate } from "../sim/simulator";
import { estimateTiming, geometry, registerReads, suggestedCycles } from "./pipeline";

const run = (body: string) => {
  const asm = assemble(`.ORG 0\n10\n.ORG 10\n${body}`, risc6);
  return simulate({ profile: risc6, options: risc6.defaultOptions, memory: asm.memory, sourceMap: asm.sourceMap, inputs: new Map(), interrupts: [], maxSteps: 1000 });
};

describe("pipeline geometry", () => {
  it("describes both depths", () => {
    expect(geometry(5).stages).toEqual(["IF", "ID", "EX", "MEM", "WB"]);
    expect(geometry(6).registers).toHaveLength(5);
    expect(geometry(5).forwardingSources).toHaveLength(2);
  });
  it("knows which registers an instruction reads", () => {
    const w = assemble("ADD R1, R2, R3", risc6).memory.get(0)!;
    expect(registerReads(w, risc6)).toEqual([2, 3]);
  });
});

describe("timing estimate", () => {
  it("fills the pipeline: n independent one-word instructions take n + depth - 1 cycles", () => {
    const sim = run("NOP\nNOP\nNOP\nHLT");
    expect(estimateTiming(sim, risc6, 5).totalCycles).toBe(4 + 4);
    expect(estimateTiming(sim, risc6, 6).totalCycles).toBe(4 + 5);
  });
  it("load-use costs one stall on 5 stages and two on 6", () => {
    const sim = run("POP R1\nADD R2, R1, R1\nHLT");
    expect(estimateTiming(sim, risc6, 5).stalls["load-use"]).toBe(1);
    expect(estimateTiming(sim, risc6, 6).stalls["load-use"]).toBe(2);
    // One instruction in between hides the 5-stage stall completely.
    const spaced = run("POP R1\nNOP\nADD R2, R1, R1\nHLT");
    expect(estimateTiming(spaced, risc6, 5).stalls["load-use"]).toBe(0);
    expect(estimateTiming(spaced, risc6, 6).stalls["load-use"]).toBe(1);
  });
  it("a taken conditional branch costs more on the deeper pipeline", () => {
    const sim = run("SUB R1, R1, R1\nJZ 20\nHLT\n.ORG 20\nHLT");
    expect(estimateTiming(sim, risc6, 5).stalls.branch).toBe(1);
    expect(estimateTiming(sim, risc6, 6).stalls.branch).toBe(2);
  });
  it("estimates every bundled program, and the kit length covers it", () => {
    for (const ex of EXAMPLES) {
      const a = analyze({ ...emptySession(), source: ex.source });
      for (const d of [5, 6] as const) {
        const t = estimateTiming(a.sim!, risc6, d);
        expect(t.totalCycles).toBeGreaterThan(a.sim!.events.length);
        expect(suggestedCycles(t)).toBeGreaterThan(t.totalCycles);
      }
      expect(estimateTiming(a.sim!, risc6, 6).totalCycles).toBeGreaterThanOrEqual(estimateTiming(a.sim!, risc6, 5).totalCycles);
    }
  });
});

describe("forwarding settings", () => {
  const dep = () => run("LDM R1, 1\nNOP\nADD R2, R1, R1\nADD R3, R2, R2\nHLT");
  const cfg = (paths: "all" | string[], enabled = true, writeThrough = true) => ({ enabled, paths, writeThrough });
  it("full forwarding removes ALU-to-ALU stalls", () => {
    for (const d of [5, 6] as const) expect(estimateTiming(dep(), risc6, d, cfg("all")).stalls.data).toBe(0);
  });
  it("no forwarding stalls until write-back, more on the deeper pipeline", () => {
    // ADD R2 is far enough from LDM on 5 stages (the NOP and the immediate slot hide it) but not on 6;
    // ADD R3 depends on the ADD right before it: 2 stalls on 5 stages, 3 on 6.
    expect(estimateTiming(dep(), risc6, 5, cfg([], false)).stalls.data).toBe(0 + 2);
    expect(estimateTiming(dep(), risc6, 6, cfg([], false)).stalls.data).toBe(1 + 3);
  });
  it("without register-file write-through every hazard costs one more cycle", () => {
    const a = estimateTiming(dep(), risc6, 5, cfg([], false, true)).stalls.data;
    const b = estimateTiming(dep(), risc6, 5, cfg([], false, false)).stalls.data;
    expect(b).toBeGreaterThan(a);
  });
  it("partial forwarding only helps through the paths that exist", () => {
    // 5 stages, MEM/WB only: a back-to-back dependency waits one cycle.
    const prog = () => run("NOT R1\nADD R2, R1, R1\nHLT");
    expect(estimateTiming(prog(), risc6, 5, cfg(["MEM/WB"])).stalls.data).toBe(1);
    expect(estimateTiming(prog(), risc6, 5, cfg(["EX/MEM"])).stalls.data).toBe(0);
    expect(estimateTiming(prog(), risc6, 6, cfg(["MEM/WB"])).stalls.data).toBe(2);
  });
  it("describes the configuration", async () => {
    const { describeForwarding } = await import("./pipeline");
    expect(describeForwarding(geometry(5), cfg("all"))).toBe("full forwarding (EX/MEM, MEM/WB)");
    expect(describeForwarding(geometry(6), cfg(["MEM/WB"]))).toBe("partial forwarding (MEM/WB only)");
    expect(describeForwarding(geometry(6), cfg([], false))).toMatch(/^no forwarding/);
  });
});

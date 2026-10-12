import { describe, expect, it } from "vitest";
import { autoMap, compareTrace, judgeTiming, mappedPaths } from "../compare/compare";
import { EXAMPLES } from "../examples/programs";
import { FULL_FORWARDING, NO_FORWARDING, geometry, type Depth, type ForwardingConfig } from "../pipeline/pipeline";
import { analyze } from "../session/analyze";
import { emptySession } from "../session/session";
import { VcdParser } from "../vcd/parser";
import { expectedWaveform } from "./expected";

const partial = (d: Depth): ForwardingConfig => ({ enabled: true, paths: [geometry(d).forwardingSources.at(-1)!], writeThrough: true });
const SETUPS: [string, (d: Depth) => ForwardingConfig][] = [
  ["full forwarding", () => FULL_FORWARDING],
  ["partial forwarding", partial],
  ["no forwarding", () => NO_FORWARDING],
];

function roundTrip(id: string, depth: Depth, forwarding: ForwardingConfig, maxCycles?: number) {
  const ex = EXAMPLES.find((e) => e.id === id)!;
  const a = analyze({ ...emptySession(), source: ex.source, stages: depth, forwarding });
  const w = expectedWaveform({ profile: a.profile, sim: a.sim!, timing: a.timing!, programName: ex.file, maxCycles });
  const p = new VcdParser((s) => mappedPaths(autoMap(s, a.profile.hardware, depth)));
  p.push(w.vcd);
  const vcd = p.end();
  const map = autoMap(vcd.signals, a.profile.hardware, depth);
  return { a, w, vcd, map, rep: compareTrace(a.sim!, vcd, map, 8, new Set(a.memory.keys())) };
}

describe("expected waveforms for the standard tests", () => {
  for (const depth of [5, 6] as Depth[]) {
    for (const [label, fwd] of SETUPS) {
      for (const ex of EXAMPLES) {
        it(`${ex.file}, ${depth} stages, ${label}: matches the model and the timing estimate`, () => {
          const { a, rep, map } = roundTrip(ex.id, depth, fwd(depth));
          expect(map.registers.every((r) => r !== null)).toBe(true);
          expect([map.sp, map.flags, map.out, map.pc, map.clock, map.reset].every((x) => x !== null)).toBe(true);
          expect(rep.channels.filter((c) => c.status !== "match").map((c) => `${c.label}: ${c.summary}`)).toEqual([]);
          const verdict = judgeTiming(rep.lastChangeCycle!, a.timing!.lastResultCycle, depth, fwd(depth));
          expect(verdict.tone).toBe("ok");
          expect(rep.lastChangeCycle).toBeLessThanOrEqual(a.timing!.lastResultCycle);
        });
      }
    }
  }

  it("names the flags after the depth and shows every stage", () => {
    const five = roundTrip("memory", 5, FULL_FORWARDING);
    const six = roundTrip("memory", 6, FULL_FORWARDING);
    expect(five.map.flags).toBe("tb_processor.uut.ex_ccr");
    expect(six.map.flags).toBe("tb_processor.uut.ex1_ccr");
    expect(five.w.signals).toEqual(expect.arrayContaining(["tb_processor.uut.if_pc", "tb_processor.uut.wb_pc", "tb_processor.uut.mem_write"]));
    expect(six.w.signals).toEqual(expect.arrayContaining(["tb_processor.uut.ex1_pc", "tb_processor.uut.ex2_pc"]));
    expect(six.w.cycles).toBeGreaterThan(five.w.cycles);
  });

  it("is deterministic and says what it is", () => {
    const one = roundTrip("branch", 6, FULL_FORWARDING).w.vcd;
    const two = roundTrip("branch", 6, FULL_FORWARDING).w.vcd;
    expect(one).toBe(two);
    expect(one).toMatch(/^\$version Pipelith expected waveform \$end/);
    expect(one).toMatch(/not by a simulator/);
    expect(one).not.toMatch(/\$date/);
  });

  it("stops at the cycle limit and still parses", () => {
    const { w, rep } = roundTrip("branch", 5, NO_FORWARDING, 10);
    expect(w.truncated).toBe(true);
    expect(w.cycles).toBe(10);
    expect(rep.cyclesAfterReset).toBeGreaterThanOrEqual(10);
  });

  it("keeps a hostile program name out of the header", () => {
    const ex = EXAMPLES[0];
    const a = analyze({ ...emptySession(), source: ex.source });
    const w = expectedWaveform({ profile: a.profile, sim: a.sim!, timing: a.timing!, programName: "x $end $var wire 1 ! evil $end" });
    expect(w.vcd).not.toContain("evil $end");
  });
});

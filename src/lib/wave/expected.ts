/**
 * Expected waveform: what a correct design with the selected pipeline depth
 * and forwarding should show, written as a standard VCD (IEEE 1364 §18).
 *
 * It is built from the reference model's trace and the timing estimate — no
 * simulator, no RTL — so a beginner can open it in GTKWave or Surfer next to
 * their own waveform, and the Compare step reads it like a real simulation.
 * Signal names follow the profile's hardware binding (tb_processor.uut.r1 …).
 *
 * Values change in the cycle the estimate puts the producing instruction in
 * the stage that writes them: registers and OUT at write-back, ALU flags at
 * execute (a taken branch clears its flag where branches resolve, RTI restores
 * flags in memory), SP and memory writes in the memory stage. Each stage also
 * gets a <stage>_pc signal holding the address of the instruction in it, or x
 * for a bubble, so the pipeline is visible cycle by cycle.
 */
import type { ProcessorProfile } from "../isa/profile";
import { describeForwarding, type TimingEstimate } from "../pipeline/pipeline";
import { BRAND } from "../site";
import { FLAG_C, FLAG_N, FLAG_Z, type SimResult } from "../sim/simulator";

export interface ExpectedWaveOptions {
  profile: ProcessorProfile;
  sim: SimResult;
  timing: TimingEstimate;
  programName: string;
  /** Stop after this many cycles after reset (default 50,000). */
  maxCycles?: number;
}

export interface ExpectedWave {
  vcd: string;
  /** Clock cycles after reset that the file covers. */
  cycles: number;
  truncated: boolean;
  signals: string[];
}

export const MAX_EXPECTED_CYCLES = 50_000;

interface Sig {
  name: string;
  width: number;
  code: string;
  initial: number | null;
}

/** VCD identifier codes: printable ASCII 33..126, base 94. */
function code(i: number): string {
  let s = "";
  do {
    s += String.fromCharCode(33 + (i % 94));
    i = Math.floor(i / 94);
  } while (i > 0);
  return s;
}

const fmt = (s: Sig, v: number | null) =>
  s.width === 1 ? `${v === null ? "x" : v & 1}${s.code}` : `b${v === null ? "x" : (v >>> 0).toString(2)} ${s.code}`;

/** Hardware flag-register value for the model's flags. */
function hwFlags(f: number, bits: ProcessorProfile["hardware"]["flagBits"]): number {
  return ((f & FLAG_Z ? 1 : 0) << bits.Z) | ((f & FLAG_N ? 1 : 0) << bits.N) | ((f & FLAG_C ? 1 : 0) << bits.C);
}

export function expectedWaveform(o: ExpectedWaveOptions): ExpectedWave {
  const { profile, sim, timing } = o;
  const hw = profile.hardware;
  const g = timing.geometry;
  // Times in picoseconds, so any clock period with up to three decimals stays an integer.
  const period = 2 * Math.round(hw.clockPeriodNs * 500);
  const half = period / 2;
  const release = Math.round(period * 2 + half / 5);
  const firstEdge = (Math.floor(release / period) + 1) * period;
  const edge = (c: number) => firstEdge + (c - 1) * period;
  const limit = Math.max(1, Math.floor(o.maxCycles ?? MAX_EXPECTED_CYCLES));
  const wanted = timing.totalCycles + 3;
  const cycles = Math.min(wanted, limit);
  const truncated = wanted > limit;

  // Signals, in the order a waveform viewer lists them.
  const sigs: Sig[] = [];
  const add = (name: string, width: number, initial: number | null) => {
    const s = { name, width, code: code(sigs.length), initial };
    sigs.push(s);
    return s;
  };
  const clk = add(hw.clockPort, 1, 1);
  const rst = add(hw.resetPort, 1, hw.resetActive === "low" ? 0 : 1);
  const pc = add(hw.pcSignal, 32, sim.initial.pc);
  const regs = hw.registerSignals.map((n, i) => add(n, 32, sim.initial.regs[i] ?? 0));
  const sp = add(hw.spSignal, 32, sim.initial.sp);
  const flagsName = hw.flagsCandidates?.[g.depth]?.[0] ?? hw.flagsSignal;
  const flags = add(flagsName, 3, hwFlags(sim.initial.flags, hw.flagBits));
  const out = add(hw.outPort, 32, 0);
  const inp = add(hw.inPort, 32, 0);
  const memWe = add("mem_write", 1, 0);
  const memAddr = add("mem_addr", 32, null);
  const memData = add("mem_data", 32, null);
  const stagePc = g.stages.map((st) => add(`${st.toLowerCase()}_pc`, 32, null));
  const bubble = add("bubble", 1, 0);

  // Changes: time (ns) → list of [signal, value]. Each channel keeps strictly increasing times.
  const changes = new Map<number, [Sig, number | null][]>();
  const lastTime = new Map<Sig, number>();
  const put = (s: Sig, cycle: number, v: number | null) => {
    if (cycle > cycles) return;
    const t = Math.max(edge(cycle) + 1000, (lastTime.get(s) ?? 0) + 1);
    lastTime.set(s, t);
    const l = changes.get(t) ?? [];
    l.push([s, v]);
    changes.set(t, l);
  };

  // Clock and reset.
  for (let t = half; t <= edge(cycles) + half; t += half) {
    const l = changes.get(t) ?? [];
    l.push([clk, Math.round(t / half) % 2 === 0 ? 1 : 0]);
    changes.set(t, l);
  }
  changes.set(release, [...(changes.get(release) ?? []), [rst, hw.resetActive === "low" ? 1 : 0]]);

  // Stage occupancy: which instruction is in each stage in each cycle.
  const occ: (number | null)[][] = g.stages.map(() => new Array<number | null>(cycles + 2).fill(null));
  const ti = timing.instructions;
  for (const t of ti) {
    if (t.event.kind !== "instruction") continue;
    for (let s = 0; s < g.depth; s++) {
      const c = t.fetch + s;
      if (c <= cycles) occ[s][c] = t.event.pc;
    }
  }
  for (let s = 0; s < g.depth; s++) {
    let prev: number | null | undefined = undefined;
    for (let c = 1; c <= cycles; c++) {
      const v = occ[s][c];
      if (v !== prev) put(stagePc[s], c, v);
      prev = v;
    }
  }
  let prevBubble = 0;
  for (let c = 1; c <= cycles; c++) {
    const b = occ[0][c] === null ? 1 : 0;
    if (b !== prevBubble) put(bubble, c, b);
    prevBubble = b;
  }

  // Architectural state, instruction by instruction.
  let pcNow = sim.initial.pc;
  let inNow = 0;
  for (let i = 0; i < ti.length; i++) {
    const t = ti[i];
    const e = t.event;
    const next = ti[i + 1];
    if (e.kind === "instruction") {
      if (e.pc !== pcNow) put(pc, t.fetch, e.pc);
      pcNow = e.pc;
      const inVal = e.in ?? 0;
      if (inVal !== inNow) put(inp, t.fetch, inVal);
      inNow = inVal;
      // A two-word instruction fetches its immediate in the next cycle.
      if (next && (next.stalls.immediate ?? 0) > 0 && next.fetch > t.fetch + 1) {
        put(pc, t.fetch + 1, e.pc + 1);
        pcNow = e.pc + 1;
      }
    }
    const wb = t.writeback;
    for (const w of e.regWrites) if (regs[w.reg]) put(regs[w.reg], wb, w.after);
    if (e.out !== undefined) put(out, wb, e.out);
    if (e.flagsAfter !== e.flagsBefore) {
      const conditional = ["JZ", "JN", "JC"].includes(e.mnemonic);
      const stage = e.mnemonic === "RTI" ? g.memory : conditional ? g.branchResolve : g.execute;
      put(flags, t.fetch + stage, hwFlags(e.flagsAfter, hw.flagBits));
    }
    e.spTrail.forEach((v, j) => put(sp, t.fetch + g.memory + j, v));
    e.memWrites.forEach((w, j) => {
      const c = t.fetch + g.memory + j;
      put(memWe, c, 1);
      put(memAddr, c, w.addr);
      put(memData, c, w.after);
      put(memWe, c + 1, 0);
    });
  }

  // Write the file.
  const L: string[] = [];
  const safeName = o.programName.replace(/[^A-Za-z0-9 ._()-]/g, "").slice(0, 80) || "program";
  L.push(`$version ${BRAND} expected waveform $end`);
  L.push(
    `$comment ${safeName}: what a correct ${g.depth}-stage design with ${describeForwarding(g, timing.forwarding)} should show. Generated from the reference model and the pipeline timing estimate, not by a simulator. $end`,
  );
  L.push("$timescale 1ps $end");
  L.push("$scope module tb_processor $end");
  L.push(`$scope module uut $end`);
  for (const s of sigs) L.push(`$var wire ${s.width} ${s.code} ${s.name}${s.width > 1 ? ` [${s.width - 1}:0]` : ""} $end`);
  L.push("$upscope $end", "$upscope $end", "$enddefinitions $end", "#0", "$dumpvars");
  for (const s of sigs) L.push(fmt(s, s.initial));
  L.push("$end");
  for (const t of [...changes.keys()].sort((a, b) => a - b)) {
    if (t === 0) continue;
    L.push(`#${t}`);
    for (const [s, v] of changes.get(t)!) L.push(fmt(s, v));
  }
  L.push(`#${edge(cycles) + period}`);
  return { vcd: L.join("\n") + "\n", cycles, truncated, signals: sigs.map((s) => `tb_processor.uut.${s.name}`) };
}

/**
 * Hardware-vs-model comparison.
 *
 * A pipelined design commits results at different cycles than the
 * one-instruction-per-step model, so we compare *sequences of distinct
 * values* per architectural signal (each register, SP, flags, OUT port).
 * If R3 takes the values 0 → 19 → 5 in the model, it must take exactly
 * those values, in that order, in the waveform. Timing does not matter;
 * order and content do.
 */
import { hex } from "../asm/assembler";
import type { HardwareBinding } from "../isa/profile";
import { describeForwarding, FULL_FORWARDING, geometry, type ForwardingConfig } from "../pipeline/pipeline";
import type { SimResult, StepEvent } from "../sim/simulator";
import { FLAG_C, FLAG_N, FLAG_Z, flagsToString } from "../sim/simulator";
import type { VcdData, VcdSignalInfo } from "../vcd/parser";
import { vcdToNumber } from "../vcd/parser";

export interface SignalMapping {
  clock: string | null;
  reset: string | null;
  resetActive: "low" | "high";
  registers: (string | null)[];
  sp: string | null;
  flags: string | null;
  out: string | null;
  pc: string | null;
  flagBits: HardwareBinding["flagBits"];
}

export type ChannelId = `r${number}` | "sp" | "flags" | "out" | "pc";

export interface RefPoint {
  value: number;
  event?: StepEvent; // undefined for the initial value
}
export interface HwPoint {
  value: number;
  timeNs: number;
  cycle: number | null;
}

export interface ChannelResult {
  id: ChannelId;
  label: string;
  signal: string | null;
  status: "match" | "mismatch" | "incomplete" | "missing" | "extra";
  ref: RefPoint[];
  hw: HwPoint[];
  /** Index of the first differing value. */
  divergeAt: number | null;
  undefinedAfterReset: number;
  summary: string;
  format: (v: number) => string;
}

export interface CompareReport {
  channels: ChannelResult[];
  resetReleaseNs: number | null;
  cyclesAfterReset: number | null;
  passed: number;
  failed: number;
  firstDivergence: { channel: ChannelResult; ref?: RefPoint; hw?: HwPoint } | null;
  /** Cycle (after reset) of the last change on any architectural channel — when the design finished. */
  lastChangeCycle: number | null;
  warnings: string[];
}

export interface TimingVerdict {
  hardware: number;
  estimate: number;
  ratio: number;
  tone: "ok" | "warn";
  message: string;
}

/** Compare how long the hardware took with the timing estimate for the chosen depth. */
export function judgeTiming(
  hardwareCycles: number,
  estimateCycles: number,
  depth: 5 | 6,
  forwarding: ForwardingConfig = FULL_FORWARDING,
): TimingVerdict {
  const ratio = estimateCycles ? hardwareCycles / estimateCycles : 1;
  const diff = hardwareCycles - estimateCycles;
  const setup = `a ${depth}-stage pipeline with ${describeForwarding(geometry(depth), forwarding)}`;
  let message: string;
  let tone: TimingVerdict["tone"] = "ok";
  if (Math.abs(ratio - 1) <= 0.2) {
    message = `Consistent with ${setup} (${diff >= 0 ? "+" : ""}${diff} cycles against the estimate).`;
  } else if (ratio > 1) {
    tone = "warn";
    message = `${diff} cycles slower than ${setup} would take. Look for stalls that aren't needed or missing forwarding paths — or select less forwarding, or a deeper pipeline, if that is what the design has.`;
  } else {
    tone = "warn";
    message = `${-diff} cycles faster than the estimate for ${setup}. The design may forward more than selected, have fewer stages, or skip stalls the hazards require.`;
  }
  return { hardware: hardwareCycles, estimate: estimateCycles, ratio, tone, message };
}

const fsToNs = (t: number) => t / 1e6;

function collapse<T extends { value: number }>(xs: T[]): T[] {
  const out: T[] = [];
  for (const x of xs) if (!out.length || out[out.length - 1].value !== x.value) out.push(x);
  return out;
}

/** Reference sequences for every channel. */
export function referenceSequences(sim: SimResult, registerCount: number) {
  const regs: RefPoint[][] = Array.from({ length: registerCount }, (_, r) => [{ value: sim.initial.regs[r] }]);
  const sp: RefPoint[] = [{ value: sim.initial.sp }];
  const flags: RefPoint[] = [{ value: sim.initial.flags }];
  const out: RefPoint[] = [{ value: 0 }];
  for (const e of sim.events) {
    for (const w of e.regWrites) regs[w.reg].push({ value: w.after, event: e });
    for (const v of e.spTrail) sp.push({ value: v, event: e });
    flags.push({ value: e.flagsAfter, event: e });
    if (e.out !== undefined) out.push({ value: e.out, event: e });
  }
  return { regs: regs.map(collapse), sp: collapse(sp), flags: collapse(flags), out: collapse(out) };
}

/** Pick the processor instance in the dump and map its signals. */
export function autoMap(signals: VcdSignalInfo[], hw: HardwareBinding, depth: 5 | 6 = 6): SignalMapping {
  const byScope = new Map<string, Map<string, string>>();
  for (const s of signals) {
    const i = s.path.lastIndexOf(".");
    const scope = i === -1 ? "" : s.path.slice(0, i);
    const name = s.path.slice(i + 1).toLowerCase();
    if (!byScope.has(scope)) byScope.set(scope, new Map());
    byScope.get(scope)!.set(name, s.path);
  }
  const wanted = [hw.pcSignal, hw.spSignal, hw.flagsSignal, ...hw.registerSignals].map((n) => n.toLowerCase());
  let best = "";
  let bestScore = -1;
  for (const [scope, names] of byScope) {
    const score = wanted.filter((w) => names.has(w)).length;
    // Prefer the shallowest scope on ties (the processor, not a sub-block).
    if (score > bestScore || (score === bestScore && scope.split(".").length < best.split(".").length)) {
      best = scope;
      bestScore = score;
    }
  }
  const names = byScope.get(best) ?? new Map<string, string>();
  const pick = (n: string) => names.get(n.toLowerCase()) ?? null;
  const flagNames = hw.flagsCandidates?.[depth] ?? [hw.flagsSignal];
  return {
    clock: pick(hw.clockPort),
    reset: pick(hw.resetPort),
    resetActive: hw.resetActive,
    registers: hw.registerSignals.map(pick),
    sp: pick(hw.spSignal),
    flags: flagNames.map(pick).find((x) => x !== null) ?? null,
    out: pick(hw.outPort),
    pc: pick(hw.pcSignal),
    flagBits: hw.flagBits,
  };
}

export function mappedPaths(m: SignalMapping): Set<string> {
  return new Set([m.clock, m.reset, m.sp, m.flags, m.out, m.pc, ...m.registers].filter((x): x is string => !!x));
}

function normaliseFlags(raw: number, bits: SignalMapping["flagBits"]): number {
  let f = 0;
  if ((raw >> bits.Z) & 1) f |= FLAG_Z;
  if ((raw >> bits.N) & 1) f |= FLAG_N;
  if ((raw >> bits.C) & 1) f |= FLAG_C;
  return f;
}

export function compareTrace(
  sim: SimResult,
  vcd: VcdData,
  m: SignalMapping,
  registerCount: number,
  programAddresses?: Set<number>,
): CompareReport {
  const warnings: string[] = [];
  if (vcd.truncated) warnings.push("Some signals changed more often than the per-signal limit; the end of the trace was not read.");

  // Reset release: first time reset reaches its inactive level.
  let resetReleaseFs: number | null = null;
  if (m.reset) {
    const inactive = m.resetActive === "low" ? "1" : "0";
    const ch = vcd.changes.get(m.reset) ?? [];
    let wasActive = false;
    let firstInactive: number | null = null;
    for (const c of ch) {
      if (c.v !== inactive) wasActive = true;
      else {
        firstInactive ??= c.t;
        if (wasActive) {
          resetReleaseFs = c.t;
          break;
        }
      }
    }
    if (resetReleaseFs === null) {
      resetReleaseFs = firstInactive;
      warnings.push(
        firstInactive === null
          ? "Reset never deasserts in this trace, so everything from time 0 is compared."
          : "Reset is never asserted in this trace; the design may start from an undefined state.",
      );
    }
  } else {
    warnings.push("No reset signal mapped; comparing from time 0.");
  }
  const start = resetReleaseFs ?? 0;

  const risingEdges: number[] = [];
  if (m.clock) {
    let prev = "";
    for (const c of vcd.changes.get(m.clock) ?? []) {
      if (c.v === "1" && prev === "0" && c.t >= start) risingEdges.push(c.t);
      prev = c.v;
    }
  }
  const cycleOf = (t: number): number | null => {
    if (!risingEdges.length) return null;
    let lo = 0,
      hi = risingEdges.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (risingEdges[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const hwSeq = (path: string, transform: (v: number) => number = (v) => v) => {
    const ch = vcd.changes.get(path) ?? [];
    let undef = 0;
    const pts: HwPoint[] = [];
    let initial: number | null = null;
    for (const c of ch) {
      const n = vcdToNumber(c.v);
      if (c.t <= start) {
        initial = n === null ? null : transform(n);
        continue;
      }
      if (n === null) {
        undef++;
        continue;
      }
      pts.push({ value: transform(n), timeNs: fsToNs(c.t), cycle: cycleOf(c.t) });
    }
    if (initial !== null) pts.unshift({ value: initial, timeNs: fsToNs(start), cycle: 0 });
    return { pts: collapse(pts), undef };
  };

  const ref = referenceSequences(sim, registerCount);
  const channels: ChannelResult[] = [];
  const h32 = (v: number) => hex(v, 8);

  const build = (
    id: ChannelId,
    label: string,
    signal: string | null,
    refPts: RefPoint[],
    format: (v: number) => string,
    transform?: (v: number) => number,
  ) => {
    if (!signal) {
      channels.push({
        id,
        label,
        signal,
        status: "missing",
        ref: refPts,
        hw: [],
        divergeAt: null,
        undefinedAfterReset: 0,
        summary: "Not mapped to a signal in the trace",
        format,
      });
      return;
    }
    const { pts, undef } = hwSeq(signal, transform);
    // The OUT port of a design may power up undefined; don't hold its initial value against it.
    const hw = pts;
    let r = refPts;
    if (id === "out" && hw.length && r.length && hw[0].value !== r[0].value) r = r.slice(1);
    let divergeAt: number | null = null;
    const n = Math.min(hw.length, r.length);
    for (let i = 0; i < n; i++) {
      if (hw[i].value !== r[i].value) {
        divergeAt = i;
        break;
      }
    }
    let status: ChannelResult["status"];
    let summary: string;
    if (divergeAt !== null) {
      status = "mismatch";
      const rp = r[divergeAt];
      const hp = hw[divergeAt];
      const after = rp.event ? ` after “${rp.event.text}”` : "";
      if (hw[divergeAt + 1]?.value === rp.value) {
        summary = `Hardware inserts ${format(hp.value)} at ${hp.timeNs} ns before the expected ${format(rp.value)}${after}. An instruction changed this when it should not have.`;
      } else if (r[divergeAt + 1]?.value === hp.value) {
        summary = `Hardware skips ${format(rp.value)}${after} and goes straight to ${format(hp.value)} at ${hp.timeNs} ns.`;
      } else {
        summary = `Value #${divergeAt + 1}: expected ${format(rp.value)}${after}, hardware has ${format(hp.value)} at ${hp.timeNs} ns.`;
      }
    } else if (hw.length < r.length) {
      status = "incomplete";
      divergeAt = hw.length;
      const rp = r[hw.length];
      summary = `Hardware stops after ${hw.length} value(s); next expected ${format(rp.value)}${rp.event ? ` from “${rp.event.text}”` : ""}. Run longer, or the write never happens.`;
    } else if (hw.length > r.length) {
      status = "extra";
      divergeAt = r.length;
      const hp = hw[r.length];
      summary = `Hardware writes an extra value ${format(hp.value)} at ${hp.timeNs} ns that the model never produces.`;
    } else {
      status = "match";
      summary = `All ${r.length} value(s) match`;
    }
    if (undef) summary += ` · ${undef} undefined (X/U) sample(s) after reset`;
    channels.push({ id, label, signal, status, ref: r, hw, divergeAt, undefinedAfterReset: undef, summary, format });
  };

  for (let i = 0; i < registerCount; i++) build(`r${i}`, `R${i}`, m.registers[i] ?? null, ref.regs[i], h32);
  build("out", "OUT port", m.out, ref.out, h32);
  build("sp", "SP", m.sp, ref.sp, (v) => hex(v, 3));
  build("flags", "Flags", m.flags, ref.flags, flagsToString, (v) => normaliseFlags(v, m.flagBits));

  // Control flow: the fetch PC may visit wrong-path addresses, so we only flag
  // fetches from addresses the program never occupies.
  if (m.pc) {
    const valid = new Set<number>(programAddresses ?? []);
    for (const e of sim.events) {
      valid.add(e.pc);
      valid.add(e.pc + 1);
      valid.add(e.pc + 2);
    }
    const { pts } = hwSeq(m.pc);
    const strayIdx = pts.findIndex((p, i) => i > 0 && !valid.has(p.value) && !valid.has(p.value - 1) && !valid.has(p.value - 2));
    const fmt = (v: number) => "0x" + v.toString(16).toUpperCase();
    if (strayIdx === -1) {
      channels.push({
        id: "pc",
        label: "Fetch PC",
        signal: m.pc,
        status: "match",
        ref: [],
        hw: pts,
        divergeAt: null,
        undefinedAfterReset: 0,
        summary: `Every fetch (${pts.length} PC values) stays inside the program`,
        format: fmt,
      });
    } else {
      const bad = pts[strayIdx];
      const prev = pts[strayIdx - 1];
      channels.push({
        id: "pc",
        label: "Fetch PC",
        signal: m.pc,
        status: "mismatch",
        ref: [],
        hw: pts,
        divergeAt: strayIdx,
        undefinedAfterReset: 0,
        summary: `At ${bad.timeNs} ns the hardware fetches from ${fmt(bad.value)}, which the program never uses (previous fetch ${fmt(prev.value)} at ${prev.timeNs} ns). Control flow went wrong here.`,
        format: fmt,
      });
    }
  }

  const failed = channels.filter((c) => c.status !== "match" && c.status !== "missing");
  // First divergence in time across all channels.
  let first: CompareReport["firstDivergence"] = null;
  let firstT = Infinity;
  for (const c of failed) {
    if (c.divergeAt === null) continue;
    const hp = c.hw[c.divergeAt];
    const t = hp ? hp.timeNs : Number.MAX_SAFE_INTEGER;
    if (t < firstT) {
      firstT = t;
      first = { channel: c, ref: c.id === "pc" ? undefined : c.ref[c.divergeAt], hw: hp };
    }
  }
  let lastChangeCycle: number | null = null;
  for (const c of channels) {
    if (c.id === "pc" || c.hw.length < 2) continue;
    const cyc = c.hw[c.hw.length - 1].cycle;
    if (cyc !== null && (lastChangeCycle === null || cyc > lastChangeCycle)) lastChangeCycle = cyc;
  }
  return {
    channels,
    lastChangeCycle,
    resetReleaseNs: resetReleaseFs === null ? null : fsToNs(resetReleaseFs),
    cyclesAfterReset: risingEdges.length || null,
    passed: channels.filter((c) => c.status === "match").length,
    failed: failed.length,
    firstDivergence: first,
    warnings,
  };
}

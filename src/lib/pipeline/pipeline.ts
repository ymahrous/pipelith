/**
 * Pipeline depth: 5 stages (IF ID EX MEM WB) or 6 stages (IF ID EX1 EX2 MEM WB).
 *
 * The ISA — and so the reference model — is the same for both. What changes
 * is *when* things happen: how long a load result takes to reach a dependent
 * instruction, how late a branch is resolved, how many pipeline registers and
 * forwarding paths exist. This module captures that geometry and turns a
 * reference-model run into a cycle estimate, a stall breakdown and a pipeline
 * diagram.
 */
import { decodeWord } from "../asm/memfile";
import type { ProcessorProfile } from "../isa/profile";
import type { SimResult, StepEvent } from "../sim/simulator";

export type Depth = 5 | 6;
export const DEPTHS: Depth[] = [5, 6];

export interface PipelineGeometry {
  depth: Depth;
  stages: string[];
  stageNames: string[];
  /** Index of the stage that consumes ALU operands. */
  execute: number;
  /** Index of the stage that reads/writes data memory. */
  memory: number;
  /** Where conditional branches are resolved. */
  branchResolve: number;
  /** Where JMP/CALL are resolved. */
  jumpResolve: number;
  /** Pipeline registers, oldest first, e.g. "IF/ID". */
  registers: string[];
  /** Forwarding sources into the execute stage. */
  forwardingSources: string[];
  /** Extra cycles for multi-cycle control instructions (beyond one issue slot). */
  multiCycle: Record<string, number>;
}

const SIX: PipelineGeometry = {
  depth: 6,
  stages: ["IF", "ID", "EX1", "EX2", "MEM", "WB"],
  stageNames: ["Fetch", "Decode", "Execute 1 (ALU)", "Execute 2 (branch resolve)", "Memory", "Write-back"],
  execute: 2,
  memory: 4,
  branchResolve: 3,
  jumpResolve: 1,
  registers: ["IF/ID", "ID/EX1", "EX1/EX2", "EX2/MEM", "MEM/WB"],
  forwardingSources: ["EX1/EX2", "EX2/MEM", "MEM/WB"],
  // From the ISA sheet's control-unit cycle counts (RET 4, INT 8, RTI 7, SWAP 2).
  multiCycle: { RET: 3, INT: 7, RTI: 6, SWAP: 1, IRQ: 6 },
};

const FIVE: PipelineGeometry = {
  depth: 5,
  stages: ["IF", "ID", "EX", "MEM", "WB"],
  stageNames: ["Fetch", "Decode", "Execute (ALU + branch resolve)", "Memory", "Write-back"],
  execute: 2,
  memory: 3,
  branchResolve: 2,
  jumpResolve: 1,
  registers: ["IF/ID", "ID/EX", "EX/MEM", "MEM/WB"],
  forwardingSources: ["EX/MEM", "MEM/WB"],
  // One stage fewer to drain before a popped/vectored PC is available.
  multiCycle: { RET: 2, INT: 6, RTI: 5, SWAP: 1, IRQ: 5 },
};

export function geometry(depth: Depth): PipelineGeometry {
  return depth === 5 ? FIVE : SIX;
}

/* ---------- timing estimate ---------- */

export type StallKind = "load-use" | "data" | "branch" | "immediate" | "memory-port" | "multi-cycle";

/* ---------- forwarding ---------- */

/**
 * Which results can bypass the register file. "paths" names pipeline
 * registers from geometry(depth).forwardingSources ("EX/MEM", "MEM/WB" …).
 */
export interface ForwardingConfig {
  enabled: boolean;
  paths: "all" | string[];
  /** Register file returns a value written in the same cycle (write in first half, read in second). */
  writeThrough: boolean;
}

export const FULL_FORWARDING: ForwardingConfig = { enabled: true, paths: "all", writeThrough: true };
export const NO_FORWARDING: ForwardingConfig = { enabled: false, paths: [], writeThrough: true };

/** The forwarding paths actually in effect for a depth (unknown names are ignored). */
export function activePaths(g: PipelineGeometry, f: ForwardingConfig): string[] {
  if (!f.enabled) return [];
  if (f.paths === "all") return [...g.forwardingSources];
  return g.forwardingSources.filter((p) => f.paths.includes(p));
}

/** One-line description, e.g. "full forwarding (EX/MEM, MEM/WB)". */
export function describeForwarding(g: PipelineGeometry, f: ForwardingConfig): string {
  const paths = activePaths(g, f);
  const rf = f.writeThrough ? "" : ", no register-file write-through";
  if (!paths.length) return `no forwarding (stall until write-back${rf})`;
  if (paths.length === g.forwardingSources.length) return `full forwarding (${paths.join(", ")}${rf})`;
  return `partial forwarding (${paths.join(", ")} only${rf})`;
}

/**
 * Stall cycles a consumer needs before entering EX, given the producer's
 * fetch cycle, the stage at whose end its result exists, and the forwarding setup.
 */
export function hazardStall(
  g: PipelineGeometry,
  f: ForwardingConfig,
  consumerFetch: number,
  producerFetch: number,
  producedBy: number,
): number {
  const delta = consumerFetch - producerFetch;
  const enabled = new Set(activePaths(g, f).map((p) => g.registers.indexOf(p) + 1)); // register k sits before stage k
  for (let s = 0; s <= g.depth + 2; s++) {
    // Stage the producer occupies while the consumer is in EX.
    const k = delta + g.execute + s;
    if (k >= producedBy + 1 && k <= g.depth - 1 && enabled.has(k)) return s;
    // Otherwise the consumer must read the register file (in ID) after write-back.
    if (delta + 1 + s >= g.depth - 1 + (f.writeThrough ? 0 : 1)) return s;
  }
  return g.depth;
}

export interface TimedInstruction {
  event: StepEvent;
  /** Cycle (1-based, after reset) in which the instruction is fetched. */
  fetch: number;
  /** Cycle in which it is in write-back. */
  writeback: number;
  /** Bubbles inserted *before* this instruction, by cause. */
  stalls: Partial<Record<StallKind, number>>;
}

export interface TimingEstimate {
  geometry: PipelineGeometry;
  forwarding: ForwardingConfig;
  instructions: TimedInstruction[];
  totalCycles: number;
  /** Write-back cycle of the last instruction that changed visible state. */
  lastResultCycle: number;
  stalls: Record<StallKind, number>;
  cpi: number;
  notes: string[];
}

const LOADS = new Set(["POP", "LDD"]);
const MEMORY_OPS = new Set(["PUSH", "POP", "LDD", "STD", "CALL", "RET", "INT", "RTI", "IRQ"]);

/** Registers an instruction reads in the execute stage. */
export function registerReads(word: number, profile: ProcessorProfile, regForm = false): number[] {
  const d = decodeWord(word, 0, profile);
  const def = profile.instructions.find((x) => x.mnemonic === d.mnemonic);
  if (!def) return [];
  switch (def.operands) {
    case "rdst":
      return d.mnemonic === "NOT" || d.mnemonic === "INC" ? [d.rdst] : [];
    case "rsrc1":
      return [d.rsrc1];
    case "rdst_rsrc1":
      return d.mnemonic === "SWAP" ? [d.rsrc1, d.rdst] : [d.rsrc1];
    case "rdst_rsrc1_rsrc2":
      return [d.rsrc1, d.rsrc2];
    case "rdst_rsrc1_imm":
      return regForm ? [d.rsrc1, d.rsrc2] : [d.rsrc1];
    case "rdst_mem":
      return [d.rsrc1];
    case "rsrc_mem":
      return [d.rsrc1, d.rsrc2];
    default:
      return [];
  }
}

export function estimateTiming(
  sim: SimResult,
  profile: ProcessorProfile,
  depth: Depth,
  forwarding: ForwardingConfig = FULL_FORWARDING,
): TimingEstimate {
  const g = geometry(depth);
  const n = sim.events.length;
  // Bubbles scheduled ahead of an instruction by something earlier (branches, immediates, memory port).
  const pending: Partial<Record<StallKind, number>>[] = Array.from({ length: n + 1 }, () => ({}));
  const schedule = (i: number, k: StallKind, v: number) => {
    if (v <= 0) return;
    const slot = pending[Math.min(i, n)];
    slot[k] = (slot[k] ?? 0) + v;
  };
  const producer = new Map<number, { fetch: number; stage: number }>(); // register → last writer
  const totals: Record<StallKind, number> = { "load-use": 0, data: 0, branch: 0, immediate: 0, "memory-port": 0, "multi-cycle": 0 };
  const instructions: TimedInstruction[] = [];
  let prevFetch = 0;

  for (let i = 0; i < n; i++) {
    const e = sim.events[i];
    const stalls: Partial<Record<StallKind, number>> = { ...pending[i] };
    let fetch = (i === 0 ? 1 : prevFetch + 1) + Object.values(pending[i]).reduce((a, b) => a + (b ?? 0), 0);
    const regForm = e.kind === "instruction" && e.mnemonic === "IADD" && e.nextPc === e.pc + 1;

    if (e.kind === "instruction") {
      // Read-after-write hazards: the worst operand decides (stalls for two operands overlap).
      let worst = 0;
      let fromLoad = false;
      for (const r of new Set(registerReads(e.word, profile, regForm))) {
        const p = producer.get(r);
        if (!p) continue;
        const st = hazardStall(g, forwarding, fetch, p.fetch, p.stage);
        if (st > worst) {
          worst = st;
          fromLoad = p.stage === g.memory;
        }
      }
      if (worst) {
        const kind: StallKind = fromLoad ? "load-use" : "data";
        stalls[kind] = (stalls[kind] ?? 0) + worst;
        fetch += worst;
      }
      const d = decodeWord(e.word, 0, profile);
      if (d.known && d.words === 2 && !regForm) schedule(i + 1, "immediate", 1);
      if (e.branch?.taken) {
        const conditional = ["JZ", "JN", "JC"].includes(e.mnemonic);
        schedule(i + 1, "branch", (conditional ? g.branchResolve : g.jumpResolve) - 1);
      }
    }
    const key = e.kind === "interrupt" ? "IRQ" : e.mnemonic;
    const mc = g.multiCycle[key];
    if (mc) schedule(i + 1, "multi-cycle", mc);
    // Von Neumann memory: a data access in MEM steals that cycle's fetch.
    if (MEMORY_OPS.has(key) && !mc) schedule(i + g.memory, "memory-port", 1);

    for (const w of e.regWrites) producer.set(w.reg, { fetch, stage: LOADS.has(e.mnemonic) ? g.memory : g.execute });
    for (const [k, v] of Object.entries(stalls)) totals[k as StallKind] += v ?? 0;
    instructions.push({ event: e, fetch, writeback: fetch + g.depth - 1, stalls });
    prevFetch = fetch;
  }

  const totalCycles = n ? instructions[n - 1].writeback : 0;
  let lastResultCycle = 0;
  for (const t of instructions) {
    const e = t.event;
    if (e.regWrites.length || e.memWrites.length || e.out !== undefined || e.spTrail.length) lastResultCycle = t.writeback;
  }
  const notes: string[] = [];
  if (sim.haltReason !== "hlt") notes.push("The program did not reach HLT, so the estimate covers only the steps the model ran.");
  if (forwarding.enabled && !activePaths(g, forwarding).length) {
    notes.push("Forwarding is on but no paths are selected, so it behaves like no forwarding.");
  }
  return {
    geometry: g,
    forwarding,
    instructions,
    totalCycles,
    lastResultCycle,
    stalls: totals,
    cpi: n ? +(totalCycles - (g.depth - 1)) / n : 0,
    notes,
  };
}

export const STALL_LABEL: Record<StallKind, string> = {
  "load-use": "Load-use stalls",
  data: "Data-hazard stalls (no forwarding path)",
  branch: "Taken-branch flushes",
  immediate: "Immediate-word fetches",
  "memory-port": "Shared memory port",
  "multi-cycle": "Multi-cycle instructions",
};

/** Default testbench length: the estimate plus generous headroom. */
export function suggestedCycles(t: TimingEstimate): number {
  return Math.min(1_000_000, Math.ceil(t.totalCycles * 1.5) + 50);
}

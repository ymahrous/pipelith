/**
 * Reference ISA model ("golden model").
 *
 * Executes one instruction per step with no pipeline: it defines what the
 * architecturally visible state (registers, flags, SP, memory, OUT port)
 * must be after each instruction. Hardware traces are compared against the
 * sequence of states this model produces, which makes the comparison
 * independent of pipeline depth, stalls and forwarding.
 */
import type { AddressInfo } from "../asm/assembler";
import { hex } from "../asm/assembler";
import { decodeWord } from "../asm/memfile";
import type { ModelOptions, ProcessorProfile } from "../isa/profile";

export const FLAG_Z = 1;
export const FLAG_N = 2;
export const FLAG_C = 4;

export interface InterruptSpec {
  /** Raise the external interrupt just before the instruction at this address executes… */
  pc: number;
  /** …on its n-th execution (1 = first time). */
  occurrence: number;
}

export interface SimConfig {
  profile: ProcessorProfile;
  options: ModelOptions;
  memory: Map<number, number>;
  sourceMap?: Map<number, AddressInfo>;
  /** IN-port values per IN instruction address; the k-th execution reads values[k] (last value repeats). */
  inputs: Map<number, number[]>;
  interrupts: InterruptSpec[];
  maxSteps: number;
}

export interface RegWrite {
  reg: number;
  before: number;
  after: number;
}
export interface MemWrite {
  addr: number;
  before: number;
  after: number;
}

export interface StepEvent {
  step: number;
  kind: "instruction" | "interrupt";
  pc: number;
  word: number;
  mnemonic: string;
  text: string;
  line?: number;
  nextPc: number;
  regWrites: RegWrite[];
  memWrites: MemWrite[];
  flagsBefore: number;
  flagsAfter: number;
  spBefore: number;
  spAfter: number;
  /** Every SP value this step passed through (INT/CALL push more than once). */
  spTrail: number[];
  out?: number;
  in?: number;
  branch?: { taken: boolean; target: number };
  notes: string[];
}

export type HaltReason = "hlt" | "max-steps" | "pc-out-of-range";

export interface SimResult {
  events: StepEvent[];
  haltReason: HaltReason;
  final: MachineState;
  initial: MachineState;
  /** Address → number of times an instruction there executed. */
  executed: Map<number, number>;
  warnings: string[];
}

export interface MachineState {
  regs: number[];
  pc: number;
  sp: number;
  flags: number;
  out: number | null;
  memory: Map<number, number>;
}

export const DEFAULT_MAX_STEPS = 50_000;
export const HARD_MAX_STEPS = 200_000;

export function flagsToString(f: number): string {
  return `Z=${f & FLAG_Z ? 1 : 0} N=${f & FLAG_N ? 1 : 0} C=${f & FLAG_C ? 1 : 0}`;
}

type Frame = { kind: "call" | "int" | "ext"; withFlags: boolean };

export function simulate(cfg: SimConfig): SimResult {
  const { profile, options } = cfg;
  const size = profile.memoryWords;
  const mem = new Map(cfg.memory);
  const regs = new Array<number>(profile.registerCount).fill(0);
  let flags = 0;
  let sp = profile.spInit >>> 0;
  let out: number | null = null;
  const read = (a: number) => (a >= 0 && a < size ? (mem.get(a) ?? 0) : 0);
  let pc = read(profile.resetVector);

  const initial: MachineState = { regs: [...regs], pc, sp, flags, out, memory: new Map(mem) };
  const events: StepEvent[] = [];
  const executed = new Map<number, number>();
  const warnings: string[] = [];
  const frames: Frame[] = [];
  const inputIdx = new Map<number, number>();
  let haltReason: HaltReason = "max-steps";
  const pendingInts = cfg.interrupts.map((i) => ({ ...i, fired: false }));
  const requested = Number.isFinite(cfg.maxSteps) ? Math.floor(cfg.maxSteps) : HARD_MAX_STEPS;
  const maxSteps = Math.min(Math.max(1, requested), HARD_MAX_STEPS);

  for (let step = 0; step < maxSteps; step++) {
    if (pc < 0 || pc >= size) {
      haltReason = "pc-out-of-range";
      warnings.push(`PC reached 0x${pc.toString(16).toUpperCase()}, outside memory. Execution stopped.`);
      break;
    }

    const e: StepEvent = {
      step,
      kind: "instruction",
      pc,
      word: read(pc),
      mnemonic: "",
      text: "",
      nextPc: pc,
      regWrites: [],
      memWrites: [],
      flagsBefore: flags,
      flagsAfter: flags,
      spBefore: sp,
      spAfter: sp,
      spTrail: [],
      notes: [],
    };
    const setReg = (r: number, v: number) => {
      e.regWrites.push({ reg: r, before: regs[r], after: v >>> 0 });
      regs[r] = v >>> 0;
    };
    const write = (a: number, v: number) => {
      a >>>= 0;
      if (a >= size) {
        e.notes.push(`Write to 0x${hex(a)} is outside memory and was ignored.`);
        return;
      }
      e.memWrites.push({ addr: a, before: read(a), after: v >>> 0 });
      mem.set(a, v >>> 0);
    };
    const load = (a: number) => {
      a >>>= 0;
      if (a >= size) e.notes.push(`Read from 0x${hex(a)} is outside memory and returned 0.`);
      return read(a);
    };
    const push = (v: number) => {
      write(sp, v);
      sp = (sp - 1) >>> 0;
      e.spTrail.push(sp);
    };
    const pop = () => {
      sp = (sp + 1) >>> 0;
      e.spTrail.push(sp);
      return load(sp);
    };
    const zn = (r: number) => {
      flags &= ~(FLAG_Z | FLAG_N);
      if ((r >>> 0) === 0) flags |= FLAG_Z;
      if (r & 0x80000000) flags |= FLAG_N;
    };
    const setC = (c: boolean) => {
      flags = c ? flags | FLAG_C : flags & ~FLAG_C;
    };

    // External interrupt, taken at an instruction boundary.
    const count = (executed.get(pc) ?? 0) + 1;
    const irq = pendingInts.find((i) => !i.fired && i.pc === pc && i.occurrence === count);
    if (irq) {
      irq.fired = true;
      e.kind = "interrupt";
      e.mnemonic = "IRQ";
      e.text = `external interrupt (return to 0x${pc.toString(16).toUpperCase()})`;
      push(pc);
      if (options.extIntPushesFlags) push(flags);
      frames.push({ kind: "ext", withFlags: options.extIntPushesFlags });
      pc = read(profile.extIntVector);
      e.nextPc = pc;
      e.spAfter = sp;
      e.flagsAfter = flags;
      events.push(e);
      continue;
    }

    executed.set(pc, count);
    const info = cfg.sourceMap?.get(pc);
    if (info) e.line = info.line;
    if (info && info.kind !== "instruction") {
      e.notes.push(`Executing a ${info.kind} word from line ${info.line} as an instruction.`);
    }

    const next = read(pc + 1);
    const d = decodeWord(e.word, next, profile);
    e.mnemonic = d.mnemonic;
    e.text = d.text;
    let nextPc = pc + (d.known ? d.words : 1);
    if (d.mnemonic === "IADD" && info?.kind === "instruction" && cfg.sourceMap?.get(pc + 1)?.kind !== "immediate") {
      // Register-form IADD (no immediate word emitted).
      nextPc = pc + 1;
    }

    const a = regs[d.rsrc1];
    const b = regs[d.rsrc2];
    const dv = regs[d.rdst];

    switch (d.mnemonic) {
      case "NOP":
        break;
      case "HLT":
        haltReason = "hlt";
        break;
      case "SETC":
        setC(true);
        break;
      case "NOT": {
        const r = ~dv >>> 0;
        setReg(d.rdst, r);
        zn(r);
        break;
      }
      case "INC": {
        const r = (dv + 1) >>> 0;
        setReg(d.rdst, r);
        zn(r);
        setC(dv === 0xffffffff);
        break;
      }
      case "OUT":
        out = a;
        e.out = a;
        break;
      case "IN": {
        const k = inputIdx.get(pc) ?? 0;
        inputIdx.set(pc, k + 1);
        const list = cfg.inputs.get(pc) ?? [];
        let v = 0;
        if (list.length === 0) e.notes.push("No IN-port value is set for this instruction; read 0.");
        else v = list[Math.min(k, list.length - 1)] >>> 0;
        e.in = v;
        setReg(d.rdst, v);
        if (options.inUpdatesFlags) zn(v);
        break;
      }
      case "MOV":
        setReg(d.rdst, a);
        break;
      case "SWAP":
        setReg(d.rdst, a);
        setReg(d.rsrc1, dv);
        break;
      case "ADD": {
        const s = a + b;
        setReg(d.rdst, s);
        zn(s >>> 0);
        setC(s > 0xffffffff);
        break;
      }
      case "SUB": {
        const r = (a - b) >>> 0;
        setReg(d.rdst, r);
        zn(r);
        setC(options.subCarry === "notBorrow" ? a >= b : a < b);
        break;
      }
      case "AND": {
        const r = (a & b) >>> 0;
        setReg(d.rdst, r);
        zn(r);
        break;
      }
      case "IADD": {
        let imm = nextPc === pc + 1 ? b : next;
        if (nextPc !== pc + 1 && options.iaddSignExtend) imm = ((imm & 0xffff) << 16) >> 16;
        const s = a + (imm >>> 0);
        setReg(d.rdst, s);
        zn(s >>> 0);
        setC(s > 0xffffffff);
        break;
      }
      case "PUSH":
        push(a);
        break;
      case "POP":
        setReg(d.rdst, pop());
        break;
      case "LDM":
        setReg(d.rdst, next);
        break;
      case "LDD":
        setReg(d.rdst, load(a + next));
        break;
      case "STD":
        write(a + next, b);
        break;
      case "JZ":
      case "JN":
      case "JC": {
        const bit = d.mnemonic === "JZ" ? FLAG_Z : d.mnemonic === "JN" ? FLAG_N : FLAG_C;
        const taken = (flags & bit) !== 0;
        e.branch = { taken, target: next };
        if (taken) {
          flags &= ~bit;
          nextPc = next;
        }
        break;
      }
      case "JMP":
        e.branch = { taken: true, target: next };
        nextPc = next;
        break;
      case "CALL":
        push(pc + 2);
        frames.push({ kind: "call", withFlags: false });
        e.branch = { taken: true, target: next };
        nextPc = next;
        break;
      case "RET": {
        const f = frames.pop();
        if (f && f.kind !== "call") e.notes.push("RET is returning from an interrupt frame; RTI was probably intended.");
        nextPc = pop();
        break;
      }
      case "INT": {
        push(pc + 1);
        push(flags);
        frames.push({ kind: "int", withFlags: true });
        nextPc = read(profile.intVectorBase + d.index);
        break;
      }
      case "RTI": {
        const f = frames.pop();
        if (f?.kind === "ext" && !f.withFlags) {
          e.notes.push(
            "RTI pops flags then PC, but the external interrupt only pushed PC (per the spec). The stack is now off by one word.",
          );
        } else if (f?.kind === "call") {
          e.notes.push("RTI is returning from a CALL frame; RET was probably intended.");
        }
        flags = pop() & 7;
        nextPc = pop();
        break;
      }
      default:
        e.notes.push(`Opcode ${d.opcode.toString(2).padStart(5, "0")} is not defined; treated as NOP.`);
    }

    if (d.strayBits) e.notes.push(`Unused bits are set in this instruction word (0x${hex(d.strayBits)}).`);
    pc = nextPc >>> 0;
    e.nextPc = pc;
    e.spAfter = sp;
    e.flagsAfter = flags;
    events.push(e);
    if (haltReason === "hlt") break;
  }

  if (haltReason === "max-steps") {
    warnings.push(`Stopped after ${maxSteps.toLocaleString()} steps without reaching HLT. Is there an infinite loop?`);
  }
  for (const i of pendingInts) {
    if (!i.fired) {
      warnings.push(
        `Interrupt at 0x${i.pc.toString(16).toUpperCase()} (execution #${i.occurrence}) never fired: that instruction did not execute that many times.`,
      );
    }
  }

  return {
    events,
    haltReason,
    initial,
    final: { regs: [...regs], pc, sp, flags, out, memory: mem },
    executed,
    warnings,
  };
}

/** Machine state after `upTo` events (0 = initial state). */
export function stateAt(result: SimResult, upTo: number): MachineState {
  const s: MachineState = {
    regs: [...result.initial.regs],
    pc: result.initial.pc,
    sp: result.initial.sp,
    flags: result.initial.flags,
    out: result.initial.out,
    memory: new Map(result.initial.memory),
  };
  const n = Math.min(upTo, result.events.length);
  for (let i = 0; i < n; i++) {
    const e = result.events[i];
    for (const w of e.regWrites) s.regs[w.reg] = w.after;
    for (const w of e.memWrites) s.memory.set(w.addr, w.after);
    s.flags = e.flagsAfter;
    s.sp = e.spAfter;
    s.pc = e.nextPc;
    if (e.out !== undefined) s.out = e.out;
  }
  return s;
}

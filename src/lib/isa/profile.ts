/**
 * Processor profile: everything the workbench needs to know about one ISA.
 *
 * The assembler, disassembler, reference model, docs page and testbench
 * generator all read from a profile, so supporting a sibling processor
 * means adding a profile (see CONTRIBUTING.md), not forking the engine.
 */

export type OperandKind =
  | "none"
  | "rdst" // R[20:18]
  | "rsrc1" // R[26:24]
  | "rdst_rsrc1" // MOV/SWAP  Rdst, Rsrc
  | "rdst_rsrc1_rsrc2" // ADD Rdst, Rsrc1, Rsrc2
  | "rdst_rsrc1_imm" // IADD Rdst, Rsrc, Imm (or third register: no imm word)
  | "rdst_imm" // LDM Rdst, Imm
  | "rdst_mem" // LDD Rdst, off(Rsrc)
  | "rsrc_mem" // STD Rsrc, off(Rbase)
  | "imm" // JZ/JN/JC/JMP/CALL Imm
  | "index"; // INT index

export type Flag = "Z" | "N" | "C";

export interface InstructionDef {
  mnemonic: string;
  opcode: number; // 5 bits
  operands: OperandKind;
  syntax: string;
  /** Number of memory words (1 or 2). For IADD this is the immediate form. */
  words: 1 | 2;
  flags: string;
  summary: string;
  group: "System" | "Arithmetic & logic" | "Data movement" | "Memory" | "Control flow" | "Interrupts";
}

export interface ModelOptions {
  /** IADD: use the immediate word as written (false) or sign-extend its low 16 bits (true). */
  iaddSignExtend: boolean;
  /** SUB carry: "notBorrow" sets C when Rsrc1 >= Rsrc2 (unsigned); "borrow" sets C when Rsrc1 < Rsrc2. */
  subCarry: "notBorrow" | "borrow";
  /** IN normally leaves the flags alone; turn on to model an implementation that updates Z/N. */
  inUpdatesFlags: boolean;
  /** External interrupt pushes only PC per the spec; turn on if your design also pushes the CCR. */
  extIntPushesFlags: boolean;
}

export interface ProcessorProfile {
  id: string;
  name: string;
  description: string;
  wordBits: 32;
  memoryWords: number;
  registerCount: number;
  spInit: number;
  resetVector: number;
  extIntVector: number;
  /** Software INT n reads its handler address from M[intVectorBase + n]. */
  intVectorBase: number;
  maxIntIndex: number;
  /** Width of the immediate field the ISA documents (assembler warns above this). */
  immediateBits: number;
  instructions: InstructionDef[];
  defaultOptions: ModelOptions;
  /** Pipeline depths the profile can describe, and the default. */
  supportedDepths: (5 | 6)[];
  defaultDepth: 5 | 6;
  /** Defaults for the testbench + waveform comparison. */
  hardware: HardwareBinding;
}

export interface HardwareBinding {
  entity: string;
  clockPort: string;
  resetPort: string;
  /** "low" = reset asserted when the port is '0'. */
  resetActive: "low" | "high";
  interruptPort: string;
  inPort: string;
  outPort: string;
  memFileGeneric: string;
  /** Internal signal (relative to the processor instance) holding the fetch PC. */
  pcSignal: string;
  registerSignals: string[];
  spSignal: string;
  /** 3-bit flag register, bit order given by flagBits. */
  flagsSignal: string;
  /** Other names to try for the flags, per pipeline depth (5-stage designs have no EX1). */
  flagsCandidates?: Partial<Record<5 | 6, string[]>>;
  flagBits: { Z: number; N: number; C: number };
  clockPeriodNs: number;
  /** VHDL files in compile order, relative to the RTL root. */
  compileOrder: string[];
  /**
   * The Verilog/SystemVerilog design of the same processor: names that differ
   * from the VHDL one (SystemVerilog reserves `int`), its include file and its
   * files in compile order (`.v`; the SystemVerilog design uses `.sv`/`.svh`).
   */
  verilog?: { interruptPort: string; compileOrder: string[] };
}

export const FLAG_ORDER: Flag[] = ["Z", "N", "C"];

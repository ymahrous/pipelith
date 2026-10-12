import type { InstructionDef, ProcessorProfile } from "./profile";

/**
 * The 6-stage pipelined RISC processor (IF | ID | EX1 | EX2 | MEM | WB)
 * from github.com/ymahrous/risc-pipelined-processor.
 *
 * Encoding: [31:27] opcode | [26:24] Rsrc1 | [23:21] Rsrc2 | [20:18] Rdst | [17:16] index
 * Two-word instructions carry a full 32-bit immediate/offset in word 2.
 */
const I = (
  mnemonic: string,
  opcode: number,
  operands: InstructionDef["operands"],
  syntax: string,
  words: 1 | 2,
  flags: string,
  summary: string,
  group: InstructionDef["group"],
): InstructionDef => ({ mnemonic, opcode, operands, syntax, words, flags, summary, group });

const instructions: InstructionDef[] = [
  I("NOP", 0b00000, "none", "NOP", 1, "—", "No operation.", "System"),
  I("HLT", 0b00001, "none", "HLT", 1, "—", "Freeze the processor until reset.", "System"),
  I("SETC", 0b00010, "none", "SETC", 1, "C", "C ← 1.", "System"),
  I("NOT", 0b00011, "rdst", "NOT Rdst", 1, "Z, N", "R[Rdst] ← ~R[Rdst].", "Arithmetic & logic"),
  I("INC", 0b00100, "rdst", "INC Rdst", 1, "Z, N, C", "R[Rdst] ← R[Rdst] + 1.", "Arithmetic & logic"),
  I("ADD", 0b01010, "rdst_rsrc1_rsrc2", "ADD Rdst, Rsrc1, Rsrc2", 1, "Z, N, C", "R[Rdst] ← R[Rsrc1] + R[Rsrc2].", "Arithmetic & logic"),
  I("SUB", 0b01011, "rdst_rsrc1_rsrc2", "SUB Rdst, Rsrc1, Rsrc2", 1, "Z, N, C", "R[Rdst] ← R[Rsrc1] − R[Rsrc2].", "Arithmetic & logic"),
  I("AND", 0b01100, "rdst_rsrc1_rsrc2", "AND Rdst, Rsrc1, Rsrc2", 1, "Z, N", "R[Rdst] ← R[Rsrc1] AND R[Rsrc2].", "Arithmetic & logic"),
  I("IADD", 0b10111, "rdst_rsrc1_imm", "IADD Rdst, Rsrc, Imm", 2, "Z, N, C", "R[Rdst] ← R[Rsrc] + Imm.", "Arithmetic & logic"),
  I("MOV", 0b01000, "rdst_rsrc1", "MOV Rdst, Rsrc", 1, "—", "R[Rdst] ← R[Rsrc].", "Data movement"),
  I("SWAP", 0b01001, "rdst_rsrc1", "SWAP Rdst, Rsrc", 1, "—", "Exchange R[Rdst] and R[Rsrc].", "Data movement"),
  I("IN", 0b00110, "rdst", "IN Rdst", 1, "—", "R[Rdst] ← IN.PORT.", "Data movement"),
  I("OUT", 0b00101, "rsrc1", "OUT Rsrc", 1, "—", "OUT.PORT ← R[Rsrc].", "Data movement"),
  I("PUSH", 0b10000, "rsrc1", "PUSH Rsrc", 1, "—", "M[SP] ← R[Rsrc]; SP ← SP − 1.", "Memory"),
  I("POP", 0b10001, "rdst", "POP Rdst", 1, "—", "SP ← SP + 1; R[Rdst] ← M[SP].", "Memory"),
  I("LDM", 0b10100, "rdst_imm", "LDM Rdst, Imm", 2, "—", "R[Rdst] ← Imm.", "Memory"),
  I("LDD", 0b10101, "rdst_mem", "LDD Rdst, Off(Rsrc)", 2, "—", "R[Rdst] ← M[R[Rsrc] + Off].", "Memory"),
  I("STD", 0b10110, "rsrc_mem", "STD Rsrc, Off(Rbase)", 2, "—", "M[R[Rbase] + Off] ← R[Rsrc].", "Memory"),
  I("JZ", 0b11000, "imm", "JZ Imm", 2, "Z cleared if taken", "If Z = 1: PC ← Imm and Z ← 0.", "Control flow"),
  I("JN", 0b11001, "imm", "JN Imm", 2, "N cleared if taken", "If N = 1: PC ← Imm and N ← 0.", "Control flow"),
  I("JC", 0b11010, "imm", "JC Imm", 2, "C cleared if taken", "If C = 1: PC ← Imm and C ← 0.", "Control flow"),
  I("JMP", 0b11011, "imm", "JMP Imm", 2, "—", "PC ← Imm.", "Control flow"),
  I("CALL", 0b11100, "imm", "CALL Imm", 2, "—", "M[SP] ← return address; SP ← SP − 1; PC ← Imm.", "Control flow"),
  I("RET", 0b11101, "none", "RET", 1, "—", "SP ← SP + 1; PC ← M[SP].", "Control flow"),
  I("INT", 0b11110, "index", "INT index", 1, "preserved", "Push return address, push flags, PC ← M[2 + index].", "Interrupts"),
  I("RTI", 0b11111, "none", "RTI", 1, "restored", "Pop flags, pop PC.", "Interrupts"),
];

export const risc6: ProcessorProfile = {
  id: "risc6",
  name: "Pipelined RISC (32-bit)",
  description:
    "Von Neumann, 8 × 32-bit registers, 4096-word memory, Z/N/C flags, IN/OUT ports, one external interrupt.",
  wordBits: 32,
  memoryWords: 4096,
  registerCount: 8,
  spInit: 0xfff,
  resetVector: 0,
  extIntVector: 1,
  intVectorBase: 2,
  maxIntIndex: 1,
  immediateBits: 16,
  instructions,
  supportedDepths: [5, 6],
  defaultDepth: 6,
  defaultOptions: {
    iaddSignExtend: false,
    subCarry: "notBorrow",
    inUpdatesFlags: false,
    extIntPushesFlags: false,
  },
  hardware: {
    entity: "processor",
    clockPort: "clk",
    resetPort: "reset",
    resetActive: "low",
    interruptPort: "int",
    inPort: "in_port",
    outPort: "out_port",
    memFileGeneric: "MEM_FILE",
    pcSignal: "pc_out",
    registerSignals: ["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7"],
    spSignal: "sp_value",
    flagsSignal: "ex1_ccr",
    flagsCandidates: {
      6: ["ex1_ccr", "ccr", "ccr_out", "ccr_q", "flags"],
      5: ["ex_ccr", "ccr", "ccr_out", "ccr_q", "flags", "ex1_ccr"],
    },
    flagBits: { Z: 0, N: 1, C: 2 },
    clockPeriodNs: 100,
    compileOrder: [
      "components/dff.vhd",
      "components/mux_2to1.vhd",
      "components/mux_4to1.vhd",
      "components/demux_1to4.vhd",
      "components/alu.vhd",
      "components/ccr.vhd",
      "components/register_file.vhd",
      "components/pc.vhd",
      "components/sp_unit.vhd",
      "components/memory.vhd",
      "components/imm_detect.vhd",
      "components/jump_detection_unit.vhd",
      "components/forwarding_unit.vhd",
      "components/hazard_control_unit.vhd",
      "control_unit/src/control_unit.vhd",
      "pipeline_registers/src/if_id_register.vhd",
      "pipeline_registers/src/id_ex1_register.vhd",
      "pipeline_registers/src/ex1_ex2_register.vhd",
      "pipeline_registers/src/ex2_mem_register.vhd",
      "pipeline_registers/src/mem_wb_register.vhd",
      "stages/1-fetch/src/fetch_stage.vhd",
      "stages/2-decode/src/decode.vhd",
      "stages/3-execute1/src/execute1_stage.vhd",
      "stages/4-execute2/src/execute2_stage.vhd",
      "stages/5-memory/src/memory_wrapper.vhd",
      "stages/5-memory/src/memory_stage.vhd",
      "stages/6-writeback/src/writeback_stage.vhd",
      "processor.vhd",
    ],
    // The 5-stage Verilog design bundled with Pipelith (reference/verilog).
    verilog: {
      interruptPort: "intr",
      compileOrder: [
        "components/memory.v",
        "components/register_file.v",
        "components/alu.v",
        "components/control_unit.v",
        "components/forwarding_unit.v",
        "components/hazard_unit.v",
        "pipeline_registers/if_id_register.v",
        "pipeline_registers/id_ex_register.v",
        "pipeline_registers/ex_mem_register.v",
        "pipeline_registers/mem_wb_register.v",
        "stages/fetch_stage.v",
        "stages/decode_stage.v",
        "stages/execute_stage.v",
        "stages/memory_stage.v",
        "stages/writeback_stage.v",
        "processor.v",
      ],
    },
  },
};

export const PROFILES: ReadonlyMap<string, ProcessorProfile> = new Map([[risc6.id, risc6]]);
export const DEFAULT_PROFILE = risc6;

/** Own-key lookup only: ids come from untrusted share links. */
export function getProfile(id: string): ProcessorProfile | undefined {
  return PROFILES.get(id);
}

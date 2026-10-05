import { describe, expect, it } from "vitest";
import { assemble } from "../asm/assembler";
import { risc6 } from "../isa/risc6";
import type { ModelOptions } from "../isa/profile";
import { FLAG_C, FLAG_N, FLAG_Z, simulate, stateAt, type InterruptSpec } from "./simulator";

function run(body: string, opts: Partial<ModelOptions> = {}, inputs: Record<number, number[]> = {}, interrupts: InterruptSpec[] = []) {
  const src = `.ORG 0\n100\n280\n200\n${body.includes(".ORG 100") ? "" : ".ORG 100\n"}${body}`;
  const asm = assemble(src, risc6);
  expect(asm.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return simulate({
    profile: risc6,
    options: { ...risc6.defaultOptions, ...opts },
    memory: asm.memory,
    sourceMap: asm.sourceMap,
    inputs: new Map(Object.entries(inputs).map(([k, v]) => [Number(k), v])),
    interrupts,
    maxSteps: 1000,
  });
}

describe("reference model", () => {
  it("starts at the reset vector and halts on HLT", () => {
    const r = run("NOP\nHLT");
    expect(r.events[0].pc).toBe(0x100);
    expect(r.haltReason).toBe("hlt");
    expect(r.final.sp).toBe(0xfff);
  });

  it("NOT and INC update flags as the ISA says", () => {
    const r = run("NOT R1\nINC R1\nHLT");
    expect(r.events[0].flagsAfter).toBe(FLAG_N);
    expect(r.final.regs[1]).toBe(0);
    expect(r.events[1].flagsAfter).toBe(FLAG_Z | FLAG_C);
  });

  it("SUB carry follows the selected convention", () => {
    const prog = "LDM R1, 5\nLDM R2, 3\nSUB R3, R1, R2\nHLT";
    expect(run(prog).final.flags & FLAG_C).toBe(FLAG_C); // 5 >= 3: not borrow
    expect(run(prog, { subCarry: "borrow" }).final.flags & FLAG_C).toBe(0);
  });

  it("IADD can sign-extend the immediate", () => {
    expect(run("LDM R1, 1\nIADD R2, R1, FFFF\nHLT").final.regs[2]).toBe(0x10000);
    expect(run("LDM R1, 1\nIADD R2, R1, FFFF\nHLT", { iaddSignExtend: true }).final.regs[2]).toBe(0);
  });

  it("IN reads per-address values and leaves flags alone by default", () => {
    const r = run("SETC\nIN R1\nHLT", {}, { 0x101: [0] });
    expect(r.final.regs[1]).toBe(0);
    expect(r.final.flags).toBe(FLAG_C);
    expect(run("SETC\nIN R1\nHLT", { inUpdatesFlags: true }, { 0x101: [0] }).final.flags).toBe(FLAG_C | FLAG_Z);
  });

  it("notes an IN with no value", () => {
    expect(run("IN R1\nHLT").events[0].notes.join()).toMatch(/No IN-port value/);
  });

  it("PUSH/POP use a post-decrement stack starting at 0xFFF", () => {
    const r = run("LDM R1, 7\nPUSH R1\nPOP R2\nHLT");
    expect(r.events[1].memWrites).toEqual([{ addr: 0xfff, before: 0, after: 7 }]);
    expect(r.events[1].spAfter).toBe(0xffe);
    expect(r.final.regs[2]).toBe(7);
    expect(r.final.sp).toBe(0xfff);
  });

  it("LDD/STD address memory relative to a base register", () => {
    const r = run("LDM R5, 10\nLDM R1, 99\nSTD R1, 200(R5)\nLDD R2, 200(R5)\nHLT");
    expect(r.final.memory.get(0x210)).toBe(0x99);
    expect(r.final.regs[2]).toBe(0x99);
  });

  it("conditional jumps clear the tested flag only when taken", () => {
    const r = run("SUB R1, R1, R1\nJZ 120\nHLT\n.ORG 120\nJZ 130\nHLT\n.ORG 130\nHLT");
    expect(r.events[1].branch).toEqual({ taken: true, target: 0x120 });
    expect(r.events[1].flagsAfter & FLAG_Z).toBe(0);
    expect(r.events[2].branch?.taken).toBe(false);
    expect(r.final.pc).toBe(0x123);
  });

  it("CALL returns to the instruction after its immediate word", () => {
    const r = run("CALL 150\nINC R1\nHLT\n.ORG 150\nINC R2\nRET");
    expect(r.final.regs).toEqual([0, 1, 1, 0, 0, 0, 0, 0]);
    expect(r.final.sp).toBe(0xfff);
  });

  it("INT pushes return address and flags; RTI restores both", () => {
    const r = run("SETC\nINT 0\nHLT\n.ORG 200\nSUB R1, R1, R1\nRTI");
    expect(r.final.flags).toBe(FLAG_C);
    expect(r.final.sp).toBe(0xfff);
    expect(r.events.map((e) => e.mnemonic)).toEqual(["SETC", "INT", "SUB", "RTI", "HLT"]);
  });

  it("an external interrupt pushes only PC and warns when RTI pops flags", () => {
    const r = run("NOP\nNOP\nHLT\n.ORG 280\nRTI", {}, {}, [{ pc: 0x101, occurrence: 1 }]);
    expect(r.events[1].kind).toBe("interrupt");
    expect(r.events[1].memWrites).toEqual([{ addr: 0xfff, before: 0, after: 0x101 }]);
    expect(r.events[2].notes.join()).toMatch(/only pushed PC/);
  });

  it("warns about interrupts that never fire", () => {
    expect(run("HLT", {}, {}, [{ pc: 0x900, occurrence: 1 }]).warnings.join()).toMatch(/never fired/);
  });

  it("stops infinite loops at the step limit", () => {
    const r = run("JMP 100");
    expect(r.haltReason).toBe("max-steps");
    expect(r.events).toHaveLength(1000);
  });

  it("stops when PC leaves memory", () => {
    expect(run("JMP 5000").haltReason).toBe("pc-out-of-range");
  });

  it("SWAP exchanges two registers", () => {
    const r = run("LDM R1, 1\nLDM R2, 2\nSWAP R1, R2\nHLT");
    expect(r.final.regs.slice(1, 3)).toEqual([2, 1]);
  });

  it("stateAt replays state at any step", () => {
    const r = run("LDM R1, 1\nINC R1\nINC R1\nHLT");
    expect(stateAt(r, 0).regs[1]).toBe(0);
    expect(stateAt(r, 2).regs[1]).toBe(2);
    expect(stateAt(r, 99).regs[1]).toBe(3);
  });

  it("negative results set N", () => {
    expect(run("LDM R1, 1\nLDM R2, 2\nSUB R3, R1, R2\nHLT").final.flags & FLAG_N).toBe(FLAG_N);
  });
});

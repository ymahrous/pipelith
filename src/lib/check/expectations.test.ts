import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../examples/programs";
import { analyze } from "../session/analyze";
import { emptySession } from "../session/session";
import { describeCheck, parseComment } from "./expectations";

const parsed = (c: string, m = "ADD") => parseComment(c, 1, m).map(describeCheck);

describe("comment parsing", () => {
  it("reads register, SP and memory values", () => {
    expect(parsed("SP=FFE, M[FFF]=300")).toEqual(["SP = FFE", "M[FFF] = 300"]);
    expect(parsed("R5=FFFF_FFFF, Z= 0")).toEqual(["R5 = FFFFFFFF", "Z = 0"]);
  });
  it("reads flag arrows and 'no change'", () => {
    expect(parsed("C --> no change, N --> 1, Z --> 0")).toEqual(["C unchanged", "N = 1", "Z = 0"]);
    expect(parsed("R1= 5, flags no change")).toEqual(["R1 = 5", "Flags unchanged"]);
  });
  it("keeps only the first alternative of an 'OR' comment", () => {
    expect(parsed("R2 = 00010018 (C = 0) OR R2=18 and C = 1")).toEqual(["R2 = 10018", "C = 0"]);
  });
  it("recognises dead code but not 'until the call returns'", () => {
    expect(parsed("this statement shouldn't be executed")).toEqual(["Never executes"]);
    expect(parsed("R6=401, this statement shouldn't be executed till call returns")).toEqual(["R6 = 401"]);
  });
  it("reads branch intent only on jumps", () => {
    expect(parsed("Jump taken, Z = 0", "JZ")).toEqual(["Branch taken", "Z = 0"]);
    expect(parsed("shouldn't be taken", "JZ")).toEqual(["Branch not taken"]);
    expect(parsed("jump not taken", "JZ")).toEqual(["Branch not taken"]);
    expect(parsed("taken", "ADD")).toEqual([]);
  });
});

describe("bundled test programs on the reference model", () => {
  const results = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id)!;
    const a = analyze({ ...emptySession(), source: ex.source });
    return a;
  };
  it("infers IN-port values from comments", () => {
    expect(results("one-operand").inputRows.map((r) => r.values[0])).toEqual([5, 0x10]);
    expect(results("two-operand").inputRows.map((r) => r.values[0])).toEqual([5, 0x19, 0xffffffff, 0xfffff320]);
  });
  it("OneOperand and Memory pass every check", () => {
    for (const id of ["one-operand", "memory"]) {
      const a = results(id);
      expect(a.checkResults.filter((r) => r.status !== "pass")).toEqual([]);
      expect(a.checkResults.length).toBeGreaterThan(20);
    }
  });
  it("TwoOperand exposes the MOV operand-order mismatch in its comments", () => {
    const fails = results("two-operand").checkResults.filter((r) => r.status === "fail");
    expect(fails[0].check.line).toBe(17); // MOV R3, R5   #R5 = FFFFFFFF
  });
  it("Branch only leaves the interrupt handler unchecked (it needs an interrupt)", () => {
    const a = results("branch");
    expect(a.checkResults.filter((r) => r.status === "fail")).toEqual([]);
    expect(new Set(a.checkResults.filter((r) => r.status === "not-run").map((r) => r.check.line))).toEqual(new Set([15, 16]));
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../examples/programs";
import { risc6 } from "../isa/risc6";
import { assemble, encodeInstruction, MAX_SOURCE_BYTES, parseHex, splitComment, toMemFile } from "./assembler";

const fixture = (name: string) => readFileSync(join(__dirname, "../__fixtures__", name), "utf8");
const codes = (src: string) => assemble(src, risc6).diagnostics.map((d) => d.code);

describe("assembler: compatibility with assembler.py", () => {
  const files: Record<string, string> = {
    "one-operand": "OneOperand.mem",
    "two-operand": "TwoOperand.mem",
    memory: "Memory.mem",
    branch: "Branch.mem",
  };
  for (const ex of EXAMPLES) {
    it(`produces the same .mem as the Python assembler for ${ex.file}`, () => {
      const r = assemble(ex.source, risc6);
      expect(r.ok).toBe(true);
      expect(toMemFile(r.memory, risc6)).toBe(fixture(files[ex.id]));
    });
  }
});

describe("assembler: encoding", () => {
  it("encodes three-register ALU instructions", () => {
    // ADD R1, R2, R3 → opcode 01010, rsrc1=2, rsrc2=3, rdst=1
    expect(encodeInstruction("ADD R1, R2, R3", risc6).words).toEqual([((0b01010 << 27) | (2 << 24) | (3 << 21) | (1 << 18)) >>> 0]);
  });
  it("puts the stored register of STD in Rsrc2 and the base in Rsrc1", () => {
    const [w, imm] = encodeInstruction("STD R2, 200(R5)", risc6).words;
    expect((w >>> 24) & 7).toBe(5);
    expect((w >>> 21) & 7).toBe(2);
    expect(imm).toBe(0x200);
  });
  it("emits an immediate word for two-word instructions", () => {
    expect(encodeInstruction("LDM R1, 5", risc6).words).toHaveLength(2);
    expect(encodeInstruction("JMP 30", risc6).words[1]).toBe(0x30);
  });
  it("treats a register third operand of IADD like the Python tool (no immediate) and warns", () => {
    const e = encodeInstruction("IADD R1, R2, R3", risc6);
    expect(e.words).toHaveLength(1);
    expect(e.warnings.map((w) => w.code)).toContain("iadd-register");
  });
  it("accepts INT0 shorthand and lowercase mnemonics", () => {
    expect(assemble("int0\ninc r1", risc6).ok).toBe(true);
  });
  it("masks negative and wide numbers to 32 bits", () => {
    expect(parseHex("-1")).toBe(0xffffffff);
    expect(parseHex("1FFFFFFFF")).toBe(0xffffffff);
    expect(parseHex("FFFF_FFFF")).toBe(0xffffffff);
  });
});

describe("assembler: diagnostics", () => {
  it("collects every error instead of stopping at the first", () => {
    const r = assemble(".ORG 0\n10\n.ORG 10\nFOO R1\nADD R1\nINC R9\nHLT", risc6);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.filter((d) => d.severity === "error").map((d) => d.line)).toEqual([4, 5, 6]);
  });
  it("flags a bare ADD that the original tool silently stores as data", () => {
    expect(codes(".ORG 0\n10\n.ORG 10\nADD\nHLT")).toContain("mnemonic-as-data");
  });
  it("warns when .ORG regions overlap", () => {
    expect(codes(".ORG 0\n10\n.ORG 10\nNOP\nNOP\n.ORG 11\nHLT")).toContain("overlap");
  });
  it("warns about immediates wider than the documented field", () => {
    expect(codes(".ORG 0\n10\n.ORG 10\nLDM R1, 12345\nHLT")).toContain("wide-immediate");
  });
  it("reports a missing reset vector", () => {
    expect(codes(".ORG 10\nNOP")).toContain("no-reset-vector");
  });
  it("rejects programs above the size limit", () => {
    const r = assemble("NOP\n".repeat(MAX_SOURCE_BYTES / 2), risc6);
    expect(r.diagnostics[0].code).toBe("too-large");
  });
  it("errors when code runs past the end of memory", () => {
    expect(codes(".ORG 0\n10\n.ORG FFF\nLDM R1, 1")).toContain("address-overflow");
  });
});

describe("comments", () => {
  it("splits on the earliest of ;, # and //", () => {
    expect(splitComment("ADD R1,R2,R3 ; a # b")).toEqual({ code: "ADD R1,R2,R3", comment: "a # b" });
    expect(splitComment("INC R1 // hi")).toEqual({ code: "INC R1", comment: "hi" });
  });
});

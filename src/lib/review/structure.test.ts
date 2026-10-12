import { describe, expect, it } from "vitest";
import { restructurePrompt, MAX_PROMPT_PATHS } from "./aiPrompt";
import { reviewCodebase } from "./review";
import { checkStructure } from "./structure";

const files = (o: Record<string, string>) => Object.entries(o).map(([path, text]) => ({ path, text }));

describe("structure check", () => {
  it("names missing packages, includes and units, duplicates and a missing top level", () => {
    const src = files({
      "a.vhd": "library ieee; use ieee.std_logic_1164.all; use work.cpu_pkg.all;\nentity a is port (x : in std_logic; y : out std_logic); end entity;\narchitecture rtl of a is begin y <= x; end architecture;",
      "b.v": '`include "defs.vh"\nmodule b(input x, output y); ghost g (.x(x)); assign y = x; endmodule',
      "c.v": "module c(input x, output y); assign y = x; endmodule",
      "old/c.v": "module c(input x, output y); assign y = ~x; endmodule",
    });
    const r = checkStructure({ files: src.map((f) => f.path), report: reviewCodebase(src, 5), hdl: "verilog" });
    expect(r.ok).toBe(false);
    expect(r.missingPackages).toEqual(["cpu_pkg"]);
    expect(r.missingIncludes).toEqual(["defs.vh"]);
    expect(r.unknownUnits).toEqual(["ghost"]);
    expect(r.duplicates).toEqual(["c"]);
    expect(r.problems.join("; ")).toMatch(/1 package is missing \(cpu_pkg\); 1 include file is missing \(defs\.vh\); 1 unit is instantiated but not in the upload \(ghost\); 1 unit is defined twice \(c\)/);
  });
  it("passes a complete design and notices the wrong language selection", () => {
    const src = files({ "top.v": "module top(input x, output y); assign y = x; endmodule" });
    const ok = checkStructure({ files: ["top.v"], report: reviewCodebase(src, 5), hdl: "verilog" });
    expect(ok).toMatchObject({ ok: true, problems: [], otherLanguage: null });
    expect(checkStructure({ files: ["top.v"], report: reviewCodebase(src, 5), hdl: "vhdl" }).otherLanguage).toBe("verilog");
  });
  it("reports an upload with no HDL files", () => {
    const r = checkStructure({ files: [], report: null, hdl: "vhdl" });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/no \.vhd\/\.vhdl\/\.vho, \.v, \.sv files/);
  });
});

describe("AI restructuring prompt", () => {
  it("says what Pipelith needs for the language and depth, and lists problems and paths", () => {
    const p = restructurePrompt({
      hdl: "systemverilog",
      depth: 6,
      paths: ["proj/rtl/core.sv", "proj/rtl/alu.sv", "proj/docs/notes.pdf"],
      problems: ["1 package is missing (cpu_pkg)"],
      uploadName: "my core.zip",
    });
    expect(p).toMatch(/6-stage pipelined processor written in SystemVerilog/);
    expect(p).toMatch(/import pkg::\*/);
    expect(p).toMatch(/if_id, id_ex1, ex1_ex2, ex2_mem, mem_wb/);
    expect(p).toMatch(/- 1 package is missing \(cpu_pkg\)\./);
    expect(p).toContain("proj/docs/notes.pdf\nproj/rtl/alu.sv\nproj/rtl/core.sv");
    expect(p).toMatch(/zip -r my-core\.zip my-core -i '\*\.sv' '\*\.svh'/);
    expect(p).toMatch(/Don't change any code/);
    expect(p).toMatch(/Don't write the missing code yourself/);
  });
  it("names the zip after a .zip or folder, never after a single source file", () => {
    const base = { hdl: "verilog" as const, depth: 5 as const, paths: ["top.v"], problems: [] };
    expect(restructurePrompt({ ...base, uploadName: "top.v" })).toContain("zip -r my-cpu.zip my-cpu");
    expect(restructurePrompt({ ...base, uploadName: "3 files" })).toContain("zip -r 3-files.zip 3-files");
    expect(restructurePrompt({ ...base, uploadName: "../core.zip" })).toContain("zip -r core.zip core");
  });
  it("lists at most a few hundred paths", () => {
    const paths = Array.from({ length: 1000 }, (_, i) => `rtl/f${String(i).padStart(4, "0")}.vhd`);
    const p = restructurePrompt({ hdl: "vhdl", depth: 5, paths, problems: [] });
    expect(p.split("\n").filter((l) => l.startsWith("rtl/"))).toHaveLength(MAX_PROMPT_PATHS);
    expect(p).toContain(`… and ${1000 - MAX_PROMPT_PATHS} more`);
    expect(p).toMatch(/if_id, id_ex, ex_mem, mem_wb/);
  });
});

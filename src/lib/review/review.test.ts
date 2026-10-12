import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanPath, readZip, stripCommonRoot } from "./intake";
import { lex } from "./lexer";
import { reviewCodebase, type Finding } from "./review";
import { createZip } from "../util/zip";

const review = (files: Record<string, string>, depth: 5 | 6 = 6) =>
  reviewCodebase(Object.entries(files).map(([path, text]) => ({ path, text })), depth);
const rules = (fs: Finding[]) => fs.map((f) => f.rule);

const HEAD = "library ieee;\nuse ieee.std_logic_1164.all;\nuse ieee.numeric_std.all;\n";
const unit = (name: string, ports: string, body: string, decls = "") =>
  `${HEAD}entity ${name} is\n  port (${ports});\nend entity;\narchitecture rtl of ${name} is\n${decls}\nbegin\n${body}\nend architecture;\n`;

describe("lexer", () => {
  it("tells character literals from attribute ticks", () => {
    const t = lex("if clk'event and clk = '1' then x <= x\"FF\"; y <= 16#1F#; end if;").tokens;
    expect(t.filter((x) => x.k === "chr").map((x) => x.v)).toEqual(["'1'"]);
    expect(t.find((x) => x.k === "bits")?.v).toBe('x"FF"');
    expect(t.find((x) => x.k === "num")?.v).toBe("16#1F#");
  });
  it("reports unterminated strings", () => {
    expect(lex('x <= "0101;\n').errors[0].message).toMatch(/not closed/);
  });
});

describe("syntax", () => {
  it("finds a missing end if and points at the opener", () => {
    const r = review({
      "a.vhd": unit("a", "clk : in std_logic; q : out std_logic", "process (clk) begin\n if rising_edge(clk) then\n q <= '1';\nend process;"),
    });
    const f = r.findings.find((x) => x.rule === "syntax")!;
    expect(f.severity).toBe("error");
    expect(f.message).toMatch(/if opened on line 11 is still open when “end process” is reached/);
    expect(r.findings.filter((x) => x.rule === "syntax")).toHaveLength(1);
    expect(f.fix).toMatch(/end if/);
    expect(r.unparsed).toEqual(["a.vhd"]);
  });
});

describe("process rules", () => {
  it("flags an incomplete sensitivity list and suggests process(all)", () => {
    const r = review({ "m.vhd": unit("m", "a, b, s : in std_logic; y : out std_logic", "process (a, s) begin\n if s = '1' then y <= b; else y <= a; end if;\nend process;") });
    const f = r.findings.find((x) => x.rule === "sensitivity-incomplete")!;
    expect(f.message).toContain("b");
    expect(f.fixCode).toMatch(/process \(all\)/);
  });
  it("detects a latch from a missing else, and not when there is a default", () => {
    const latch = review({ "l.vhd": unit("l", "en, d : in std_logic; q : out std_logic", "process (en, d) begin\n if en = '1' then q <= d; end if;\nend process;") });
    expect(rules(latch.findings)).toContain("latch");
    const ok = review({ "l.vhd": unit("l", "en, d : in std_logic; q : out std_logic", "process (en, d) begin\n q <= '0';\n if en = '1' then q <= d; end if;\nend process;") });
    expect(rules(ok.findings)).not.toContain("latch");
  });
  it("checks clocked processes: missing clock, missing async reset, legacy edge, logic outside the edge", () => {
    const r = review({
      "c.vhd": unit(
        "c",
        "clk, rst, d : in std_logic; q, z : out std_logic",
        "process (d) begin\n if rst = '0' then q <= '0';\n elsif clk'event and clk = '1' then q <= d; end if;\n z <= d;\nend process;",
      ),
    });
    const got = rules(r.findings);
    expect(got).toEqual(expect.arrayContaining(["sensitivity-clock", "sensitivity-reset", "legacy-edge", "outside-edge"]));
    expect(r.findings.find((x) => x.rule === "sensitivity-clock")!.severity).toBe("error");
  });
  it("requires when others for a std_logic_vector case", () => {
    const r = review({
      "k.vhd": unit("k", "s : in std_logic_vector(1 downto 0); y : out std_logic", 'process (s) begin\n y <= \'0\';\n case s is\n when "00" => y <= \'1\';\n when "01" => y <= \'0\';\n end case;\nend process;'),
    });
    expect(rules(r.findings)).toContain("case-others");
  });
});

describe("connectivity rules", () => {
  it("finds multiple drivers, undriven signals and assignments to inputs", () => {
    const r = review({
      "d.vhd": unit("d", "a : in std_logic; y : out std_logic", "x <= a;\nx <= not a;\ny <= u;\na <= '1';", "signal x, u : std_logic;"),
    });
    expect(rules(r.findings)).toEqual(expect.arrayContaining(["multiple-drivers", "undriven", "assign-to-input"]));
  });
  it("finds width mismatches using generics and literals", () => {
    const r = review({
      "w.vhd": unit("w", "a : in std_logic_vector(7 downto 0); y : out std_logic_vector(W - 1 downto 0)", 'y <= a;\nz <= "101";', "constant W : integer := 4;\nsignal z : std_logic_vector(3 downto 0);"),
    });
    const ws = r.findings.filter((x) => x.rule === "width-mismatch");
    expect(ws).toHaveLength(2);
    expect(ws[0].fix).toMatch(/downto 0/);
  });
  it("checks instances against the entity: unknown units, formals, unconnected inputs, port widths", () => {
    const leaf = unit("leaf", "a : in std_logic_vector(3 downto 0); b : in std_logic; y : out std_logic", "y <= a(0) and b;");
    const top = unit(
      "top",
      "x : in std_logic_vector(7 downto 0); o : out std_logic",
      "u1 : entity work.leaf port map (a => x, y => o, nope => x);\nu2 : entity work.missing port map (a => x);",
    );
    const got = rules(review({ "leaf.vhd": leaf, "top.vhd": top }).findings);
    expect(got).toEqual(expect.arrayContaining(["unknown-formal", "input-unconnected", "width-mismatch", "unknown-unit"]));
  });
  it("compares component declarations with their entities", () => {
    const leaf = unit("leaf", "a : in std_logic; extra : out std_logic; y : out std_logic", "y <= a; extra <= a;");
    const top = `${HEAD}entity top is port (a : in std_logic; y : out std_logic); end entity;
architecture rtl of top is
  component leaf port (a : in std_logic; y : in std_logic); end component;
begin
  u : leaf port map (a => a, y => y);
end architecture;`;
    const fs = review({ "leaf.vhd": leaf, "top.vhd": top }).findings.filter((f) => f.rule === "component-mismatch");
    expect(fs.map((f) => f.title)).toEqual(expect.arrayContaining([expect.stringMatching(/missing port extra/), expect.stringMatching(/“in” in the component but “out”/)]));
  });
  it("flags unused inputs, especially reset", () => {
    const r = review({ "p.vhd": unit("p", "clk, rst : in std_logic; d : in std_logic; q : out std_logic", "process (clk) begin\n if rising_edge(clk) then q <= d; end if;\nend process;") });
    const f = r.findings.find((x) => x.rule === "unused-input")!;
    expect(f.message).toMatch(/ignores reset/);
    expect(f.fix).toMatch(/rising_edge/);
  });
});

describe("style rules", () => {
  it("warns about Synopsys packages mixed with numeric_std", () => {
    const r = review({ "s.vhd": "library ieee; use ieee.std_logic_unsigned.all; use ieee.numeric_std.all;\n" + unit("s", "a : in std_logic; y : out std_logic", "y <= a;").replace(HEAD, "") });
    expect(r.findings.find((x) => x.rule === "non-standard-package")!.title).toMatch(/mixed/);
  });
});

describe("pipeline checks follow the selected depth", () => {
  const reg = (n: string) => unit(n, "clk, stall, flush : in std_logic; a_in : in std_logic; a_out : out std_logic; b_in : in std_logic", "process (clk) begin if rising_edge(clk) then a_out <= a_in; end if; end process;");
  const five = { "if_id.vhd": reg("if_id_register"), "id_ex.vhd": reg("id_ex_register"), "ex_mem.vhd": reg("ex_mem_register"), "mem_wb.vhd": reg("mem_wb_register") };
  it("infers 5 stages and agrees when 5 is selected", () => {
    const r = review(five, 5);
    expect(r.pipeline.inferred).toBe(5);
    expect(rules(r.findings)).not.toContain("pipeline-depth");
    expect(rules(r.findings)).not.toContain("pipeline-register-missing");
    expect(r.findings.filter((f) => f.rule === "pipeline-field-dropped")).toHaveLength(4); // b_in has no b_out
  });
  it("warns when 6 stages are selected for a 5-stage design, and lists the missing registers", () => {
    const r = review(five, 6);
    expect(r.findings.find((f) => f.rule === "pipeline-depth")!.title).toMatch(/5-stage.*6 stages/);
    expect(r.findings.filter((f) => f.rule === "pipeline-register-missing").map((f) => f.title)).toEqual(
      expect.arrayContaining([expect.stringMatching(/ID\/EX1/), expect.stringMatching(/EX1\/EX2/), expect.stringMatching(/EX2\/MEM/)]),
    );
  });
});

describe("the reference processor", () => {
  const load = async () => {
    const buf = readFileSync(join(__dirname, "../../../public/samples/reference-rtl.zip"));
    return readZip(new Blob([buf]));
  };
  it("unpacks the bundled zip (deflate) with RTL and test programs", async () => {
    const z = await load();
    expect(z.files.length).toBe(28);
    expect(z.programs.length).toBe(4);
    expect(stripCommonRoot(z.files)[0].path).toBe("components/alu.vhd");
  });
  it("parses every file and reports the real issues without false errors", async () => {
    const z = await load();
    const r = reviewCodebase(z.files, 6);
    expect(r.unparsed).toEqual([]);
    expect(r.top).toBe("processor");
    expect(r.pipeline.inferred).toBe(6);
    expect(r.counts.error).toBe(0);
    const titles = r.findings.map((f) => f.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Input rst of pc is never used",
        "Input reset of control_unit is never used",
        "Component if_id_register is missing port imm_follows_out",
        "Component execute1_stage is missing port alu_flags_out",
        expect.stringMatching(/assigned outside the clock edge/),
      ]),
    );
    expect(r.compileOrder[r.compileOrder.length - 1]).toMatch(/processor\.vhd$/);
    expect(r.compileOrder.indexOf(r.compileOrder.find((p) => p.endsWith("mux_2to1.vhd"))!)).toBeLessThan(
      r.compileOrder.indexOf(r.compileOrder.find((p) => p.endsWith("decode.vhd"))!),
    );
  });
  it("flags the depth mismatch when 5 stages are selected", async () => {
    const r = reviewCodebase((await load()).files, 5);
    expect(r.findings.find((f) => f.rule === "pipeline-depth")!.title).toMatch(/6-stage pipeline, but 5 stages/);
  });
});

describe("intake safety", () => {
  it("cleans hostile paths", () => {
    expect(cleanPath("../../etc/passwd")).toBe("etc/passwd");
    expect(cleanPath("C:\\x\\..\\y.vhd")).toBe("C:/x/y.vhd");
  });
  it("reads stored zips: HDL files in any language, nothing else", async () => {
    const z = createZip([
      { name: "rtl/a.vhd", content: "entity a is end;" },
      { name: "rtl/b.v", content: "module b; endmodule" },
      { name: "README.md", content: "hi" },
    ]);
    const r = await readZip(new Blob([z]));
    expect(r.files.map((f) => f.path)).toEqual(["rtl/a.vhd", "rtl/b.v"]);
    expect(r.skipped).toEqual([]);
  });
  it("rejects files that are not zips", async () => {
    await expect(readZip(new Blob(["not a zip at all"]))).rejects.toThrow(/not a \.zip/);
  });
  it("stays fast on large inputs", () => {
    const big = unit("big", "a : in std_logic; y : out std_logic", Array.from({ length: 3000 }, (_, i) => `s${i} <= a;`).join("\n") + "\ny <= a;", Array.from({ length: 3000 }, (_, i) => `signal s${i} : std_logic;`).join("\n"));
    const t = performance.now();
    review({ "big.vhd": big });
    expect(performance.now() - t).toBeLessThan(3000);
  });
});

describe("forwarding settings change the review", () => {
  const fwdUnit = unit("forwarding_unit", "ex_mem_rd, mem_wb_rd : in std_logic_vector(2 downto 0); sel : out std_logic", "sel <= ex_mem_rd(0) xor mem_wb_rd(0);");
  const hazard = unit("hazard_unit", "a : in std_logic; stall : out std_logic", "stall <= a;");
  it("expects the selected paths in the forwarding unit", () => {
    const six = review({ "f.vhd": fwdUnit, "h.vhd": hazard }, 6);
    const f = six.findings.find((x) => x.rule === "forwarding-sources")!;
    expect(f.severity).toBe("warning");
    expect(f.title).toMatch(/EX1\/EX2, EX2\/MEM/);
    expect(review({ "f.vhd": fwdUnit, "h.vhd": hazard }, 5).findings.map((x) => x.rule)).not.toContain("forwarding-sources");
  });
  it("with forwarding off, a forwarding unit is noted and a missing hazard unit becomes a warning", () => {
    const off = { enabled: false, paths: [] as string[], writeThrough: true };
    const withUnit = reviewCodebase([{ path: "f.vhd", text: fwdUnit }], 5, off).findings;
    expect(withUnit.map((x) => x.rule)).toContain("forwarding-unexpected");
    expect(withUnit.find((x) => x.rule === "no-hazard-unit")!.severity).toBe("warning");
  });
  it("selecting fewer paths than the design has is reported as extra", () => {
    const r = reviewCodebase([{ path: "f.vhd", text: fwdUnit }, { path: "h.vhd", text: hazard }], 5, { enabled: true, paths: ["MEM/WB"], writeThrough: true });
    expect(r.findings.find((x) => x.rule === "forwarding-extra")!.title).toMatch(/EX\/MEM/);
    expect(r.pipeline.forwarding.found).toEqual(["EX/MEM", "MEM/WB"]);
  });
  it("flags a package the upload is missing", () => {
    const r = review({ "a.vhd": "library ieee; use ieee.std_logic_1164.all; use work.cpu_pkg.all;\n" + unit("a", "x : in std_logic; y : out std_logic", "y <= x;").replace(HEAD, "") });
    expect(r.findings.find((x) => x.rule === "missing-package")!.title).toBe("Package cpu_pkg is not in the upload");
  });
});

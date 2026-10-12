import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { readZip } from "./intake";
import { reviewCodebase, type Finding } from "./review";
import { preprocess } from "./verilog/lexer";
import { parseVerilogFile } from "./verilog/parse";
import { evalV, numValue } from "./verilog/review";
import { createZip } from "../util/zip";

const review = (files: Record<string, string>, depth: 5 | 6 = 5) => reviewCodebase(Object.entries(files).map(([path, text]) => ({ path, text })), depth);
const rules = (fs: Finding[]) => fs.map((f) => f.rule);
const errors = (fs: Finding[]) => fs.filter((f) => f.severity === "error").map((f) => `${f.rule} ${f.file}:${f.line} ${f.title}`);
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

describe("Verilog lexer and preprocessor", () => {
  it("reads sized literals, escaped names, attributes and @(*)", () => {
    const t = preprocess("a.v", "(* keep *) wire \\bus[0] ; assign x = 8'hFF + 4 'b10_10 + 'd3 + '0; always @(*) y = 1;").tokens;
    expect(t.filter((x) => x.k === "num").map((x) => x.v)).toEqual(["8'hFF", "4'b10_10", "'d3", "'0", "1"]);
    expect(t.some((x) => x.k === "id" && x.v === "bus[0]")).toBe(true);
    expect(t.some((x) => x.v === "keep")).toBe(false);
    const at = t.findIndex((x) => x.v === "@");
    expect(t.slice(at, at + 4).map((x) => x.v)).toEqual(["@", "(", "*", ")"]);
  });
  it("expands macros with arguments and follows `ifdef / `else", () => {
    const src = "`define W 8\n`define ADD(a, b) ((a) + (b))\n`ifdef SIM\nwire sim;\n`else\nwire [`W-1:0] hw = `ADD(x, 1);\n`endif\n";
    const ids = preprocess("m.v", src).tokens.map((x) => x.v).join(" ");
    expect(ids).toContain("wire [ 8 - 1 : 0 ] hw = ( ( x ) + ( 1 ) )");
    expect(ids).not.toContain("sim");
  });
  it("inlines includes from the upload once, honouring include guards", () => {
    const hdr = "`ifndef D_VH\n`define D_VH\n`define OP 5'd3\n`endif\n";
    const pp = preprocess("m.v", '`include "d.vh"\n`include "d.vh"\nassign y = `OP;', { include: (n) => (n === "d.vh" ? { path: "d.vh", text: hdr } : null) });
    expect(pp.tokens.map((x) => x.v)).toEqual(["assign", "y", "=", "5'd3", ";"]);
    expect(pp.includes.map((i) => i.path)).toEqual(["d.vh", "d.vh"]);
  });
  it("evaluates constant expressions over parameters", () => {
    const env = new Map([["W", 32]]);
    const t = (s: string) => preprocess("x.v", s).tokens;
    expect(evalV(t("W-1"), env)).toBe(31);
    expect(evalV(t("$clog2(W)"), env)).toBe(5);
    expect(evalV(t("(W > 16) ? 2 : 1"), env)).toBe(2);
    expect(numValue("8'hFF")).toBe(255);
    expect(numValue("4'b1x01")).toBeNull();
  });
  it("stays bounded on a macro bomb", () => {
    let src = "`define A0 x x\n";
    for (let i = 1; i < 30; i++) src += `\`define A${i} \`A${i - 1} \`A${i - 1}\n`;
    src += "wire y = `A29;";
    const t = performance.now();
    const pp = preprocess("bomb.v", src);
    expect(performance.now() - t).toBeLessThan(3000);
    expect(pp.tokens.length).toBeLessThanOrEqual(600_000);
  });
});

describe("Verilog parser", () => {
  it("reads ANSI and non-ANSI ports, parameters and declarations", () => {
    const m = parseVerilogFile(
      "m.v",
      "module m #(parameter W = 8) (input wire clk, input [W-1:0] a, b, output reg [W-1:0] y);\n wire [3:0] t;\nendmodule\nmodule n (a, y);\n input [7:0] a; output y; reg y;\nendmodule",
    );
    const [u, v] = m.units;
    expect(u.ports.map((p) => `${p.dir} ${p.name}${p.variable ? " var" : ""}`)).toEqual(["input clk", "input a", "input b", "output y var"]);
    expect(u.params.map((p) => p.name)).toEqual(["W"]);
    expect(v.ansi).toBe(false);
    expect(v.decls.get("y")?.kind).toBe("var");
  });
  it("builds statement trees for always blocks", () => {
    const m = parseVerilogFile("m.v", "module m(input clk, input [1:0] s, output reg q, output reg [3:0] y); always @(posedge clk or negedge rst_n) if (!rst_n) q <= 0; else q <= ~q; always @* begin y = 0; case (s) 2'd0: y = 1; default: y = 2; endcase end endmodule");
    const [ff, comb] = m.units[0].procs;
    expect(ff.events).toEqual([{ edge: "posedge", name: "clk" }, { edge: "negedge", name: "rst_n" }]);
    expect(ff.body[0].k).toBe("if");
    expect(comb.events).toBe("star");
    expect(comb.body.map((s) => s.k)).toEqual(["assign", "case"]);
  });
  it("tells instances from declarations of user types", () => {
    const m = parseVerilogFile("m.sv", "module m; state_t s; my_mod #(.W(4)) u1 (.a(x), .b()); my_mod u2 (x, y), u3 (.*); pkg::t_t v; endmodule");
    const u = m.units[0];
    expect(u.instances.map((i) => i.label)).toEqual(["u1", "u2", "u3"]);
    expect(u.instances[2].wildcard).toBe(true);
    expect([...u.decls.keys()]).toEqual(["s", "v"]);
  });
});

/* ---------- clean designs: no errors ---------- */

const CLEAN: Record<string, string> = {
  "alu.v": `module alu #(parameter W = 32) (
  input  wire [W-1:0] a, b,
  input  wire [2:0]   op,
  output reg  [W-1:0] y,
  output wire         zero
);
  always @(*) begin
    case (op)
      3'd0: y = a + b;
      3'd1: y = a - b;
      3'd2: y = a & b;
      3'd3: y = a | b;
      default: y = {W{1'b0}};
    endcase
  end
  assign zero = (y == {W{1'b0}});
endmodule`,
  "regfile.v": `module regfile (clk, rst, we, wa, wd, ra, rd);
  input clk, rst, we;
  input [2:0] wa, ra;
  input [31:0] wd;
  output [31:0] rd;
  reg [31:0] r [0:7];
  integer i;
  always @(posedge clk) begin
    if (rst) begin
      for (i = 0; i < 8; i = i + 1) r[i] <= 32'd0;
    end else if (we) r[wa] <= wd;
  end
  assign rd = r[ra];
endmodule`,
  "fsm.v": `module fsm (input clk, input rst_n, input go, output reg busy);
  localparam IDLE = 2'd0, RUN = 2'd1, DONE = 2'd2;
  reg [1:0] state, next;
  always @(posedge clk or negedge rst_n)
    if (!rst_n) state <= IDLE;
    else state <= next;
  always @* begin
    next = state;
    busy = 1'b0;
    case (state)
      IDLE: if (go) next = RUN;
      RUN: begin busy = 1'b1; next = DONE; end
      DONE: next = IDLE;
      default: next = IDLE;
    endcase
  end
endmodule`,
  "top.v": `\`timescale 1ns/1ps
module top (input clk, input rst, input [31:0] x, output [31:0] y, output busy);
  wire [31:0] s;
  wire z;
  genvar g;
  alu #(.W(32)) u_alu (.a(x), .b(32'd1), .op(3'd0), .y(s), .zero(z));
  regfile u_rf (clk, rst, 1'b1, 3'd1, s, 3'd1, y);
  fsm u_fsm (.clk(clk), .rst_n(~rst), .go(z), .busy(busy));
  generate
    for (g = 0; g < 2; g = g + 1) begin : buf_gen
      wire t;
      assign t = x[g];
    end
  endgenerate
endmodule`,
  "tb_top.v": `\`timescale 1ns/1ps
module tb_top;
  reg clk = 0, rst = 1;
  reg [31:0] x;
  wire [31:0] y;
  wire busy;
  top uut (.clk(clk), .rst(rst), .x(x), .y(y), .busy(busy));
  always #5 clk = ~clk;
  task step(input [31:0] v); begin x = v; @(posedge clk); end endtask
  initial begin
    $dumpfile("wave.vcd");
    $dumpvars(0, tb_top);
    x = 0;
    #12 rst = 0;
    step(32'd5);
    $display("y=%h pc=%h", y, tb_top.uut.y);
    $finish;
  end
endmodule`,
};

const CLEAN_SV: Record<string, string> = {
  "pkg.sv": `package cpu_pkg;
  typedef enum logic [1:0] {IDLE, FETCH, EXEC} state_t;
  localparam int XLEN = 32;
  function automatic logic [XLEN-1:0] inc(input logic [XLEN-1:0] v);
    return v + 1;
  endfunction
endpackage`,
  "bus_if.sv": `interface bus_if;
  logic [31:0] data;
  logic valid;
  modport master (output data, output valid);
  modport slave (input data, input valid);
endinterface`,
  "core.sv": `\`default_nettype none
module core import cpu_pkg::*; (
  input  logic clk,
  input  logic rst_n,
  bus_if.master bus
);
  state_t state, next;
  logic [XLEN-1:0] pc;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      state <= IDLE;
      pc <= '0;
    end else begin
      state <= next;
      if (state == EXEC) pc <= inc(pc);
    end
  end
  always_comb begin
    next = state;
    unique case (state)
      IDLE: next = FETCH;
      FETCH: next = EXEC;
      EXEC: next = IDLE;
    endcase
  end
  assign bus.data = pc;
  assign bus.valid = (state == EXEC);
endmodule
\`default_nettype wire`,
  "soc.sv": `module soc (input logic clk, input logic rst_n, output logic [31:0] out);
  bus_if b();
  core u_core (.clk, .rst_n, .bus(b));
  always_ff @(posedge clk) if (b.valid) out <= b.data;
endmodule`,
};

describe("clean Verilog and SystemVerilog designs", () => {
  it("Verilog-2005 in several common styles has no errors", () => {
    const r = review(CLEAN);
    expect(errors(r.findings)).toEqual([]);
    expect(r.top).toBe("top");
    expect(r.testbenches).toEqual(["tb_top"]);
    expect(rules(r.findings)).not.toContain("latch");
    expect(rules(r.findings)).not.toContain("multiple-drivers");
    expect(rules(r.findings)).not.toContain("ff-blocking");
    expect(r.compileOrder[r.compileOrder.length - 1]).toBe("top.v");
    expect(r.compileOrder).not.toContain("tb_top.v");
  });
  it("SystemVerilog with packages, enums, interfaces and .name connections has no errors", () => {
    const r = review(CLEAN_SV);
    expect(errors(r.findings)).toEqual([]);
    expect(rules(r.findings)).not.toContain("latch");
    expect(r.compileOrder.indexOf("pkg.sv")).toBeLessThan(r.compileOrder.indexOf("core.sv"));
  });
  for (const lang of ["verilog", "systemverilog"]) {
    it(`the bundled 5-stage ${lang} reference design reviews clean`, () => {
      const root = join(__dirname, "../../../reference", lang, "rtl");
      const files = walk(root).map((p) => ({ path: relative(root, p), text: readFileSync(p, "utf8") }));
      const r = reviewCodebase(files, 5);
      expect(r.unparsed).toEqual([]);
      expect(r.counts).toEqual({ error: 0, warning: 0, info: 1 });
      expect(r.top).toBe("processor");
      expect(r.pipeline.inferred).toBe(5);
      expect(r.pipeline.forwardingUnit).toBe("forwarding_unit");
      expect(r.pipeline.hazardUnit).toBe("hazard_unit");
      expect(r.pipeline.forwarding.found).toEqual(["EX/MEM", "MEM/WB"]);
      expect(r.compileOrder).toHaveLength(16);
      expect(r.compileOrder.some((p) => /isa_defs/.test(p))).toBe(false);
      expect(r.findings.find((f) => f.rule === "pipeline-depth")).toBeUndefined();
      const six = reviewCodebase(files, 6);
      expect(six.findings.find((f) => f.rule === "pipeline-depth")!.title).toMatch(/5-stage pipeline, but 6 stages/);
    });
  }
});

/* ---------- one buggy case per rule ---------- */

describe("Verilog rules", () => {
  it("syntax: an unclosed begin points at the opener", () => {
    const r = review({ "a.v": "module a(input clk, output reg q);\nalways @(posedge clk) begin\n  q <= 1;\nendmodule" });
    const f = r.findings.find((x) => x.rule === "syntax")!;
    expect(f.message).toMatch(/begin opened on line 2 is still open when “endmodule”/);
    expect(r.unparsed).toEqual(["a.v"]);
  });
  it("structure: duplicate modules, unknown modules (vendor primitives only warned), missing includes and packages", () => {
    const r = review({
      "a.v": "module a(input x, output y); assign y = x; endmodule",
      "old/a.v": "module a(input x, output y); assign y = ~x; endmodule",
      "t.v": '`include "defs.vh"\nmodule t(input x, output y, output z); nope u (.x(x)); BUFG g (.I(x), .O(z)); a u2 (.x(x), .y(y)); endmodule',
      "s.sv": "module s import missing_pkg::*; (input logic x); endmodule",
    });
    expect(rules(r.findings)).toEqual(expect.arrayContaining(["duplicate-module", "unknown-unit", "missing-include", "missing-package"]));
    const unknown = r.findings.filter((x) => x.rule === "unknown-unit");
    expect(unknown.find((x) => /nope/.test(x.title))!.severity).toBe("error");
    expect(unknown.find((x) => /BUFG/.test(x.title))!.severity).toBe("warning");
  });
  it("connectivity: unknown ports, too many positional ports, unconnected inputs and width mismatches", () => {
    const leaf = "module leaf(input [3:0] a, input b, output y); assign y = a[0] & b; endmodule";
    const top = "module top(input [7:0] x, output o, output p); leaf u1 (.a(x), .y(o), .nope(x)); leaf u2 (x[3:0], x[4], p, x[5]); endmodule";
    const r = review({ "leaf.v": leaf, "top.v": top });
    expect(rules(r.findings)).toEqual(expect.arrayContaining(["unknown-formal", "port-map-count", "input-unconnected", "width-mismatch"]));
    expect(r.findings.find((x) => x.rule === "input-unconnected")!.severity).toBe("warning");
    expect(r.findings.find((x) => x.rule === "width-mismatch")!.severity).toBe("warning");
  });
  it("connectivity: wires assigned in always blocks, regs driven by assign, inputs assigned, undeclared names", () => {
    const r = review({
      "m.v": "module m(input clk, input a, output y, output z);\n wire w;\n reg r;\n always @(posedge clk) begin w <= a; y <= a; nothere <= a; end\n assign r = a;\n assign a = 1'b0;\n assign z = r & w;\nendmodule",
    });
    const got = rules(r.findings);
    expect(got).toEqual(expect.arrayContaining(["net-procedural-assign", "continuous-to-reg", "assign-to-input", "undeclared"]));
    expect(r.findings.filter((x) => x.rule === "net-procedural-assign").map((x) => x.title)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^w is a wire/), expect.stringMatching(/^y is a wire/)]),
    );
  });
  it("connectivity: an undeclared name in a connection becomes an implicit net, or an error with default_nettype none", () => {
    const leaf = "module leaf(input [7:0] a, output [7:0] y); assign y = a; endmodule";
    const loose = review({ "leaf.v": leaf, "t.v": "module t(input [7:0] x, output [7:0] o); leaf u (.a(x), .y(typo)); assign o = typo; endmodule" });
    expect(loose.findings.find((x) => x.rule === "implicit-net")!.message).toMatch(/typo/);
    const strict = review({ "leaf.v": leaf, "t.v": "`default_nettype none\nmodule t(input wire [7:0] x, output wire [7:0] o); leaf u (.a(x), .y(typo)); assign o = x; endmodule" });
    expect(strict.findings.find((x) => x.rule === "undeclared")!.severity).toBe("error");
  });
  it("connectivity: multiple drivers, undriven signals, unused inputs (reset) and undriven outputs", () => {
    const r = review({
      "d.v": "module d(input clk, input rst, input a, output reg q, output u);\n reg x;\n wire n;\n always @(posedge clk) x <= a;\n always @(posedge clk) x <= ~a;\n always @(posedge clk) q <= n;\nendmodule",
    });
    expect(rules(r.findings)).toEqual(expect.arrayContaining(["multiple-drivers", "undriven", "unused-input", "undriven-output"]));
    expect(r.findings.find((x) => x.rule === "unused-input")!.message).toMatch(/ignores reset/);
  });
  it("generate if/else arms driving the same wire are not multiple drivers", () => {
    const r = review({ "g.v": "module g #(parameter FAST = 1) (input [7:0] a, output [7:0] y); generate if (FAST) begin assign y = a; end else begin assign y = ~a; end endgenerate endmodule" });
    expect(rules(r.findings)).not.toContain("multiple-drivers");
  });
  it("processes: blocking in clocked blocks, non-blocking in combinational blocks, mixed assignments", () => {
    const r = review({
      "p.v": "module p(input clk, input a, output reg q, output reg c, output y);\n reg s;\n always @(posedge clk) begin s = a; q <= s; end\n always @* c <= a;\n always @(posedge clk) s <= ~a;\n assign y = s;\nendmodule",
    });
    expect(rules(r.findings)).toEqual(expect.arrayContaining(["ff-blocking", "comb-nonblocking", "mixed-assign"]));
  });
  it("processes: latches, incomplete sensitivity lists, always without events, delays in RTL", () => {
    const r = review({
      "l.v": "module l(input en, input d, input s, output reg q, output reg y);\n always @(en or d) if (en) q = d;\n always @(en) y = s;\n always begin q = 0; end\n assign #2 y2 = d;\nendmodule",
    });
    const got = rules(r.findings);
    expect(got).toEqual(expect.arrayContaining(["latch", "sensitivity-incomplete", "always-no-event", "delay-in-rtl"]));
    expect(r.findings.find((x) => x.rule === "sensitivity-incomplete")!.fixCode).toMatch(/always @\*/);
    expect(r.findings.find((x) => x.rule === "always-no-event")!.severity).toBe("error");
  });
  it("processes: a reset tested with the wrong polarity, and mixed polarity across the design", () => {
    const r = review({
      "r.v": "module r(input clk, input rst_n, input rst, input d, output reg q, output reg p);\n always @(posedge clk or negedge rst_n) if (rst_n) q <= 0; else q <= d;\n always @(posedge clk) if (rst) p <= 0; else p <= d;\nendmodule",
    });
    expect(rules(r.findings)).toEqual(expect.arrayContaining(["reset-edge-mismatch"]));
    const mixed = review({
      "a.v": "module a(input clk, input rst_n, input d, output reg q); always @(posedge clk or negedge rst_n) if (!rst_n) q <= 0; else q <= d; endmodule",
      "b.v": "module b(input clk, input rst, input d, output reg q); always @(posedge clk) if (rst) q <= 0; else q <= d; endmodule",
    });
    expect(rules(mixed.findings)).toContain("reset-polarity");
  });
  it("style: casex, mixed `timescale, missing default_nettype, file names and initial values", () => {
    const r = review({
      "x.v": "`timescale 1ns/1ps\nmodule x(input [1:0] s, output reg y); always @* casex (s) 2'b1?: y = 1; default: y = 0; endcase endmodule",
      "wrong_name.v": "module z(input a, output reg b); initial b = 0; always @(a) b = a; endmodule",
    });
    expect(rules(r.findings)).toEqual(expect.arrayContaining(["casex", "timescale-mixed", "default-nettype", "file-name", "signal-init"]));
  });
  it("pipeline checks work on modules, and mixed-language designs resolve across languages", () => {
    const reg = (n: string) => `module ${n}(input clk, input stall, input flush, input [31:0] a_in, output reg [31:0] a_out); always @(posedge clk) if (!stall) a_out <= flush ? 32'd0 : a_in; endmodule`;
    const r = review({ "a.v": reg("if_id_reg"), "b.v": reg("id_ex_reg"), "c.v": reg("ex_mem_reg"), "d.v": reg("mem_wb_reg") }, 6);
    expect(r.pipeline.inferred).toBe(5);
    expect(r.findings.find((f) => f.rule === "pipeline-depth")).toBeDefined();
    const mixed = review({
      "leaf.v": "module leaf(input a, output y); assign y = ~a; endmodule",
      "top.vhd": "library ieee; use ieee.std_logic_1164.all;\nentity top is port (a : in std_logic; y : out std_logic); end entity;\narchitecture rtl of top is begin\n  u : entity work.leaf port map (a => a, y => y);\nend architecture;",
    });
    expect(errors(mixed.findings)).toEqual([]);
    expect(mixed.top).toBe("top");
    expect(mixed.hierarchy!.children[0].entity).toBe("leaf");
    expect(mixed.compileOrder).toEqual(["leaf.v", "top.vhd"]);
    expect(mixed.languages).toEqual({ vhdl: 1, verilog: 1, systemverilog: 0 });
  });
});

describe("bundled reference codebases", () => {
  for (const lang of ["verilog", "systemverilog"] as const) {
    it(`public/samples/reference-rtl-${lang}.zip unpacks to the design and the test programs, and reviews clean`, async () => {
      const { stripCommonRoot } = await import("./intake");
      const z = await readZip(new Blob([readFileSync(join(__dirname, `../../../public/samples/reference-rtl-${lang}.zip`))]));
      expect(z.files).toHaveLength(17);
      expect(z.programs).toHaveLength(4);
      const r = reviewCodebase(stripCommonRoot(z.files), 5);
      expect(r.counts.error + r.counts.warning).toBe(0);
      expect(r.top).toBe("processor");
    });
  }
});

describe("Verilog intake and safety", () => {
  it("reads Verilog and SystemVerilog from a zip and ignores Verilator output", async () => {
    const z = createZip([
      { name: "rtl/a.vhd", content: "entity a is end;" },
      { name: "rtl/b.v", content: "module b; endmodule" },
      { name: "rtl/c.sv", content: "module c; endmodule" },
      { name: "rtl/defs.vh", content: "`define X 1" },
      { name: "obj_dir/Vtop.v", content: "module junk; endmodule" },
    ]);
    const r = await readZip(new Blob([z]));
    expect(r.files.map((f) => f.path)).toEqual(["rtl/a.vhd", "rtl/b.v", "rtl/c.sv", "rtl/defs.vh"]);
  });
  it("reviews adversarial Verilog quickly and without throwing", () => {
    const nasty = [
      "(".repeat(20000),
      "begin ".repeat(5000),
      "module m; " + "always @* begin ".repeat(2000),
      "module m (" + "a, ".repeat(5000) + "b); endmodule",
      "`define A(x) `A(x)\nmodule m; wire w = `A(1); endmodule",
      '`include "m.v"\nmodule m; endmodule',
      "'''\"\"\"" + "x".repeat(50000),
    ];
    for (const text of nasty) {
      const t = performance.now();
      review({ "m.v": text });
      expect(performance.now() - t).toBeLessThan(3000);
    }
  });
});

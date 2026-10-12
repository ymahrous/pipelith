/**
 * Verilog and SystemVerilog rules for Code review.
 *
 * Findings use the same format as VHDL and, where the problem is the same
 * (latches, multiple drivers, width mismatches, unconnected ports …), the same
 * rule ids. Problems that only exist in Verilog — blocking assignments in
 * clocked blocks, procedural assignments to wires, implicit nets — have their
 * own. Errors are reserved for code a compiler or elaborator rejects, or that
 * is certainly wrong; anything heuristic is a warning or a note.
 */
import { isHeaderPath } from "../../hdl";
import { RESET_NAME, type AddFinding, type DesignUnit, type PortMode, type ResetUse } from "../common";
import { collectDefines, isVKeyword, PRIMITIVES, type Macro, type VToken } from "./lexer";
import {
  collectCalls,
  collectReads,
  parseVerilogFile,
  readsIn,
  tokText,
  WIDTH_OF_TYPE,
  type Arm,
  type VDecl,
  type VFileModel,
  type VPackage,
  type VPort,
  type VProc,
  type VStmt,
  type VType,
  type VUnit,
} from "./parse";

export interface VerilogCodebase {
  files: VFileModel[];
  /** Every module, interface and program, as design units for hierarchy and cross-language instances. */
  units: DesignUnit[];
  /** Files read only through `include (headers, and unit files other files include). */
  included: Set<string>;
}

export interface VerilogContext {
  add: AddFinding;
  resetUses: ResetUse[];
  /** VHDL entities, for Verilog instances of VHDL units. */
  foreign: DesignUnit[];
}

export interface VerilogResult {
  units: DesignUnit[];
  deps: Map<string, Set<string>>;
  /** Headers and included files: never compiled on their own. */
  notCompiled: Set<string>;
  modules: number;
  alwaysBlocks: number;
  instances: number;
}

const MODE: Record<VPort["dir"], PortMode> = { input: "in", output: "out", inout: "inout", ref: "inout", interface: "inout" };
const UNIT_RE = /^\s*(?:module|macromodule|interface|program|package)\b/m;

const toDesignUnit = (u: VUnit): DesignUnit => ({
  name: u.name,
  lang: "verilog",
  file: u.file,
  line: u.line,
  ports: u.ports.map((p) => ({ name: p.name, mode: MODE[p.dir], line: p.line })),
  instances: u.instances.filter((i) => !i.primitive).map((i) => ({ label: i.label, target: i.target, line: i.line })),
  hasBody: true,
  testbench: u.kind === "module" && u.ports.length === 0,
});

/** Parse every Verilog/SystemVerilog file, resolving `include against the upload. */
export function parseVerilogCodebase(sources: { path: string; text: string }[]): VerilogCodebase {
  const byPath = new Map(sources.map((s) => [s.path, s]));
  const byBase = new Map<string, { path: string; text: string }[]>();
  for (const s of sources) {
    const base = s.path.split("/").pop()!;
    byBase.set(base, [...(byBase.get(base) ?? []), s]);
  }
  const normalize = (p: string) => {
    const out: string[] = [];
    for (const seg of p.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") out.pop();
      else out.push(seg);
    }
    return out.join("/");
  };
  const resolve = (name: string, from: string) => {
    const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
    for (const c of [dir + name, name]) {
      const hit = byPath.get(normalize(c));
      if (hit) return hit;
    }
    const clean = normalize(name);
    const list = byBase.get(clean.split("/").pop()!) ?? [];
    return list.find((s) => s.path.endsWith("/" + clean)) ?? list[0] ?? null;
  };
  const included = new Set<string>();
  for (const s of sources) {
    for (const m of s.text.matchAll(/`include\s+"([^"\n]+)"/g)) {
      const hit = resolve(m[1], s.path);
      if (hit && hit.path !== s.path) included.add(hit.path);
    }
  }
  const fallback = new Map<string, Macro>();
  for (const s of sources) {
    for (const [k, v] of collectDefines(s.text)) if (v.body.length && !fallback.has(k)) fallback.set(k, v);
  }
  const host = { include: (name: string, from: string) => resolve(name, from), fallback };
  const files: VFileModel[] = sources.map((s) => {
    if (included.has(s.path) && !isHeaderPath(s.path) && UNIT_RE.test(s.text)) {
      // Its units are reviewed where it is included.
      const m = parseVerilogFile(s.path, "", host);
      m.lines = s.text.split(/\r?\n/);
      return m;
    }
    return parseVerilogFile(s.path, s.text, host);
  });
  return { files, units: files.flatMap((f) => f.units).map(toDesignUnit), included };
}

/* ---------- constant expressions ---------- */

const BASES: Record<string, number> = { b: 2, o: 8, d: 10, h: 16 };

/** Value of a Verilog number literal; null when it has x/z bits or isn't one. */
export function numValue(v: string): number | null {
  const s = v.replace(/_/g, "");
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^(\d*)'[sS]?([bBoOdDhH])([0-9a-fA-F]+)$/.exec(s);
  if (m) {
    const n = parseInt(m[3], BASES[m[2].toLowerCase()]);
    return Number.isFinite(n) ? n : null;
  }
  if (s === "'0") return 0;
  if (s === "'1") return null;
  return null;
}

/** Width of a sized literal (8'hFF → 8); null for unsized ones. */
export function literalBits(v: string): number | null {
  const m = /^(\d+)'/.exec(v.replace(/_/g, ""));
  return m ? Number(m[1]) : null;
}

/** Evaluate a constant expression over parameters; null when anything is unknown. */
export function evalV(t: VToken[], env: Map<string, number>): number | null {
  let i = 0;
  const peek = () => t[i];
  const isOp = (v: string) => t[i]?.k === "op" && t[i].v === v;
  const BIN: [string[], (a: number, b: number) => number | null][] = [
    [["||"], (a, b) => (a || b ? 1 : 0)],
    [["&&"], (a, b) => (a && b ? 1 : 0)],
    [["|"], (a, b) => a | b],
    [["^"], (a, b) => a ^ b],
    [["&"], (a, b) => a & b],
    [["==", "!="], () => null],
    [["<", "<=", ">", ">="], () => null],
    [["<<", ">>", "<<<", ">>>"], () => null],
    [["+", "-"], () => null],
    [["*", "/", "%"], () => null],
    [["**"], (a, b) => a ** b],
  ];
  const apply = (op: string, a: number, b: number): number | null => {
    switch (op) {
      case "==":
        return a === b ? 1 : 0;
      case "!=":
        return a !== b ? 1 : 0;
      case "<":
        return a < b ? 1 : 0;
      case "<=":
        return a <= b ? 1 : 0;
      case ">":
        return a > b ? 1 : 0;
      case ">=":
        return a >= b ? 1 : 0;
      case "<<":
      case "<<<":
        return b < 53 ? a * 2 ** b : null;
      case ">>":
      case ">>>":
        return Math.floor(a / 2 ** b);
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        return b ? Math.trunc(a / b) : null;
      case "%":
        return b ? a % b : null;
      default:
        return null;
    }
  };
  const level = (n: number): number | null => {
    if (n >= BIN.length) return unary();
    let v = level(n + 1);
    for (;;) {
      const x = peek();
      if (v === null || !x || x.k !== "op" || !BIN[n][0].includes(x.v)) return v;
      i++;
      const r = level(n + 1);
      if (r === null) return null;
      const viaFn = BIN[n][1](v, r);
      v = viaFn ?? apply(x.v, v, r);
      if (v === null || !Number.isFinite(v)) return null;
    }
  };
  const ternary = (): number | null => {
    const c = level(0);
    if (!isOp("?")) return c;
    i++;
    const a = ternary();
    if (!isOp(":")) return null;
    i++;
    const b = ternary();
    return c === null || a === null || b === null ? null : c ? a : b;
  };
  const unary = (): number | null => {
    const x = t[i++];
    if (!x) return null;
    if (x.k === "op" && x.v === "-") {
      const v = unary();
      return v === null ? null : -v;
    }
    if (x.k === "op" && x.v === "+") return unary();
    if (x.k === "op" && x.v === "!") {
      const v = unary();
      return v === null ? null : v ? 0 : 1;
    }
    if (x.k === "op" && x.v === "(") {
      const v = ternary();
      if (!isOp(")")) return null;
      i++;
      return v;
    }
    if (x.k === "num") return numValue(x.v);
    if (x.k === "id") return env.get(x.v) ?? null;
    if (x.k === "sys" && x.v === "$clog2" && isOp("(")) {
      i++;
      const v = ternary();
      if (!isOp(")")) return null;
      i++;
      return v === null ? null : v <= 1 ? 0 : Math.ceil(Math.log2(v));
    }
    return null;
  };
  const v = ternary();
  return i === t.length ? v : null;
}

/** Width of one packed dimension: [a:b] or [N]. */
function dimWidth(d: VToken[], env: Map<string, number>): number | null {
  let depth = 0;
  let colon = -1;
  for (let j = 0; j < d.length; j++) {
    const x = d[j];
    if (x.k === "op" && (x.v === "(" || x.v === "[" || x.v === "{")) depth++;
    else if (x.k === "op" && (x.v === ")" || x.v === "]" || x.v === "}")) depth--;
    else if (depth === 0 && x.k === "op" && x.v === ":") {
      colon = j;
      break;
    }
  }
  if (colon < 0) return evalV(d, env);
  const a = evalV(d.slice(0, colon), env);
  const b = evalV(d.slice(colon + 1), env);
  return a === null || b === null ? null : Math.abs(a - b) + 1;
}

function dimsWidth(dims: VToken[][], env: Map<string, number>): number | null {
  let w = 1;
  for (const d of dims) {
    const x = dimWidth(d, env);
    if (x === null) return null;
    w *= x;
  }
  return w;
}

/* ---------- statement helpers ---------- */

interface Write {
  line: number;
  whole: boolean;
  blocking: boolean;
  /** Written by a for-loop header: an index, never a register or a latch. */
  loop?: boolean;
}

function writesIn(stmts: VStmt[], out: Map<string, Write[]>) {
  const put = (name: string, w: Write) => out.set(name, [...(out.get(name) ?? []), w]);
  for (const s of stmts) {
    if (s.k === "assign") {
      for (const tg of s.targets) put(tg.name, { line: s.line, whole: tg.whole, blocking: s.blocking });
    } else if (s.k === "if") s.branches.forEach((b) => writesIn(b.body, out));
    else if (s.k === "case") s.items.forEach((i) => writesIn(i.body, out));
    else if (s.k === "loop" || s.k === "timing") {
      if (s.k === "loop") for (const v of s.loopVars) put(v, { line: s.line, whole: true, blocking: true, loop: true });
      writesIn(s.body, out);
    }
  }
  return out;
}

const loopOnly = (l: Write[]) => l.every((x) => x.loop);

/**
 * Names written on every path. Writes to part of a vector count too (assigning
 * each bit in turn is common), so only a path with no write at all is a latch.
 */
function definitely(stmts: VStmt[], full: (s: Extract<VStmt, { k: "case" }>) => boolean): Set<string> {
  const out = new Set<string>();
  for (const s of stmts) {
    if (s.k === "assign") {
      for (const tg of s.targets) out.add(tg.name);
    } else if (s.k === "if") {
      if (!s.hasElse) continue;
      const sets = s.branches.map((b) => definitely(b.body, full));
      for (const n of sets[0]) if (sets.every((x) => x.has(n))) out.add(n);
    } else if (s.k === "case") {
      if (!(s.hasDefault || s.unique || full(s)) || !s.items.length) continue;
      const sets = s.items.map((i) => definitely(i.body, full));
      for (const n of sets[0]) if (sets.every((x) => x.has(n))) out.add(n);
    } else if (s.k === "timing") {
      for (const n of definitely(s.body, full)) out.add(n);
    } else if (s.k === "loop" && s.loopVars.length) {
      // for loops in logic run a fixed, non-zero number of times
      for (const v of s.loopVars) out.add(v);
      for (const n of definitely(s.body, full)) out.add(n);
    }
  }
  return out;
}

function anyStmt(stmts: VStmt[], pred: (s: VStmt) => boolean): VStmt | null {
  for (const s of stmts) {
    if (pred(s)) return s;
    const kids = s.k === "if" ? s.branches.flatMap((b) => b.body) : s.k === "case" ? s.items.flatMap((i) => i.body) : s.k === "loop" || s.k === "timing" ? s.body : [];
    const hit = anyStmt(kids, pred);
    if (hit) return hit;
  }
  return null;
}

/** "!rst_n", "~rst_n", "rst_n == 1'b0", "rst", "rst == 1" → the reset name and its active level. */
function resetCond(cond: VToken[]): { name: string; level: "0" | "1" } | null {
  const c = cond.filter((x) => !(x.k === "op" && (x.v === "(" || x.v === ")")));
  const name = (x: VToken | undefined) => (x && x.k === "id" && RESET_NAME.test(x.v) ? x.v : null);
  if (c.length === 1 && name(c[0])) return { name: c[0].v, level: "1" };
  if (c.length === 2 && c[0].k === "op" && (c[0].v === "!" || c[0].v === "~") && name(c[1])) return { name: c[1].v, level: "0" };
  if (c.length === 3 && name(c[0]) && c[1].k === "op" && ["==", "===", "!=", "!=="].includes(c[1].v)) {
    const v = numValue(c[2].v);
    if (v === 0 || v === 1) {
      const eq = c[1].v === "==" || c[1].v === "===";
      return { name: c[0].v, level: (v === 1) === eq ? "1" : "0" };
    }
  }
  return null;
}

const exclusive = (a: Arm[], b: Arm[]) => a.some((x) => b.some((y) => x.gen === y.gen && x.arm !== y.arm));

/** Vendor and cell-library primitives the upload can't contain: warnings, not errors. */
const VENDOR = /^[A-Z][A-Z0-9_]*$|^(alt|lpm_|dcfifo|scfifo|sky130_|gf180|sg13g2_|xpm_)/;
const LIB_INCLUDE = /^(uvm|ovm|vmm)_|^(std|svunit|vunit)/i;
const STD_PACKAGES = new Set(["std", "uvm_pkg", "ovm_pkg", "vmm_pkg", "svunit_pkg"]);

/* ---------- rules ---------- */

export function reviewVerilog(cb: VerilogCodebase, ctx: VerilogContext): VerilogResult {
  const { add } = ctx;
  const files = cb.files;
  const notCompiled = new Set<string>([...files.filter((f) => f.header).map((f) => f.path), ...cb.included]);

  // Syntax
  for (const f of files) {
    for (const s of f.syntax) {
      add({ rule: "syntax", category: "Syntax", severity: "error", file: f.path, line: s.line, title: "Syntax error", message: s.message, fix: s.fix });
    }
  }

  const all: { u: VUnit; f: VFileModel }[] = files.flatMap((f) => f.units.map((u) => ({ u, f })));
  const packages = new Map<string, VPackage>();
  for (const f of files) for (const p of f.packages) packages.set(p.name, p);
  const unitByName = new Map<string, VUnit>();
  for (const { u } of all) {
    const prev = unitByName.get(u.name);
    if (prev) {
      add({
        rule: "duplicate-module",
        category: "Structure",
        severity: "warning",
        file: u.file,
        line: u.line,
        title: `Module ${u.name} is defined twice`,
        message: `It is also defined in ${prev.file}:${prev.line}. Simulators either stop with a "module already declared" error or keep whichever file comes last.`,
        fix: "Delete or rename one of them (often an old copy in a backup folder), and upload one design per .zip.",
      });
      continue;
    }
    unitByName.set(u.name, u);
  }
  const foreign = new Map(ctx.foreign.map((u) => [u.name.toLowerCase(), u]));

  // Files: includes, packages, names, timescale, default_nettype
  const sources = files.filter((f) => !f.header && !cb.included.has(f.path));
  for (const f of files) {
    for (const inc of f.includes) {
      if (inc.path) continue;
      const lib = LIB_INCLUDE.test(inc.name);
      add({
        rule: "missing-include",
        category: "Structure",
        severity: lib ? "warning" : "error",
        file: f.path,
        line: inc.line,
        title: `Include file ${inc.name} is not in the upload`,
        message: lib
          ? `“${inc.name}” looks like a library header (UVM or similar) that your simulator provides, so the review can't see what it defines.`
          : `\`include "${inc.name}" can't be found, so this file won't compile and the macros and declarations it provides can't be checked.`,
        fix: lib ? "Nothing to do if your simulator provides it." : `Add ${inc.name} to the .zip (any folder is fine), then upload again.`,
      });
    }
    const imports = [...f.imports, ...f.units.flatMap((u) => u.imports)];
    const seen = new Set<string>();
    for (const imp of imports) {
      if (seen.has(imp.name) || packages.has(imp.name) || STD_PACKAGES.has(imp.name)) continue;
      seen.add(imp.name);
      add({
        rule: "missing-package",
        category: "Structure",
        severity: "error",
        file: f.path,
        line: imp.line,
        title: `Package ${imp.name} is not in the upload`,
        message: `This file imports ${imp.name}::, but none of the uploaded files declares “package ${imp.name}”. It won't compile, and the types and constants it provides can't be checked.`,
        fix: `Add the file that contains “package ${imp.name}; … endpackage” to your .zip, then upload again.`,
      });
    }
    if (!f.header && f.units.length === 1) {
      const base = f.path.split("/").pop()!.replace(/\.(v|sv)$/i, "");
      const u = f.units[0];
      if (u.name !== base && u.ports.length) {
        add({
          rule: "file-name",
          category: "Style",
          severity: "info",
          file: f.path,
          line: u.line,
          title: "File name differs from the module name",
          message: `The file is “${base}” but declares module “${u.name}”. Tools and people find modules by file name.`,
          fix: `Rename the file to ${u.name}${f.lang === "systemverilog" ? ".sv" : ".v"}, or rename the module.`,
        });
      }
    }
  }
  const withTs = sources.filter((f) => f.timescale !== null && f.units.length);
  const withoutTs = sources.filter((f) => f.timescale === null && f.units.length);
  if (withTs.length && withoutTs.length) {
    add({
      rule: "timescale-mixed",
      category: "Style",
      severity: "warning",
      file: withoutTs[0].path,
      line: withoutTs[0].units[0].line,
      title: `${withoutTs.length} file${withoutTs.length > 1 ? "s have" : " has"} no \`timescale while others do`,
      message: `${withoutTs
        .slice(0, 4)
        .map((f) => f.path.split("/").pop())
        .join(", ")}${withoutTs.length > 4 ? "…" : ""} inherit${withoutTs.length > 1 ? "" : "s"} whatever time unit the file compiled before ${withoutTs.length > 1 ? "them" : "it"} set, so #delays mean different things depending on the compile order. Verilator stops with a TIMESCALEMOD error.`,
      fix: "Put the same `timescale line at the top of every file.",
      fixCode: "`timescale 1ns / 1ps",
    });
  }
  const designFiles = sources.filter((f) => f.units.some((u) => u.ports.length));
  if (designFiles.length && !files.some((f) => f.nettypeNone)) {
    const first = designFiles[0];
    add({
      rule: "default-nettype",
      category: "Style",
      severity: "info",
      file: first.path,
      line: 1,
      title: "Misspelled names silently become 1-bit wires",
      message: "No file sets `default_nettype none, so any undeclared name in a port connection or assign creates an implicit 1-bit net instead of an error. A typo in a 32-bit bus then quietly truncates it.",
      fix: "Start every file with `default_nettype none (and end it with `default_nettype wire so third-party code is unaffected).",
      fixCode: "`default_nettype none\n// … module …\n`default_nettype wire",
    });
  }

  let alwaysBlocks = 0;
  let instanceCount = 0;
  const deps = new Map<string, Set<string>>();
  for (const f of files) {
    const d = new Set<string>();
    for (const imp of [...f.imports, ...f.units.flatMap((u) => u.imports)]) {
      const pf = packages.get(imp.name)?.file;
      if (pf && pf !== f.path) d.add(pf);
    }
    deps.set(f.path, d);
  }

  for (const { u, f } of all) {
    if (unitByName.get(u.name) !== u) continue;
    alwaysBlocks += u.procs.filter((p) => p.kind.startsWith("always")).length;
    instanceCount += u.instances.length;
    reviewUnit(u, f);
  }

  function reviewUnit(u: VUnit, f: VFileModel) {
    const sv = f.lang === "systemverilog";
    const tb = u.kind === "module" && u.ports.length === 0;
    const where = (p: VProc) => `the ${p.kind} block at line ${p.line}`;
    const portsBy = new Map(u.ports.map((p) => [p.name, p]));
    const scopes: VPackage[] = [f.unitScope, ...[...f.imports, ...u.imports].map((i) => packages.get(i.name)).filter((p): p is VPackage => !!p)];
    const unknownScope = f.unknownMacros || [...f.imports, ...u.imports].some((i) => !packages.has(i.name)) || f.includes.some((i) => !i.path);
    const instLabels = new Set(u.instances.map((i) => i.label));

    // Parameters: package constants, then the unit's own (later ones may use earlier ones).
    const env = new Map<string, number>();
    for (const s of scopes) {
      for (const d of s.decls.values()) {
        if (d.kind === "param" && d.init) {
          const v = evalV(d.init, env);
          if (v !== null) env.set(d.name, v);
        }
      }
    }
    for (const d of u.params) {
      if (!d.init) continue;
      const v = evalV(d.init, env);
      if (v !== null) env.set(d.name, v);
    }
    const typeOf = (name: string): VType | undefined => u.types.get(name) ?? scopes.find((s) => s.types.has(name))?.types.get(name);
    const widthOf = (x: { type: string | null; dims: VToken[][] } | undefined, e = env, depth = 0): number | null => {
      if (!x || depth > 8) return null;
      let inner: number | null = 1;
      const ty = x.type;
      if (ty && !["logic", "reg", "wire", "bit"].includes(ty)) {
        if (WIDTH_OF_TYPE[ty]) inner = WIDTH_OF_TYPE[ty];
        else {
          const def = typeOf(ty);
          if (!def) return null;
          inner = def.width ?? widthOf({ type: def.base, dims: def.dims }, e, depth + 1);
        }
      }
      if (inner === null) return null;
      if (!x.dims.length) return inner;
      const w = dimsWidth(x.dims, e);
      return w === null ? null : w * inner;
    };
    const declOf = (n: string) => u.decls.get(n);
    const sigWidth = (n: string): number | null => {
      const d = declOf(n);
      if (d) return d.unpacked || d.kind === "param" || d.kind === "genvar" ? null : widthOf(d);
      const p = portsBy.get(n);
      return p && p.dir !== "interface" ? widthOf(p) : null;
    };
    const declared = (n: string) =>
      n.startsWith("`") ||
      portsBy.has(n) ||
      u.decls.has(n) ||
      u.functions.has(n) ||
      u.tasks.has(n) ||
      u.types.has(n) ||
      u.enumConsts.has(n) ||
      u.labels.has(n) ||
      instLabels.has(n) ||
      unitByName.has(n) ||
      scopes.some((s) => s.decls.has(n) || s.types.has(n) || s.enumConsts.has(n) || s.functions.has(n));
    /** Declared as a variable: a reg/logic/integer, an output reg or logic, or a user type. */
    const isVariable = (n: string) => {
      const d = declOf(n);
      if (d) return d.kind === "var";
      const p = portsBy.get(n);
      return !!p && p.variable;
    };
    const isNet = (n: string) => {
      const d = declOf(n);
      if (d) return d.kind === "net";
      const p = portsBy.get(n);
      return !!p && !p.variable && p.dir !== "interface";
    };
    const regLike = (n: string) => {
      const d = declOf(n);
      const type = d ? (d.kind === "var" ? d.type : null) : portsBy.get(n)?.variable ? portsBy.get(n)!.type : null;
      return type === "reg" || type === "integer" || type === "time" || type === "real" || type === "realtime";
    };

    /* ----- drivers and reads ----- */
    type Src = { kind: "always" | "initial" | "assign" | "instance" | "sub" | "loop"; where: string; line: number; whole: boolean; arms: Arm[]; id: number; blocking?: boolean };
    const drivers = new Map<string, Src[]>();
    const reads = new Set<string>(u.reads);
    let srcId = 0;
    const drive = (name: string, s: Src) => drivers.set(name, [...(drivers.get(name) ?? []), s]);
    const implicitNets = new Map<string, number>();

    const checkContTarget = (name: string, line: number, how: string) => {
      const p = portsBy.get(name);
      if (p && p.dir === "input") {
        add({
          rule: "assign-to-input",
          category: "Connectivity",
          severity: "error",
          file: f.path,
          line,
          title: `Input port ${name} is driven inside ${u.name}`,
          message: `${how} drives the input ${name}, fighting whatever the parent connects to it. Inputs can only be read inside the module.`,
          fix: `Drive an internal wire instead, or make ${name} an output in ${u.name}'s port list.`,
        });
        return;
      }
      if (!declared(name) && !unknownScope) {
        if (u.nettype === "none") {
          add({
            rule: "undeclared",
            category: "Connectivity",
            severity: "error",
            file: f.path,
            line,
            title: `${name} is not declared`,
            message: `\`default_nettype none is in effect, so ${how} can't create an implicit net for “${name}”. Compilers stop here.`,
            fix: `Declare it (wire [N-1:0] ${name};) or fix the spelling.`,
          });
        } else if (!implicitNets.has(name)) {
          implicitNets.set(name, line);
        }
        return;
      }
      if (!sv && regLike(name) && f.lang === "verilog") {
        add({
          rule: "continuous-to-reg",
          category: "Connectivity",
          severity: "error",
          file: f.path,
          line,
          title: `reg ${name} is driven like a wire`,
          message: `${how} drives ${name}, which is declared reg. In Verilog-2005 only nets (wire) can be driven by assign statements and instance outputs; Icarus, ModelSim and Vivado reject it.`,
          fix: `Declare ${name} as a wire, or move the logic into an always block if it should stay a reg.`,
          fixCode: `wire ${(declOf(name)?.dims ?? []).map((d) => `[${tokText(d)}] `).join("")}${name};`,
        });
      }
    };

    // Continuous assignments
    for (const a of u.assigns) {
      const id = ++srcId;
      a.reads.forEach((r) => reads.add(r));
      for (const tg of a.targets) {
        if (!a.netDecl) checkContTarget(tg.name, a.line, "This assign");
        drive(tg.name, { kind: "assign", where: a.netDecl ? `its declaration (line ${a.line})` : `the assign at line ${a.line}`, line: a.line, whole: tg.whole, arms: a.arms, id });
      }
      if (a.targets.length === 1 && a.targets[0].whole && !a.netDecl) checkWidth(a.targets[0].name, a.rhs, a.line, "assignment");
    }

    // Procedures
    const procWrites = new Map<VProc, Map<string, Write[]>>();
    const procReads = new Map<VProc, Set<string>>();
    for (const p of u.procs) {
      const id = ++srcId;
      const w = writesIn(p.body, new Map());
      procWrites.set(p, w);
      const r = collectReads(p.body, new Set());
      if (Array.isArray(p.events)) p.events.forEach((e) => r.add(e.name));
      for (const l of p.locals) r.delete(l);
      procReads.set(p, r);
      r.forEach((x) => reads.add(x));
      for (const [name, list] of w) {
        if (p.locals.has(name)) continue;
        drive(name, {
          kind: loopOnly(list) ? "loop" : p.kind === "initial" || p.kind === "final" ? "initial" : "always",
          where: where(p),
          line: list[0].line,
          whole: list.some((x) => x.whole),
          arms: p.arms,
          id,
          blocking: list.some((x) => x.blocking),
        });
      }
      // $readmemb/$readmemh fill memories
      for (const c of collectCalls(p.body)) {
        if (c.sys && /^\$readmem[bh]$/.test(c.name)) {
          const ids = readsIn(c.args);
          if (ids[0]) u.memLoads.add(ids[0]);
        }
      }
    }
    for (const n of u.subroutineWrites) drive(n, { kind: "sub", where: "a function or task", line: u.line, whole: true, arms: [], id: ++srcId });
    for (const n of u.macroArgs) {
      reads.add(n);
      drive(n, { kind: "sub", where: "a macro", line: u.line, whole: true, arms: [], id: ++srcId });
    }

    // Instances
    for (const inst of u.instances) {
      const id = ++srcId;
      if (inst.primitive) {
        const terms = inst.ports.map((c) => c.actualName);
        const outs = /^(buf|not)$/.test(inst.target) ? terms.slice(0, -1) : /^(pullup|pulldown)$/.test(inst.target) ? terms : terms.slice(0, 1);
        for (const n of outs) if (n) drive(n, { kind: "instance", where: `${inst.target} ${inst.label}`, line: inst.line, whole: true, arms: inst.arms, id });
        for (const c of inst.ports) readsIn(c.actual).forEach((r) => reads.add(r));
        continue;
      }
      const target = unitByName.get(inst.target);
      const vhdl = target ? undefined : foreign.get(inst.target.toLowerCase());
      for (const c of inst.params) readsIn(c.actual).forEach((r) => reads.add(r));
      if (!target && !vhdl) {
        // Port directions are unknown: every connected name may be read or driven.
        for (const c of inst.ports) {
          readsIn(c.actual).forEach((r) => reads.add(r));
          if (c.actualName) drive(c.actualName, { kind: "sub", where: `${inst.label} (${inst.target})`, line: c.line, whole: c.actualWhole, arms: inst.arms, id });
        }
        const vendor = VENDOR.test(inst.target);
        add({
          rule: "unknown-unit",
          category: "Structure",
          severity: vendor ? "warning" : "error",
          file: f.path,
          line: inst.line,
          title: `Instance ${inst.label} uses ${inst.target}, which isn't defined`,
          message: vendor
            ? `There is no module named “${inst.target}” in the upload. The name looks like a vendor or cell-library primitive, which the review can't see.`
            : `There is no module named “${inst.target}” in the codebase, so elaboration stops with "unknown module type".`,
          fix: vendor
            ? `If ${inst.target} comes from your FPGA vendor or cell library, ignore this. Otherwise add the file that defines it to the .zip.`
            : `Add the file that defines module ${inst.target} to the upload, or fix the name.`,
        });
        continue;
      }
      const ports: { name: string; mode: PortMode; hasDefault: boolean; port?: VPort }[] = target
        ? target.ports.map((p) => ({ name: p.name, mode: MODE[p.dir], hasDefault: p.hasDefault, port: p }))
        : vhdl!.ports.map((p) => ({ name: p.name, mode: p.mode, hasDefault: false }));
      const byName = new Map(ports.map((p) => [target ? p.name : p.name.toLowerCase(), p]));
      const find = (n: string) => byName.get(target ? n : n.toLowerCase());
      // Parameter overrides
      const tenv = new Map<string, number>();
      if (target) {
        const overrides = new Map<string, number>();
        inst.params.forEach((c, i) => {
          const name = c.formal ?? target.params[i]?.name;
          if (c.formal && !target.params.some((p) => p.name === c.formal)) {
            add({
              rule: "unknown-formal",
              category: "Connectivity",
              severity: "error",
              file: f.path,
              line: c.line,
              title: `${target.name} has no parameter named ${c.formal}`,
              message: `Instance ${inst.label} overrides “${c.formal}”, which isn't a parameter of ${target.name}.`,
              fix: `Fix the name. ${target.name}'s parameters are: ${target.params.map((p) => p.name).join(", ") || "none"}.`,
            });
            return;
          }
          const v = evalV(c.actual, env);
          if (name && v !== null) overrides.set(name, v);
        });
        for (const s of scopes) for (const [k, v] of s.decls) if (v.kind === "param" && env.has(k)) tenv.set(k, env.get(k)!);
        for (const d of target.params) {
          const o = overrides.get(d.name);
          const v = o ?? (d.init ? evalV(d.init, tenv) : null);
          if (v !== null && v !== undefined) tenv.set(d.name, v);
        }
      }
      const seen = new Set<string>();
      const connect = (formal: string, actual: VToken[], actualName: string | null, actualWhole: boolean, line: number) => {
        const p = find(formal);
        if (!p) {
          add({
            rule: "unknown-formal",
            category: "Connectivity",
            severity: "error",
            file: f.path,
            line,
            title: `${inst.target} has no port named ${formal}`,
            message: `Instance ${inst.label} connects “${formal}”, which isn't in ${inst.target}'s port list.`,
            fix: `Fix the name, or add the port to ${inst.target}. Its ports are: ${ports.map((x) => x.name).join(", ")}.`,
          });
          return;
        }
        seen.add(p.name);
        if (!actual.length) return;
        const ids = readsIn(actual);
        if (p.mode === "in" || p.mode === "inout") ids.forEach((r) => reads.add(r));
        if ((p.mode === "out" || p.mode === "inout") && actualName) {
          drive(actualName, { kind: "instance", where: `${inst.label}.${p.name}`, line, whole: actualWhole, arms: inst.arms, id });
          if (p.mode === "out") checkContTarget(actualName, line, `Output ${p.name} of ${inst.label}`);
        } else if (actualName && !declared(actualName) && !unknownScope) {
          if (u.nettype === "none") {
            add({
              rule: "undeclared",
              category: "Connectivity",
              severity: "error",
              file: f.path,
              line,
              title: `${actualName} is not declared`,
              message: `\`default_nettype none is in effect, so connecting “${actualName}” to ${inst.label}.${p.name} without declaring it is an error.`,
              fix: `Declare it (wire [N-1:0] ${actualName};) or fix the spelling.`,
            });
          } else if (!implicitNets.has(actualName)) implicitNets.set(actualName, line);
        }
        if (actualName && actualWhole && p.port) {
          const fw = widthOf(p.port, tenv);
          const aw = sigWidth(actualName);
          if (fw !== null && aw !== null && fw !== aw) {
            add({
              rule: "width-mismatch",
              category: "Connectivity",
              severity: "warning",
              file: f.path,
              line,
              title: `Width mismatch on ${inst.label}.${p.name}`,
              message: `Port ${p.name} of ${inst.target} is ${fw} bit${fw > 1 ? "s" : ""} but ${actualName} is ${aw}. Verilog silently ${fw > aw ? "pads the missing bits with zeros (or leaves them floating)" : "drops the extra bits"}.`,
              fix: `Connect a ${fw}-bit signal, take a slice (${actualName}[${fw - 1}:0]), or set ${inst.target}'s width parameter.`,
            });
          }
        }
      };
      inst.ports.forEach((c, i) => {
        if (c.formal) return connect(c.formal, c.actual, c.actualName, c.actualWhole, c.line);
        const p = ports[i];
        if (!p) {
          add({
            rule: "port-map-count",
            category: "Connectivity",
            severity: "error",
            file: f.path,
            line: c.line,
            title: `Too many ports in ${inst.label}`,
            message: `${inst.target} has ${ports.length} ports but the instance lists ${inst.ports.length}.`,
            fix: "Connect ports by name (.port(signal)) so the order can't drift.",
          });
          return;
        }
        connect(p.name, c.actual, c.actualName, c.actualWhole, c.line);
      });
      if (inst.wildcard) {
        for (const p of ports) {
          if (seen.has(p.name)) continue;
          seen.add(p.name);
          if (p.mode === "in" || p.mode === "inout") reads.add(p.name);
          if (p.mode === "out" || p.mode === "inout") drive(p.name, { kind: "instance", where: `${inst.label}.${p.name} (.*)`, line: inst.line, whole: true, arms: inst.arms, id });
        }
      }
      for (const p of ports) {
        if (seen.has(p.name)) continue;
        if (p.mode === "in" && !p.hasDefault) {
          add({
            rule: "input-unconnected",
            category: "Connectivity",
            severity: "warning",
            file: f.path,
            line: inst.line,
            title: `Input ${p.name} of ${inst.label} is not connected`,
            message: `${inst.target}.${p.name} floats at 'z', and everything it feeds turns to 'x' in simulation.`,
            fix: `Connect it: .${p.name}(signal), or tie it off on purpose: .${p.name}(1'b0).`,
          });
        } else if (p.mode === "out") {
          add({
            rule: "output-unconnected",
            category: "Connectivity",
            severity: "info",
            file: f.path,
            line: inst.line,
            title: `Output ${p.name} of ${inst.label} is left unconnected`,
            message: "Unused outputs are fine, but leaving them out of the list hides whether that was intended.",
            fix: `List it explicitly as unconnected: .${p.name}()`,
          });
        }
      }
    }

    if (implicitNets.size) {
      const list = [...implicitNets.entries()];
      add({
        rule: "implicit-net",
        category: "Connectivity",
        severity: "warning",
        file: f.path,
        line: list[0][1],
        title: `${list.length} undeclared name${list.length > 1 ? "s become" : " becomes"} an implicit 1-bit wire`,
        message: `${list
          .slice(0, 6)
          .map(([n]) => n)
          .join(", ")}${list.length > 6 ? "…" : ""} ${list.length > 1 ? "are" : "is"} used in ${u.name} without a declaration, so Verilog creates a 1-bit wire. A misspelled bus is then silently cut to one bit.`,
        fix: "Declare each one with its real width, and add `default_nettype none so this becomes a compile error.",
        fixCode: list
          .slice(0, 4)
          .map(([n]) => `wire [31:0] ${n};  // use the real width`)
          .join("\n"),
      });
    }

    function checkWidth(target: string, rhs: VToken[], line: number, what: string) {
      const tw = sigWidth(target);
      if (tw === null) return;
      let rw: number | null = null;
      let rname = "";
      if (rhs.length === 1 && rhs[0].k === "id") {
        rw = sigWidth(rhs[0].v);
        rname = rhs[0].v;
      } else if (rhs.length === 1 && rhs[0].k === "num" && !/[xXzZ?]/.test(rhs[0].v.replace(/^\d*'[sS]?[bBoOdDhH]/, ""))) {
        rw = literalBits(rhs[0].v);
        rname = rhs[0].v;
      }
      // Zero-extension (a narrower value into a wider target) is how Verilog is usually written; truncation loses data.
      if (rw === null || rw <= tw) return;
      add({
        rule: "width-mismatch",
        category: "Connectivity",
        severity: "warning",
        file: f.path,
        line,
        title: `Width mismatch in ${what}`,
        message: `${target} is ${tw} bit${tw > 1 ? "s" : ""} wide but ${rname} is ${rw}. Verilog silently drops the upper ${rw - tw} bit${rw - tw > 1 ? "s" : ""}.`,
        fix: `If the truncation is intended, say so: ${target} = ${rname}[${tw - 1}:0]; otherwise widen ${target}.`,
      });
    }

    /* ----- procedures ----- */
    const blockingTargets = new Map<string, { line: number; arms: Arm[] }[]>();
    const nonblockingTargets = new Map<string, { line: number; arms: Arm[] }[]>();
    let casex = 0;
    let casexLine = 0;
    const delayLines: number[] = [...u.delayLines];
    const inits: { name: string; line: number }[] = [];
    for (const d of u.decls.values()) if (d.kind === "var" && d.init) inits.push({ name: d.name, line: d.line });

    for (const p of u.procs) {
      const w = procWrites.get(p)!;
      const seq = p.kind === "always_ff" || (Array.isArray(p.events) && p.events.some((e) => e.edge));
      const comb = !seq && (p.kind === "always_comb" || (p.kind === "always" && p.events !== null));
      for (const [name, list] of w) {
        if (p.locals.has(name)) continue;
        // initial blocks set starting values; only always blocks become logic
        if (p.kind.startsWith("always")) {
          for (const x of list) {
            if (x.loop) continue;
            const m = x.blocking ? blockingTargets : nonblockingTargets;
            m.set(name, [...(m.get(name) ?? []), { line: x.line, arms: p.arms }]);
          }
        }
        checkProcTarget(name, list[0].line, p);
      }
      // simple width checks
      const walk = (stmts: VStmt[]) => {
        for (const s of stmts) {
          if (s.k === "assign" && s.targets.length === 1 && s.targets[0].whole && !p.locals.has(s.targets[0].name)) checkWidth(s.targets[0].name, s.rhs, s.line, "assignment");
          else if (s.k === "if") s.branches.forEach((b) => walk(b.body));
          else if (s.k === "case") {
            if (s.kind === "casex") {
              casex++;
              casexLine ||= s.line;
            }
            s.items.forEach((i) => walk(i.body));
          } else if (s.k === "loop" || s.k === "timing") walk(s.body);
        }
      };
      walk(p.body);
      const timing = anyStmt(p.body, (s) => s.k === "timing" || (s.k === "assign" && s.delay));
      if (p.kind === "always" && p.events === null && !p.leadingDelay && !timing) {
        add({
          rule: "always-no-event",
          category: "Processes",
          severity: "error",
          file: f.path,
          line: p.line,
          title: "always block with no event control",
          message: `${where(p)[0].toUpperCase() + where(p).slice(1)} has no @(...) and no delay, so it runs again immediately, forever, at time 0. The simulation hangs.`,
          fix: "Add the events it depends on: always @(posedge clk) for registers, always @* (or always_comb) for logic.",
          fixCode: sv ? "always_comb begin\n  …\nend" : "always @* begin\n  …\nend",
        });
      }
      if (!tb && (p.leadingDelay || anyStmt(p.body, (s) => (s.k === "timing" && s.delay) || (s.k === "assign" && s.delay)))) {
        delayLines.push(p.line);
      }
      if (p.kind === "initial" && !tb) {
        const calls = collectCalls(p.body);
        if (!calls.some((c) => /^\$readmem[bh]$/.test(c.name))) for (const [name, list] of w) inits.push({ name, line: list[0].line });
      }
      if (seq) reviewClocked(p, w);
      else if (comb) reviewComb(p, w);
    }

    function checkProcTarget(name: string, line: number, p: VProc) {
      const port = portsBy.get(name);
      if (port && port.dir === "input") {
        add({
          rule: "assign-to-input",
          category: "Connectivity",
          severity: "error",
          file: f.path,
          line,
          title: `Input port ${name} is assigned`,
          message: `${where(p)[0].toUpperCase() + where(p).slice(1)} assigns the input ${name}. Inputs are nets and can only be read inside the module.`,
          fix: `Assign an internal variable instead, or make ${name} an output in ${u.name}'s port list.`,
        });
        return;
      }
      if (!declared(name)) {
        if (unknownScope) return;
        add({
          rule: "undeclared",
          category: "Connectivity",
          severity: "error",
          file: f.path,
          line,
          title: `${name} is not declared`,
          message: `${where(p)[0].toUpperCase() + where(p).slice(1)} assigns “${name}”, but nothing in ${u.name} declares it. Procedural code can't create implicit nets, so compilers stop here.`,
          fix: `Declare it (${sv ? "logic" : "reg"} [N-1:0] ${name};) or fix the spelling.`,
        });
        return;
      }
      if (isNet(name) && !isVariable(name)) {
        const isPort = portsBy.has(name);
        add({
          rule: "net-procedural-assign",
          category: "Connectivity",
          severity: "error",
          file: f.path,
          line,
          title: `${name} is a wire but is assigned in ${p.kind}`,
          message: `${where(p)[0].toUpperCase() + where(p).slice(1)} assigns ${name}, which is a net${isPort ? " (an output declared without reg/logic)" : " (wire)"}. Procedural code can only assign variables, so compilers reject this.`,
          fix: isPort ? `Declare the port as output ${sv ? "logic" : "reg"} ${name}, or drive it with an assign.` : `Declare it as ${sv ? "logic" : "reg"} instead of wire, or drive it with an assign.`,
          fixCode: `${isPort ? "output " : ""}${sv ? "logic" : "reg"} ${name};`,
        });
      }
    }

    /** Read anywhere other than procedure p: another block, an assign, an instance, or the port list. */
    function readOutside(name: string, p: VProc): boolean {
      for (const [q, r] of procReads) if (q !== p && r.has(name)) return true;
      return (
        u.assigns.some((a) => a.reads.includes(name)) ||
        u.reads.includes(name) ||
        u.macroArgs.has(name) ||
        u.instances.some((i) => i.wildcard || i.ports.some((c) => readsIn(c.actual).includes(name))) ||
        portsBy.get(name)?.dir === "output"
      );
    }

    function reviewClocked(p: VProc, w: Map<string, Write[]>) {
      // Blocking assignments to state that other blocks read race with them in simulation.
      const outside = (name: string) => readOutside(name, p);
      const racy = [...w.entries()].filter(([n, l]) => !p.locals.has(n) && l.some((x) => x.blocking && !x.loop) && outside(n));
      if (racy.length) {
        add({
          rule: "ff-blocking",
          category: "Processes",
          severity: "warning",
          file: f.path,
          line: racy[0][1].find((x) => x.blocking && !x.loop)!.line,
          title: `Blocking assignment${racy.length > 1 ? "s" : ""} in a clocked block`,
          message: `${where(p)[0].toUpperCase() + where(p).slice(1)} updates ${racy.map(([n]) => n).slice(0, 4).join(", ")} with “=”. Other blocks that read ${racy.length > 1 ? "them" : "it"} on the same clock edge may see the old or the new value depending on simulator scheduling, and the hardware won't match.`,
          fix: "Use non-blocking assignments (<=) for every register in a clocked block.",
          fixCode: `${racy[0][0]} <= …;`,
        });
      }
      // Reset branch: polarity against the event list, and for the design-wide check.
      const first = p.body.find((s) => s.k === "if");
      if (first && first.k === "if") {
        const r = resetCond(first.branches[0].cond);
        if (r) {
          ctx.resetUses.push({ ...r, file: f.path, line: first.line });
          const ev = Array.isArray(p.events) ? p.events.find((e) => e.name === r.name && e.edge) : undefined;
          if (ev && ((ev.edge === "negedge" && r.level === "1") || (ev.edge === "posedge" && r.level === "0"))) {
            add({
              rule: "reset-edge-mismatch",
              category: "Processes",
              severity: "warning",
              file: f.path,
              line: first.line,
              title: `Reset ${r.name} is triggered on ${ev.edge} but tested as active-${r.level === "1" ? "high" : "low"}`,
              message: `The block wakes when ${r.name} ${ev.edge === "negedge" ? "falls" : "rises"}, but the first if treats it as asserted when it is ${r.level}. On the reset edge the clocked branch runs instead of the reset, and synthesis reports an ambiguous clock.`,
              fix: ev.edge === "negedge" ? `For an active-low reset test if (!${r.name}).` : `For an active-high reset test if (${r.name}).`,
              fixCode: ev.edge === "negedge" ? `always @(posedge clk or negedge ${r.name})\n  if (!${r.name}) …` : `always @(posedge clk or posedge ${r.name})\n  if (${r.name}) …`,
            });
          }
        }
      }
    }

    /** A case whose constant labels cover every value of its selector needs no default. */
    function fullCase(s: Extract<VStmt, { k: "case" }>): boolean {
      const sel = s.selector;
      let width: number | null = null;
      if (sel.length === 1 && sel[0].k === "id") width = sigWidth(sel[0].v);
      else if (sel.length >= 4 && sel[0].k === "id" && sel[1].v === "[" && sel[sel.length - 1].v === "]") width = dimWidth(sel.slice(2, -1), env) ?? null;
      if (width === null || width > 12) return false;
      const values = new Set<number>();
      for (const item of s.items) {
        let depth = 0;
        let start = 0;
        const labels: VToken[][] = [];
        item.labels.forEach((x, j) => {
          if (x.k === "op" && (x.v === "(" || x.v === "[" || x.v === "{")) depth++;
          else if (x.k === "op" && (x.v === ")" || x.v === "]" || x.v === "}")) depth--;
          else if (depth === 0 && x.k === "op" && x.v === ",") {
            labels.push(item.labels.slice(start, j));
            start = j + 1;
          }
        });
        labels.push(item.labels.slice(start));
        for (const l of labels) {
          const v = l.length === 1 ? (l[0].k === "num" ? numValue(l[0].v) : (env.get(l[0].v) ?? null)) : null;
          if (v === null) return false;
          values.add(v);
        }
      }
      return values.size >= 2 ** width;
    }

    function reviewComb(p: VProc, w: Map<string, Write[]>) {
      const nb = [...w.entries()].filter(([n, l]) => !p.locals.has(n) && l.some((x) => !x.blocking));
      if (nb.length) {
        add({
          rule: "comb-nonblocking",
          category: "Processes",
          severity: "warning",
          file: f.path,
          line: nb[0][1].find((x) => !x.blocking)!.line,
          title: `Non-blocking assignment${nb.length > 1 ? "s" : ""} in combinational logic`,
          message: `${where(p)[0].toUpperCase() + where(p).slice(1)} assigns ${nb.map(([n]) => n).slice(0, 4).join(", ")} with “<=”. A later read in the same block still sees the old value, so simulation can disagree with the synthesised logic.`,
          fix: "Use blocking assignments (=) in combinational blocks.",
          fixCode: `${nb[0][0]} = …;`,
        });
      }
      if (p.kind !== "always_latch") {
        const definite = definitely(p.body, fullCase);
        // A temporary used only inside this block never shows its held value, so it isn't a latch.
        const latches = [...w.entries()].filter(([n, l]) => !p.locals.has(n) && !definite.has(n) && !loopOnly(l) && l.some((x) => x.whole) && readOutside(n, p));
        if (latches.length) {
          add({
            rule: "latch",
            category: "Processes",
            severity: "warning",
            file: f.path,
            line: latches[0][1][0].line,
            title: `Possible latch on ${latches.map(([n]) => n).slice(0, 4).join(", ")}${latches.length > 4 ? "…" : ""}`,
            message: `In ${where(p)}, some paths through the if/case statements don't assign ${latches.length > 1 ? "these" : "this"}, so ${latches.length > 1 ? "they keep" : "it keeps"} the old value and synthesis infers a latch.`,
            fix: "Assign a default at the top of the block, or cover every path (add the missing else, or a default: to the case).",
            fixCode: latches
              .slice(0, 4)
              .map(([n]) => `${n} = ${sv ? "'0" : "0"};  // default`)
              .join("\n"),
          });
        }
      }
      if (Array.isArray(p.events)) {
        const listed = new Set(p.events.map((e) => e.name));
        const r = procReads.get(p)!;
        const missing = [...r].filter((n) => !listed.has(n) && !w.has(n) && (isNet(n) || isVariable(n)) && !p.locals.has(n));
        if (missing.length) {
          add({
            rule: "sensitivity-incomplete",
            category: "Processes",
            severity: "warning",
            file: f.path,
            line: p.eventLine,
            title: `Sensitivity list is missing ${missing.length} signal${missing.length > 1 ? "s" : ""}`,
            message: `${where(p)[0].toUpperCase() + where(p).slice(1)} reads ${missing.join(", ")} but doesn't run again when ${missing.length > 1 ? "they change" : "it changes"}. Simulation then disagrees with the synthesised logic.`,
            fix: `Use ${sv ? "always_comb" : "always @*"} so the list can never go stale.`,
            fixCode: sv ? "always_comb begin" : "always @* begin",
          });
        }
      }
    }

    // generate if/else arms never exist together, so = in one and <= in the other is fine
    const mixed = [...blockingTargets.keys()].filter((n) => (nonblockingTargets.get(n) ?? []).some((nb) => blockingTargets.get(n)!.some((b) => !exclusive(b.arms, nb.arms))));
    if (mixed.length) {
      add({
        rule: "mixed-assign",
        category: "Processes",
        severity: "warning",
        file: f.path,
        line: blockingTargets.get(mixed[0])![0].line,
        title: `${mixed.slice(0, 4).join(", ")} ${mixed.length > 1 ? "are" : "is"} assigned with both = and <=`,
        message: "Mixing blocking and non-blocking assignments to one variable makes its value depend on simulator scheduling, and most synthesis tools refuse it.",
        fix: "Use <= for registers in clocked blocks and = for combinational logic, never both for the same variable.",
      });
    }
    if (casex) {
      add({
        rule: "casex",
        category: "Style",
        severity: "info",
        file: f.path,
        line: casexLine,
        title: `casex used ${casex > 1 ? `${casex} times` : "once"}`,
        message: "casex treats x and z in the selector as don't-care, so an uninitialised signal matches the first item and hides the bug in simulation.",
        fix: sv ? "Use case inside (with ? for don't-care bits) or casez." : "Use casez with ? for the don't-care bits.",
      });
    }
    if (!tb && delayLines.length) {
      add({
        rule: "delay-in-rtl",
        category: "Processes",
        severity: "warning",
        file: f.path,
        line: Math.min(...delayLines),
        title: "Delays in design code",
        message: `${u.name} uses #delays. Synthesis ignores them, so the hardware behaves differently from the simulation (and races hide behind the delays).`,
        fix: "Keep #delays in testbenches. In design code, use clocked logic and counters.",
      });
    }

    /* ----- signals and ports ----- */
    const unused: { name: string; line: number }[] = [];
    const unread: { name: string; line: number }[] = [];
    for (const d of u.decls.values()) {
      if (d.kind !== "net" && d.kind !== "var") continue;
      const drv = drivers.get(d.name) ?? [];
      const isRead = reads.has(d.name);
      const driven = drv.length > 0 || d.init !== null || u.memLoads.has(d.name);
      if (!driven && isRead) {
        add({
          rule: "undriven",
          category: "Connectivity",
          severity: "warning",
          file: f.path,
          line: d.line,
          title: `${d.name} is read but never driven`,
          message: `It stays ${d.kind === "net" ? "'z'" : "'x'"} for the whole simulation, and synthesis ties it to a constant.`,
          fix: `Drive it in ${u.name} (an assign, an always block or an instance output), or make it a localparam.`,
        });
      } else if (!driven && !isRead) unused.push(d);
      else if (driven && !isRead) unread.push(d);
      if (tb || u.genLocals.has(d.name)) continue;
      const counted = drv.filter((x) => x.kind !== "initial" && x.kind !== "sub" && x.kind !== "loop" && x.whole);
      const distinct: Src[] = [];
      for (const x of counted) if (!distinct.some((y) => y.id === x.id)) distinct.push(x);
      const conflicts = distinct.filter((x) => distinct.some((y) => y !== x && !exclusive(x.arms, y.arms)));
      if (conflicts.length > 1 && drv.filter((x) => x.kind !== "initial" && x.kind !== "sub" && x.kind !== "loop").every((x) => x.whole)) {
        add({
          rule: "multiple-drivers",
          category: "Connectivity",
          severity: "error",
          file: f.path,
          line: conflicts[1].line,
          title: `${d.name} has ${conflicts.length} drivers`,
          message: `It is driven by ${conflicts.map((x) => x.where).join(" and ")}. In simulation the last writer wins (or a wire resolves to 'x'), and synthesis reports a multi-driven net.`,
          fix: "Drive it from one place: merge the logic into one always block, or select between the sources with a multiplexer.",
        });
      }
    }
    for (const p of u.ports) {
      if (p.dir === "interface") continue;
      const drv = drivers.get(p.name) ?? [];
      if ((p.dir === "input" || p.dir === "inout") && !reads.has(p.name) && !tb && !f.unknownMacros) {
        const isReset = RESET_NAME.test(p.name);
        add({
          rule: "unused-input",
          category: "Connectivity",
          severity: "warning",
          file: f.path,
          line: p.line,
          title: `Input ${p.name} of ${u.name} is never used`,
          message: `Nothing in ${u.name} reads it, so whatever is connected has no effect${isReset ? " — this module ignores reset" : ""}.`,
          fix: isReset ? `Use it in the clocked block, e.g. if (!${p.name}) <reset values> else …` : "Use it, or remove the port (and its connections).",
        });
      }
      if (p.dir === "output" && !drv.length && !u.memLoads.has(p.name)) {
        add({
          rule: "undriven-output",
          category: "Connectivity",
          severity: "warning",
          file: f.path,
          line: p.line,
          title: `Output ${p.name} of ${u.name} is never driven`,
          message: `It reads ${p.variable ? "'x'" : "'z'"} wherever it is used.`,
          fix: `Drive ${p.name} in ${u.name}, or remove the port.`,
        });
      }
    }
    if (inits.length && !tb) {
      const names = [...new Map(inits.map((x) => [x.name, x])).values()];
      add({
        rule: "signal-init",
        category: "Style",
        severity: "info",
        file: f.path,
        line: names[0].line,
        title: `${names.length} signal${names.length > 1 ? "s get" : " gets"} an initial value`,
        message: `${names
          .slice(0, 6)
          .map((d) => d.name)
          .join(", ")}${names.length > 6 ? "…" : ""}. FPGA tools load initial values at configuration, but ASIC flows ignore them, so the design may only work thanks to them.`,
        fix: "Set these values in the reset branch instead. Memory contents loaded with $readmemb/$readmemh are fine.",
      });
    }
    const list = (ds: { name: string }[]) => ds.slice(0, 8).map((d) => d.name).join(", ") + (ds.length > 8 ? ` and ${ds.length - 8} more` : "");
    // A macro nobody defines may read anything: "never used" can't be trusted then.
    if (f.unknownMacros) unused.length = unread.length = 0;
    if (unused.length) {
      add({
        rule: "unused-signal",
        category: "Style",
        severity: "info",
        file: f.path,
        line: unused[0].line,
        title: `${unused.length} signal${unused.length > 1 ? "s are" : " is"} never used`,
        message: `${list(unused)} ${unused.length > 1 ? "are" : "is"} declared but neither driven nor read.`,
        fix: "Remove the declarations.",
      });
    }
    if (unread.length) {
      add({
        rule: "unread-signal",
        category: "Style",
        severity: "info",
        file: f.path,
        line: unread[0].line,
        title: `${unread.length} signal${unread.length > 1 ? "s are" : " is"} driven but never read`,
        message: `${list(unread)}. The logic driving ${unread.length > 1 ? "them" : "it"} has no effect and is optimised away. Debug taps for the waveform viewer are fine to keep.`,
        fix: "Remove them, or connect them to what was meant to use them. Check especially control outputs like stall or enable signals.",
      });
    }
    // reads of undeclared names in procedural code and assigns
    if (!unknownScope) {
      const undeclared = new Map<string, number>();
      const note = (n: string, line: number) => {
        if (!declared(n) && !isVKeyword(n) && !PRIMITIVES.has(n) && !undeclared.has(n)) undeclared.set(n, line);
      };
      for (const a of u.assigns) for (const r of a.reads) note(r, a.line);
      for (const p of u.procs) for (const r of procReads.get(p)!) if (!procWrites.get(p)!.has(r)) note(r, p.line);
      for (const [n, line] of undeclared) {
        if (implicitNets.has(n)) continue;
        add({
          rule: "undeclared",
          category: "Connectivity",
          severity: "error",
          file: f.path,
          line,
          title: `${n} is not declared`,
          message: `${u.name} reads “${n}”, but no port, signal, parameter or imported package declares it. Compilers stop with "unable to bind" or "unknown identifier".`,
          fix: `Declare it, import the package that defines it, or fix the spelling.`,
        });
      }
    }
  }

  return {
    units: cb.units,
    deps,
    notCompiled,
    modules: all.filter(({ u }) => unitByName.get(u.name) === u).length,
    alwaysBlocks,
    instances: instanceCount,
  };
}

export type { VDecl };

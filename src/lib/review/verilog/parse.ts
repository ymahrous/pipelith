/**
 * Tolerant structural parser for Verilog and SystemVerilog: design units
 * (modules, interfaces, packages), ports, declarations, continuous
 * assignments, procedural blocks as statement trees, generate regions and
 * instances. Like the VHDL parser it never evaluates or runs anything.
 */
import type { SyntaxIssue } from "../parse";
import { isVKeyword, preprocess, PRIMITIVES, type IncludeRef, type PreprocessHost, type VToken } from "./lexer";

/* ---------- model ---------- */

export type VPortDir = "input" | "output" | "inout" | "ref" | "interface";

export interface VPort {
  name: string;
  dir: VPortDir;
  /** Declared as a variable (output reg/logic, integer, user type …) rather than a net. */
  variable: boolean;
  /** Data type keyword or user type name (logic, reg, int, state_t …); null for a plain net. */
  type: string | null;
  /** Packed dimensions, each as the tokens between [ and ]. */
  dims: VToken[][];
  hasDefault: boolean;
  line: number;
}

export interface VDecl {
  name: string;
  kind: "net" | "var" | "param" | "genvar" | "event";
  type: string | null;
  dims: VToken[][];
  /** Has unpacked dimensions: a memory or array. */
  unpacked: boolean;
  init: VToken[] | null;
  line: number;
}

export interface VType {
  base: string | null;
  dims: VToken[][];
  /** Width when it can be worked out without parameters (enums, packed structs). */
  width: number | null;
}

/** Position inside generate if/case arms; drivers in different arms never conflict. */
export interface Arm {
  gen: number;
  arm: number;
}

export interface VTarget {
  name: string;
  whole: boolean;
  tokens: VToken[];
}

export type VStmt =
  | { k: "assign"; targets: VTarget[]; blocking: boolean; line: number; reads: string[]; rhs: VToken[]; delay: boolean }
  | { k: "if"; line: number; branches: { cond: VToken[]; body: VStmt[]; line: number }[]; hasElse: boolean }
  | { k: "case"; line: number; kind: string; unique: boolean; selector: VToken[]; items: { labels: VToken[]; body: VStmt[] }[]; hasDefault: boolean }
  | { k: "loop"; line: number; loopVars: string[]; reads: string[]; body: VStmt[] }
  | { k: "timing"; line: number; delay: boolean; reads: string[]; body: VStmt[] }
  | { k: "call"; line: number; name: string; sys: boolean; reads: string[]; args: VToken[] }
  | { k: "decl"; line: number; names: string[]; reads: string[] }
  | { k: "other"; line: number; reads: string[] };

export interface VEvent {
  edge: "posedge" | "negedge" | "edge" | null;
  name: string;
}

export interface VProc {
  kind: "always" | "always_ff" | "always_comb" | "always_latch" | "initial" | "final";
  line: number;
  /** null: no event control; "star": @* or always_comb/always_latch; otherwise the event list. */
  events: VEvent[] | "star" | null;
  eventLine: number;
  /** always #5 clk = ~clk; */
  leadingDelay: boolean;
  body: VStmt[];
  locals: Set<string>;
  arms: Arm[];
}

export interface VContAssign {
  targets: VTarget[];
  line: number;
  reads: string[];
  rhs: VToken[];
  delay: boolean;
  /** From a net declaration with an initialiser (wire x = …). */
  netDecl: boolean;
  arms: Arm[];
}

export interface VConn {
  formal: string | null;
  actual: VToken[];
  actualName: string | null;
  actualWhole: boolean;
  /** .name() or an empty positional slot. */
  empty: boolean;
  /** .name (SystemVerilog implicit connection). */
  implicit: boolean;
  line: number;
}

export interface VInstance {
  target: string;
  label: string;
  line: number;
  params: VConn[];
  ports: VConn[];
  /** .* connects every port to the signal of the same name. */
  wildcard: boolean;
  primitive: boolean;
  arms: Arm[];
}

export interface VUnit {
  kind: "module" | "interface" | "program";
  name: string;
  file: string;
  line: number;
  endLine: number;
  ansi: boolean;
  ports: VPort[];
  /** Header and body parameters, in declaration order (positional #(…) follows the header ones). */
  params: VDecl[];
  headerParams: number;
  decls: Map<string, VDecl>;
  assigns: VContAssign[];
  procs: VProc[];
  instances: VInstance[];
  functions: Set<string>;
  tasks: Set<string>;
  types: Map<string, VType>;
  enumConsts: Set<string>;
  /** Generate and named-block labels. */
  labels: Set<string>;
  imports: { name: string; line: number }[];
  /** Names read outside procedures and assignments: generate conditions, function bodies, assertions. */
  reads: string[];
  /** Variables written inside functions and tasks (driven, but not a separate driver). */
  subroutineWrites: Set<string>;
  /** Arrays filled by $readmemb/$readmemh. */
  memLoads: Set<string>;
  /** Names declared inside generate blocks: each block has its own copy. */
  genLocals: Set<string>;
  /** Names passed to macros nobody defines: maybe driven, maybe read. */
  macroArgs: Set<string>;
  /** `default_nettype in effect at the unit. */
  nettype: string;
  /** Lines of #delays inside procedural code and continuous assignments. */
  delayLines: number[];
}

export interface VPackage {
  name: string;
  file: string;
  line: number;
  decls: Map<string, VDecl>;
  types: Map<string, VType>;
  enumConsts: Set<string>;
  functions: Set<string>;
}

export interface VFileModel {
  path: string;
  lang: "verilog" | "systemverilog";
  /** .vh / .svh: read only through `include. */
  header: boolean;
  lines: string[];
  units: VUnit[];
  packages: VPackage[];
  includes: IncludeRef[];
  /** Declarations outside every unit ($unit scope): visible to all units of the file. */
  unitScope: VPackage;
  imports: { name: string; line: number }[];
  timescale: number | null;
  nettypeNone: boolean;
  /** Uses a macro no file defines. */
  unknownMacros: boolean;
  syntax: SyntaxIssue[];
  parsed: boolean;
}

/* ---------- helpers ---------- */

const isOp = (t: VToken | undefined, v: string) => !!t && t.k === "op" && t.v === v;
const isId = (t: VToken | undefined, v?: string) => !!t && t.k === "id" && (v === undefined || t.v === v);
const isName = (t: VToken | undefined) => !!t && t.k === "id" && !isVKeyword(t.v) && !t.v.startsWith("`");

const NET_TYPES = new Set(["wire", "tri", "tri0", "tri1", "wand", "wor", "triand", "trior", "trireg", "supply0", "supply1", "uwire", "interconnect"]);
const VAR_TYPES = new Set(["reg", "logic", "bit", "byte", "shortint", "int", "longint", "integer", "time", "real", "realtime", "shortreal", "string", "chandle", "event"]);
const TYPE_MODS = new Set(["signed", "unsigned", "var", "const", "static", "automatic", "rand", "randc", "vectored", "scalared"]);
const PROCS = new Set(["always", "always_ff", "always_comb", "always_latch", "initial", "final"]);
const ASSIGN_OPS = new Set(["=", "<=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", "<<<=", ">>>="]);

export const WIDTH_OF_TYPE: Record<string, number> = { byte: 8, shortint: 16, int: 32, integer: 32, longint: 64, time: 64 };

/** Index of the matching closer for an opener at i, using ( [ { depth. */
function matchBracket(t: VToken[], i: number, end = t.length): number {
  let d = 0;
  for (let j = i; j < end; j++) {
    const x = t[j];
    if (x.k !== "op") continue;
    if (x.v === "(" || x.v === "[" || x.v === "{" || x.v === "'{") d++;
    else if (x.v === ")" || x.v === "]" || x.v === "}") {
      d--;
      if (d === 0) return j;
    }
  }
  return end - 1;
}

/** Split [a, b) at top-level separators. */
function splitTop(t: VToken[], a: number, b: number, sep: string): [number, number][] {
  const out: [number, number][] = [];
  let d = 0;
  let s = a;
  for (let j = a; j < b; j++) {
    const x = t[j];
    if (x.k === "op") {
      if (x.v === "(" || x.v === "[" || x.v === "{" || x.v === "'{") d++;
      else if (x.v === ")" || x.v === "]" || x.v === "}") d--;
      else if (d === 0 && x.v === sep) {
        out.push([s, j]);
        s = j + 1;
      }
    }
  }
  if (s < b) out.push([s, b]);
  return out;
}

function findTop(t: VToken[], a: number, b: number, pred: (x: VToken) => boolean): number {
  let d = 0;
  for (let j = a; j < b; j++) {
    const x = t[j];
    if (x.k === "op") {
      if (x.v === "(" || x.v === "[" || x.v === "{" || x.v === "'{") {
        d++;
        continue;
      }
      if (x.v === ")" || x.v === "]" || x.v === "}") {
        d--;
        continue;
      }
    }
    if (d === 0 && pred(x)) return j;
  }
  return -1;
}

/** Identifiers read in a token range: no members after ".", no package scopes, no calls, no keywords. */
export function readsIn(t: VToken[], a = 0, b = t.length): string[] {
  const out: string[] = [];
  for (let j = a; j < b; j++) {
    const x = t[j];
    if (!isName(x)) continue;
    const prev = t[j - 1];
    const next = t[j + 1];
    if (isOp(prev, ".") || isOp(prev, "::") || isOp(next, "::") || isOp(prev, "'")) continue;
    if (isOp(next, "(") || isOp(next, "'")) continue; // function call or cast
    out.push(x.v);
  }
  return out;
}

function targetsOf(lhs: VToken[]): VTarget[] {
  if (isOp(lhs[0], "{") || isOp(lhs[0], "'{")) {
    const end = matchBracket(lhs, 0);
    return splitTop(lhs, 1, end, ",").flatMap(([s, e]) => targetsOf(lhs.slice(s, e)));
  }
  const base = lhs.find((x) => isName(x));
  if (!base) return [];
  return [{ name: base.v, whole: lhs.length === 1, tokens: lhs }];
}

/** Reads inside the index expressions of an assignment target (mem[addr] <= …). */
function targetReads(lhs: VToken[]): string[] {
  const base = lhs.findIndex((x) => isName(x));
  return base < 0 ? [] : readsIn(lhs, base + 1);
}

/* ---------- block structure ---------- */

const OPENERS: Record<string, string[]> = {
  module: ["endmodule"],
  macromodule: ["endmodule"],
  interface: ["endinterface"],
  program: ["endprogram"],
  package: ["endpackage"],
  class: ["endclass"],
  function: ["endfunction"],
  task: ["endtask"],
  begin: ["end"],
  fork: ["join", "join_any", "join_none"],
  case: ["endcase"],
  casex: ["endcase"],
  casez: ["endcase"],
  randcase: ["endcase"],
  generate: ["endgenerate"],
  specify: ["endspecify"],
  table: ["endtable"],
  primitive: ["endprimitive"],
  config: ["endconfig"],
  clocking: ["endclocking"],
  property: ["endproperty"],
  sequence: ["endsequence"],
  covergroup: ["endgroup"],
  checker: ["endchecker"],
};
const CLOSER_OF = new Map<string, string[]>();
for (const [open, closers] of Object.entries(OPENERS)) for (const c of closers) CLOSER_OF.set(c, [...(CLOSER_OF.get(c) ?? []), open]);
const ASSERTIONS = new Set(["assert", "assume", "cover", "expect", "restrict"]);

/** True when the keyword at i really opens a block (not a prototype, reference or assertion operand). */
function opens(t: VToken[], i: number): boolean {
  const v = t[i].v;
  const p1 = t[i - 1];
  const p2 = t[i - 2];
  const p3 = t[i - 3];
  switch (v) {
    case "function":
    case "task":
      if (isId(p1, "extern") || isId(p2, "extern") || (isId(p1, "virtual") && isId(p2, "pure"))) return false;
      if ([p1, p2, p3].some((p) => p?.k === "str")) return false; // import "DPI-C" function …
      return !isId(p1, "import") && !isId(p1, "export");
    case "fork":
      return !isId(p1, "disable") && !isId(p1, "wait");
    case "interface":
      return !isId(p1, "virtual") && !isId(t[i + 1], "class");
    case "class":
      return !isId(p1, "typedef");
    case "module":
    case "macromodule":
    case "program":
      return !isId(p1, "extern");
    case "property":
    case "sequence":
      return !(p1 && (ASSERTIONS.has(p1.v) || isOp(p1, "(") || isOp(p1, ",")));
    case "clocking": {
      // "default clocking cb;" refers to a block; "clocking cb @(posedge clk);" opens one.
      let j = i + 1;
      if (isName(t[j])) j++;
      return !isOp(t[j], ";");
    }
    case "covergroup":
      return !isId(p1, "typedef");
    default:
      return true;
  }
}

function blockPass(t: VToken[]) {
  const closeOf = new Int32Array(t.length).fill(-1);
  const stack: { kind: string; at: number }[] = [];
  const issues: SyntaxIssue[] = [];
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    if (x.k !== "id") continue;
    if (Object.prototype.hasOwnProperty.call(OPENERS, x.v)) {
      if (opens(t, i)) stack.push({ kind: x.v, at: i });
      continue;
    }
    const wants = CLOSER_OF.get(x.v);
    if (!wants) continue;
    const top = stack[stack.length - 1];
    if (top && wants.includes(top.kind)) {
      stack.pop();
      closeOf[top.at] = i;
      continue;
    }
    // Recover from a forgotten closer: if this one closes an outer block, close the inner ones first.
    let match = -1;
    for (let s = stack.length - 1; s >= 0; s--) {
      if (wants.includes(stack[s].kind)) {
        match = s;
        break;
      }
    }
    if (match < 0) {
      issues.push({
        line: x.line,
        message: `“${x.v}” has nothing to close.`,
        fix: `Remove it, or add the “${wants[0]}” it was meant to close above it.`,
      });
      continue;
    }
    while (stack.length - 1 > match) {
      const inner = stack.pop()!;
      closeOf[inner.at] = i;
      issues.push({
        line: t[inner.at].line,
        message: `The ${inner.kind} opened on line ${t[inner.at].line} is still open when “${x.v}” is reached on line ${x.line}.`,
        fix: `Add “${OPENERS[inner.kind][0]}” before line ${x.line}.`,
      });
    }
    const m = stack.pop()!;
    closeOf[m.at] = i;
  }
  for (const b of stack.reverse()) {
    issues.push({
      line: t[b.at].line,
      message: `This ${b.kind} is never closed.`,
      fix: `Add “${OPENERS[b.kind][0]}” where it should finish.`,
    });
  }
  return { closeOf, issues };
}

/* ---------- parser ---------- */

class Parser {
  gen = 0;
  /** Depth of generate blocks being parsed (their declarations are local copies). */
  inGenerate = 0;
  private declCount = 0;
  /** Declarations added since the last call belong to a generate block. */
  markLocals(u: VUnit) {
    const names = [...u.decls.keys()];
    for (const n of names.slice(this.declCount)) u.genLocals.add(n);
    this.declCount = names.length;
  }
  constructor(
    readonly t: VToken[],
    readonly closeOf: Int32Array,
  ) {}

  /** Skip to just after the top-level ";" (whole blocks are skipped as units). */
  toSemi(k: number, b: number): number {
    const t = this.t;
    let d = 0;
    for (let j = k; j < b; j++) {
      const x = t[j];
      if (x.k === "op") {
        if (x.v === "(" || x.v === "[" || x.v === "{" || x.v === "'{") d++;
        else if (x.v === ")" || x.v === "]" || x.v === "}") d--;
        else if (d <= 0 && x.v === ";") return j + 1;
      } else if (x.k === "id" && this.closeOf[j] > j) {
        j = this.closeOf[j];
      }
    }
    return b;
  }

  semiAt(k: number, b: number): number {
    return this.toSemi(k, b) - 1;
  }

  /** "begin : label" / "end : label" */
  skipLabel(k: number): number {
    return isOp(this.t[k], ":") && isName(this.t[k + 1]) ? k + 2 : k;
  }

  /* ----- declarations ----- */

  /** A data type at k: keywords, a user type (optionally pkg::), signing and packed dims. */
  dataType(k: number, b: number): { type: string | null; net: boolean; variable: boolean; dims: VToken[][]; next: number } {
    const t = this.t;
    let type: string | null = null;
    let net = false;
    let variable = false;
    for (;;) {
      const x = t[k];
      if (k >= b || !x) break;
      if (x.k === "id" && NET_TYPES.has(x.v)) {
        net = true;
        k++;
        // drive strength or delay: wire (strong0, weak1) w; wire #5 w;
        if (isOp(t[k], "(") && isId(t[k + 1]) && /^(strong|weak|pull|supply|highz|small|medium|large)/.test(t[k + 1].v)) k = matchBracket(t, k, b) + 1;
        continue;
      }
      if (x.k === "id" && (VAR_TYPES.has(x.v) || x.v === "var")) {
        variable = true;
        if (x.v !== "var") type = x.v;
        k++;
        continue;
      }
      if (x.k === "id" && TYPE_MODS.has(x.v)) {
        k++;
        continue;
      }
      if (isOp(x, "#")) {
        k += isOp(t[k + 1], "(") ? matchBracket(t, k + 1, b) - k + 1 : 2;
        continue;
      }
      // user type: T name, pkg::T name, T [..] name
      if (type === null && isName(x) && (isOp(t[k + 1], "::") || isName(t[k + 1]) || (isOp(t[k + 1], "[") && this.declAfterDims(k + 1, b)))) {
        if (isOp(t[k + 1], "::")) {
          type = t[k + 2]?.v ?? x.v;
          k += 3;
        } else {
          type = x.v;
          k++;
        }
        variable = true;
        continue;
      }
      break;
    }
    const dims: VToken[][] = [];
    while (isOp(t[k], "[")) {
      const e = matchBracket(t, k, b);
      dims.push(t.slice(k + 1, e));
      k = e + 1;
    }
    return { type, net, variable: variable && !net, dims, next: k };
  }

  /** T [a][b] name  (as opposed to an instance "T name [3:0] (…)"): after the dims comes a name. */
  declAfterDims(k: number, b: number): boolean {
    const t = this.t;
    while (isOp(t[k], "[")) k = matchBracket(t, k, b) + 1;
    return isName(t[k]);
  }

  /** Items "name [unpacked] [= init], …" up to the statement end. */
  declItems(a: number, semi: number): { name: string; unpacked: boolean; init: VToken[] | null; line: number }[] {
    const t = this.t;
    return splitTop(t, a, semi, ",")
      .map(([s, e]) => {
        if (!isName(t[s])) return null;
        let j = s + 1;
        let unpacked = false;
        while (isOp(t[j], "[")) {
          unpacked = true;
          j = matchBracket(t, j, e) + 1;
        }
        const init = isOp(t[j], "=") ? t.slice(j + 1, e) : null;
        return { name: t[s].v, unpacked, init, line: t[s].line };
      })
      .filter((x): x is { name: string; unpacked: boolean; init: VToken[] | null; line: number } => x !== null);
  }

  /** Net or variable declaration at module level. Returns the index after ";". */
  declaration(k: number, b: number, u: VUnit | VPackage, arms: Arm[]): number {
    const t = this.t;
    const semi = this.semiAt(k, b);
    const dt = this.dataType(k, semi);
    const kind: VDecl["kind"] = dt.net ? "net" : dt.type === "event" ? "event" : "var";
    for (const it of this.declItems(dt.next, semi)) {
      u.decls.set(it.name, { name: it.name, kind, type: dt.type, dims: dt.dims, unpacked: it.unpacked, init: it.init, line: it.line });
      if ("assigns" in u && it.init) {
        if (kind === "net") {
          u.assigns.push({
            targets: [{ name: it.name, whole: true, tokens: [t[k]] }],
            line: it.line,
            reads: readsIn(it.init),
            rhs: it.init,
            delay: false,
            netDecl: true,
            arms,
          });
        } else {
          u.reads.push(...readsIn(it.init));
        }
      }
    }
    return semi + 1;
  }

  /** parameter / localparam (module body, package or header list item). */
  paramItems(a: number, b: number): VDecl[] {
    const t = this.t;
    const out: VDecl[] = [];
    let k = a;
    while (isId(t[k], "parameter") || isId(t[k], "localparam") || isId(t[k], "specparam")) k++;
    if (isId(t[k], "type")) {
      // parameter type T = logic — a type, not a value
      return [];
    }
    const dt = this.dataType(k, b);
    for (const it of this.declItems(dt.next, b)) {
      out.push({ name: it.name, kind: "param", type: dt.type, dims: dt.dims, unpacked: it.unpacked, init: it.init, line: it.line });
    }
    if (!out.length) {
      // untyped header item "W = 8" handled by declItems; a bare name keeps no value
      const name = [...t.slice(k, b)].reverse().find((x) => isName(x));
      if (name) out.push({ name: name.v, kind: "param", type: null, dims: [], unpacked: false, init: null, line: name.line });
    }
    return out;
  }

  typedef(k: number, b: number, scope: { types: Map<string, VType>; enumConsts: Set<string> }): number {
    const t = this.t;
    const semi = this.semiAt(k, b);
    let j = k + 1;
    const nameTok = t[semi - 1];
    if (!isName(nameTok)) return semi + 1;
    if (isId(t[j], "enum")) {
      j++;
      const base = this.dataType(j, semi);
      j = base.next;
      if (isOp(t[j], "{")) {
        const end = matchBracket(t, j, semi);
        const items = splitTop(t, j + 1, end, ",");
        for (const [s] of items) if (isName(t[s])) scope.enumConsts.add(t[s].v);
        const width = base.dims.length ? null : base.type && WIDTH_OF_TYPE[base.type] ? WIDTH_OF_TYPE[base.type] : base.type ? null : 32;
        scope.types.set(nameTok.v, { base: base.type ?? "int", dims: base.dims, width });
      }
      return semi + 1;
    }
    if (isId(t[j], "struct") || isId(t[j], "union")) {
      const open = findTop(t, j, semi, (x) => isOp(x, "{"));
      scope.types.set(nameTok.v, { base: t[j].v, dims: [], width: null });
      if (open >= 0) j = matchBracket(t, open, semi) + 1;
      return semi + 1;
    }
    const dt = this.dataType(j, semi);
    scope.types.set(nameTok.v, { base: dt.type, dims: dt.dims, width: null });
    return semi + 1;
  }

  /* ----- procedural statements ----- */

  seq(a: number, b: number, locals: Set<string>): VStmt[] {
    const out: VStmt[] = [];
    let k = a;
    let guard = 0;
    while (k < b && guard++ < 200_000) {
      const r = this.stmt(k, b, locals);
      out.push(...r.stmts);
      k = r.next > k ? r.next : k + 1;
    }
    return out;
  }

  stmt(k: number, b: number, locals: Set<string>): { stmts: VStmt[]; next: number } {
    const t = this.t;
    let x = t[k];
    if (!x) return { stmts: [], next: b };
    // label: statement
    if (isName(x) && isOp(t[k + 1], ":") && !isOp(t[k + 2], ":")) {
      k += 2;
      x = t[k];
      if (!x) return { stmts: [], next: b };
    }
    const line = x.line;
    if (isOp(x, ";")) return { stmts: [], next: k + 1 };
    if (x.k === "id" && x.v.startsWith("`")) {
      // An unknown macro used as a statement: skip it and its arguments.
      let j = k + 1;
      let reads: string[] = [];
      if (isOp(t[j], "(")) {
        const c = matchBracket(t, j, b);
        reads = readsIn(t, j + 1, c);
        j = c + 1;
      }
      if (isOp(t[j], ";")) j++;
      return { stmts: [{ k: "other", line, reads }], next: j };
    }
    if (isOp(x, "(*full_case*)") || isId(x, "unique") || isId(x, "unique0") || isId(x, "priority")) {
      const r = this.stmt(k + 1, b, locals);
      for (const s of r.stmts) if (s.k === "case") s.unique = true;
      return r;
    }
    if (isId(x, "begin") || isId(x, "fork")) {
      const end = this.closeOf[k] > k ? this.closeOf[k] : b;
      let inner = this.skipLabel(k + 1);
      inner = Math.min(inner, end);
      return { stmts: this.seq(inner, end, locals), next: this.skipLabel(end + 1) };
    }
    if (isId(x, "if")) {
      const branches: { cond: VToken[]; body: VStmt[]; line: number }[] = [];
      let hasElse = false;
      let j = k;
      for (;;) {
        // at "if"
        const open = j + 1;
        if (!isOp(t[open], "(")) return { stmts: [], next: this.toSemi(k, b) };
        const close = matchBracket(t, open, b);
        const body = this.stmt(close + 1, b, locals);
        branches.push({ cond: t.slice(open + 1, close), body: body.stmts, line: t[open].line });
        j = body.next;
        if (isId(t[j], "else")) {
          if (isId(t[j + 1], "if")) {
            j = j + 1;
            continue;
          }
          const eb = this.stmt(j + 1, b, locals);
          branches.push({ cond: [], body: eb.stmts, line: t[j].line });
          hasElse = true;
          j = eb.next;
        }
        break;
      }
      return { stmts: [{ k: "if", line, branches, hasElse }], next: j };
    }
    if (isId(x, "case") || isId(x, "casex") || isId(x, "casez") || isId(x, "randcase")) {
      const end = this.closeOf[k] > k ? this.closeOf[k] : b;
      let j = k + 1;
      let selector: VToken[] = [];
      if (isOp(t[j], "(")) {
        const c = matchBracket(t, j, end);
        selector = t.slice(j + 1, c);
        j = c + 1;
      }
      if (isId(t[j], "inside") || isId(t[j], "matches")) j++;
      const items: { labels: VToken[]; body: VStmt[] }[] = [];
      let hasDefault = false;
      let guard = 0;
      while (j < end && guard++ < 100_000) {
        if (isOp(t[j], ";")) {
          j++;
          continue;
        }
        let labels: VToken[] = [];
        if (isId(t[j], "default")) {
          hasDefault = true;
          j++;
          if (isOp(t[j], ":")) j++;
        } else {
          const colon = findTop(t, j, end, (y) => isOp(y, ":"));
          if (colon < 0) break;
          labels = t.slice(j, colon);
          j = colon + 1;
        }
        const r = this.stmt(j, end, locals);
        items.push({ labels, body: r.stmts });
        j = r.next > j ? r.next : j + 1;
      }
      return { stmts: [{ k: "case", line, kind: x.v, unique: false, selector, items, hasDefault }], next: this.skipLabel(end + 1) };
    }
    if (isId(x, "for") || isId(x, "foreach") || isId(x, "while") || isId(x, "repeat")) {
      const open = k + 1;
      if (!isOp(t[open], "(")) return { stmts: [], next: this.toSemi(k, b) };
      const close = matchBracket(t, open, b);
      const loopVars: string[] = [];
      const head = t.slice(open + 1, close);
      if (x.v === "for") {
        const init = splitTop(t, open + 1, close, ";")[0];
        if (init) {
          for (const [s, e] of splitTop(t, init[0], init[1], ",")) {
            const eq = findTop(t, s, e, (y) => isOp(y, "="));
            const nameTok = eq > s ? t[eq - 1] : null;
            if (nameTok && isName(nameTok)) {
              loopVars.push(nameTok.v);
              if (eq - 1 > s) locals.add(nameTok.v); // declared in the loop: for (int i = 0; …)
            }
          }
        }
      } else if (x.v === "foreach") {
        const br = findTop(t, open + 1, close, (y) => isOp(y, "["));
        if (br >= 0) for (const id of readsIn(t, br, close)) loopVars.push(id);
        for (const v of loopVars) locals.add(v);
      }
      const body = this.stmt(close + 1, b, locals);
      const reads = readsIn(head).filter((r) => !loopVars.includes(r) || x.v === "while" || x.v === "repeat");
      return { stmts: [{ k: "loop", line, loopVars, reads, body: body.stmts }], next: body.next };
    }
    if (isId(x, "forever")) {
      const body = this.stmt(k + 1, b, locals);
      return { stmts: [{ k: "loop", line, loopVars: [], reads: [], body: body.stmts }], next: body.next };
    }
    if (isId(x, "do")) {
      const body = this.stmt(k + 1, b, locals);
      let j = body.next;
      let reads: string[] = [];
      if (isId(t[j], "while") && isOp(t[j + 1], "(")) {
        const c = matchBracket(t, j + 1, b);
        reads = readsIn(t, j + 2, c);
        j = c + 1;
      }
      if (isOp(t[j], ";")) j++;
      return { stmts: [{ k: "loop", line, loopVars: [], reads, body: body.stmts }], next: j };
    }
    if (isOp(x, "#") || isOp(x, "##")) {
      let j = k + 1;
      if (isOp(t[j], "(")) j = matchBracket(t, j, b) + 1;
      else j++;
      const body = this.stmt(j, b, locals);
      return { stmts: [{ k: "timing", line, delay: true, reads: [], body: body.stmts }], next: body.next };
    }
    if (isOp(x, "@") || isOp(x, "@@")) {
      let j = k + 1;
      let reads: string[] = [];
      if (isOp(t[j], "(")) {
        const c = matchBracket(t, j, b);
        reads = readsIn(t, j + 1, c);
        j = c + 1;
      } else j++;
      const body = this.stmt(j, b, locals);
      return { stmts: [{ k: "timing", line, delay: false, reads, body: body.stmts }], next: body.next };
    }
    if (isId(x, "wait")) {
      if (isId(t[k + 1], "fork")) return { stmts: [{ k: "timing", line, delay: false, reads: [], body: [] }], next: this.toSemi(k, b) };
      let j = k + 1;
      let reads: string[] = [];
      if (isOp(t[j], "(")) {
        const c = matchBracket(t, j, b);
        reads = readsIn(t, j + 1, c);
        j = c + 1;
      }
      const body = this.stmt(j, b, locals);
      return { stmts: [{ k: "timing", line, delay: false, reads, body: body.stmts }], next: body.next };
    }
    const semi = this.semiAt(k, b);
    const span = t.slice(k, semi);
    const next = semi + 1;
    if (x.k === "sys") {
      return { stmts: [{ k: "call", line, name: x.v, sys: true, reads: readsIn(span, 1), args: span.slice(1) }], next };
    }
    if (isId(x, "disable")) return { stmts: [{ k: "other", line, reads: [] }], next }; // a block label, not a signal
    if (x.k === "id" && ["return", "break", "continue", "force", "release", "deassign", "expect", "assert", "assume", "cover"].includes(x.v)) {
      return { stmts: [{ k: "other", line, reads: readsIn(span, 1) }], next };
    }
    if (isOp(x, "->") || isOp(x, "->>")) return { stmts: [{ k: "other", line, reads: [] }], next };
    // block-local declarations: integer i; logic [3:0] tmp = 0; my_t v;
    const DECL_START = VAR_TYPES.has(x.v) || TYPE_MODS.has(x.v) || NET_TYPES.has(x.v) || ["parameter", "localparam", "typedef", "input", "output", "inout", "ref"].includes(x.v);
    if (x.k === "id" && (DECL_START || (isName(x) && (isName(t[k + 1]) || isOp(t[k + 1], "::")) && !isOp(t[k + 2], "(")))) {
      if (x.v === "typedef") return { stmts: [], next };
      let j = k;
      while (["parameter", "localparam", "input", "output", "inout", "ref"].includes(t[j]?.v ?? "")) j++;
      const dt = this.dataType(j, semi);
      const items = this.declItems(dt.next, semi);
      if (items.length) {
        for (const it of items) locals.add(it.name);
        return { stmts: [{ k: "decl", line, names: items.map((i) => i.name), reads: items.flatMap((i) => (i.init ? readsIn(i.init) : [])) }], next };
      }
    }
    // procedural continuous assignment (assign/force inside a procedure)
    let a = 0;
    if (isId(x, "assign")) a = 1;
    // ++i / i++
    if (isOp(span[a], "++") || isOp(span[a], "--")) {
      return { stmts: [{ k: "assign", targets: targetsOf(span.slice(a + 1)), blocking: true, line, reads: readsIn(span, a + 1), rhs: [], delay: false }], next };
    }
    const opAt = findTop(span, a, span.length, (y) => y.k === "op" && (ASSIGN_OPS.has(y.v) || y.v === "++" || y.v === "--"));
    if (opAt > a) {
      const lhs = span.slice(a, opAt);
      const op = span[opAt].v;
      let rhs = span.slice(opAt + 1);
      let delay = false;
      if (isOp(rhs[0], "#")) {
        delay = true;
        rhs = rhs.slice(isOp(rhs[1], "(") ? matchBracket(rhs, 1) + 1 : 2);
      } else if (isOp(rhs[0], "@")) {
        rhs = rhs.slice(isOp(rhs[1], "(") ? matchBracket(rhs, 1) + 1 : 2);
      }
      const compound = op !== "=" && op !== "<=";
      return {
        stmts: [
          {
            k: "assign",
            targets: targetsOf(lhs),
            blocking: op !== "<=",
            line,
            reads: [...readsIn(rhs), ...targetReads(lhs), ...(compound ? readsIn(lhs) : [])],
            rhs,
            delay,
          },
        ],
        next,
      };
    }
    // task or function call: name(args); name;
    if (isName(x) && (isOp(t[k + 1], "(") || isOp(t[k + 1], ";"))) {
      return { stmts: [{ k: "call", line, name: x.v, sys: false, reads: readsIn(span, 1), args: span.slice(1) }], next };
    }
    return { stmts: [{ k: "other", line, reads: readsIn(span) }], next };
  }

  /* ----- module items ----- */

  newUnit(kind: VUnit["kind"], name: string, file: string, line: number, endLine: number, nettype: string): VUnit {
    return {
      kind,
      name,
      file,
      line,
      endLine,
      ansi: true,
      ports: [],
      params: [],
      headerParams: 0,
      decls: new Map(),
      assigns: [],
      procs: [],
      instances: [],
      functions: new Set(),
      tasks: new Set(),
      types: new Map(),
      enumConsts: new Set(),
      labels: new Set(),
      imports: [],
      reads: [],
      subroutineWrites: new Set(),
      memLoads: new Set(),
      genLocals: new Set(),
      macroArgs: new Set(),
      nettype,
      delayLines: [],
    };
  }

  /** Header: module [lifetime] name [import …;] [#(…)] [(…)] ; Returns the index after ";". */
  header(k: number, end: number, u: VUnit): number {
    const t = this.t;
    let j = k + 1;
    if (isId(t[j], "automatic") || isId(t[j], "static")) j++;
    j++; // name
    while (isId(t[j], "import")) {
      const s = this.semiAt(j, end);
      for (const imp of this.importNames(j, s)) u.imports.push(imp);
      j = s + 1;
    }
    if (isOp(t[j], "#") && isOp(t[j + 1], "(")) {
      const c = matchBracket(t, j + 1, end);
      for (const [s, e] of splitTop(t, j + 2, c, ",")) {
        // items without a "parameter" keyword inherit it
        for (const d of this.paramItems(s, e)) {
          u.params.push(d);
          u.decls.set(d.name, d);
        }
      }
      u.headerParams = u.params.length;
      j = c + 1;
    }
    if (isOp(t[j], "(")) {
      const c = matchBracket(t, j, end);
      this.portList(j + 1, c, u);
      j = c + 1;
    }
    return this.toSemi(j, end);
  }

  importNames(k: number, semi: number): { name: string; line: number }[] {
    const out: { name: string; line: number }[] = [];
    for (const [s, e] of splitTop(this.t, k + 1, semi, ",")) {
      if (isName(this.t[s]) && (e - s === 1 || isOp(this.t[s + 1], "::"))) out.push({ name: this.t[s].v, line: this.t[s].line });
    }
    return out;
  }

  portList(a: number, b: number, u: VUnit) {
    const t = this.t;
    const items = splitTop(t, a, b, ",");
    if (!items.length) return;
    const first = t[items[0][0]];
    const dirWords = new Set(["input", "output", "inout", "ref"]);
    const ansi = !!first && (dirWords.has(first.v) || NET_TYPES.has(first.v) || VAR_TYPES.has(first.v) || first.v === "interface" || (isName(first) && items[0][1] - items[0][0] > 1 && !isOp(t[items[0][0] + 1], "[")));
    u.ansi = ansi;
    let prev: Omit<VPort, "name" | "line" | "hasDefault"> = { dir: "inout", variable: false, type: null, dims: [] };
    for (const [s, e] of items) {
      if (!ansi) {
        const nameTok = t.slice(s, e).find((x) => isName(x));
        if (nameTok) u.ports.push({ name: nameTok.v, dir: "input", variable: false, type: null, dims: [], hasDefault: false, line: nameTok.line });
        continue;
      }
      let j = s;
      let dir: VPortDir | null = null;
      if (dirWords.has(t[j]?.v ?? "")) dir = t[j++].v as VPortDir;
      // interface port: bus_if.slave s  /  bus_if s
      if (!dir && isName(t[j]) && ((isOp(t[j + 1], ".") && isName(t[j + 2]) && isName(t[j + 3])) || (isName(t[j + 1]) && !VAR_TYPES.has(t[j].v)))) {
        const nameTok = isOp(t[j + 1], ".") ? t[j + 3] : t[j + 1];
        u.ports.push({ name: nameTok.v, dir: "interface", variable: false, type: t[j].v, dims: [], hasDefault: false, line: nameTok.line });
        prev = { dir: "interface", variable: false, type: t[j].v, dims: [] };
        continue;
      }
      const dt = this.dataType(j, e);
      const hasType = dt.next > j;
      const nameTok = t[dt.next];
      if (!isName(nameTok)) continue;
      const d: VPortDir = dir ?? prev.dir;
      const info = hasType || dir
        ? {
            dir: d,
            variable: (d === "output" || d === "inout" || d === "ref") && dt.variable,
            type: dt.type,
            dims: dt.dims,
          }
        : { ...prev, dir: d };
      const eq = findTop(t, dt.next, e, (y) => isOp(y, "="));
      u.ports.push({ name: nameTok.v, ...info, hasDefault: eq >= 0, line: nameTok.line });
      prev = info;
    }
  }

  /** Non-ANSI port declaration in the body: input [7:0] a, b; output reg y; */
  portDecl(k: number, b: number, u: VUnit): number {
    const t = this.t;
    const semi = this.semiAt(k, b);
    const dir = t[k].v as VPortDir;
    const dt = this.dataType(k + 1, semi);
    for (const it of this.declItems(dt.next, semi)) {
      const existing = u.ports.find((p) => p.name === it.name);
      const info = { dir, variable: dir !== "input" && dt.variable, type: dt.type, dims: dt.dims };
      if (existing) Object.assign(existing, info, { line: it.line });
      else u.ports.push({ name: it.name, ...info, hasDefault: false, line: it.line });
    }
    return semi + 1;
  }

  contAssign(k: number, b: number, u: VUnit, arms: Arm[]): number {
    const t = this.t;
    const semi = this.semiAt(k, b);
    let j = k + 1;
    let delay = false;
    // drive strength and delay: assign (strong0, weak1) #2 a = b;
    if (isOp(t[j], "(")) j = matchBracket(t, j, semi) + 1;
    if (isOp(t[j], "#")) {
      delay = true;
      j = isOp(t[j + 1], "(") ? matchBracket(t, j + 1, semi) + 1 : j + 2;
    }
    if (delay) u.delayLines.push(t[k].line);
    for (const [s, e] of splitTop(t, j, semi, ",")) {
      const eq = findTop(t, s, e, (y) => isOp(y, "="));
      if (eq < 0) continue;
      const lhs = t.slice(s, eq);
      const rhs = t.slice(eq + 1, e);
      u.assigns.push({ targets: targetsOf(lhs), line: t[s].line, reads: [...readsIn(rhs), ...targetReads(lhs)], rhs, delay, netDecl: false, arms });
    }
    return semi + 1;
  }

  proc(k: number, b: number, u: VUnit, arms: Arm[]): number {
    const t = this.t;
    const kind = t[k].v as VProc["kind"];
    let j = k + 1;
    let events: VProc["events"] = kind === "always_comb" || kind === "always_latch" ? "star" : null;
    let eventLine = t[k].line;
    let leadingDelay = false;
    if (isOp(t[j], "@")) {
      eventLine = t[j].line;
      if (isOp(t[j + 1], "*")) {
        events = "star";
        j += 2;
      } else if (isOp(t[j + 1], "(") && isOp(t[j + 2], "*") && isOp(t[j + 3], ")")) {
        events = "star";
        j += 4;
      } else if (isOp(t[j + 1], "(")) {
        const c = matchBracket(t, j + 1, b);
        events = this.eventList(j + 2, c);
        j = c + 1;
      } else if (isName(t[j + 1])) {
        events = [{ edge: null, name: t[j + 1].v }];
        j += 2;
      }
    } else if (isOp(t[j], "#")) {
      leadingDelay = true;
    }
    const locals = new Set<string>();
    const r = this.stmt(j, b, locals);
    u.procs.push({ kind, line: t[k].line, events, eventLine, leadingDelay, body: r.stmts, locals, arms });
    return r.next;
  }

  eventList(a: number, b: number): VEvent[] {
    const t = this.t;
    const out: VEvent[] = [];
    let s = a;
    const flush = (e: number) => {
      let j = s;
      let edge: VEvent["edge"] = null;
      if (isId(t[j], "posedge") || isId(t[j], "negedge") || isId(t[j], "edge")) edge = t[j++].v as VEvent["edge"];
      const iff = findTop(t, j, e, (y) => isId(y, "iff"));
      const name = readsIn(t, j, iff < 0 ? e : iff)[0];
      if (name) out.push({ edge, name });
    };
    let d = 0;
    for (let j = a; j < b; j++) {
      const x = t[j];
      if (isOp(x, "(") || isOp(x, "[") || isOp(x, "{")) d++;
      else if (isOp(x, ")") || isOp(x, "]") || isOp(x, "}")) d--;
      else if (d === 0 && (isId(x, "or") || isOp(x, ","))) {
        flush(j);
        s = j + 1;
      }
    }
    flush(b);
    return out;
  }

  subroutine(k: number, b: number, u: VUnit | VPackage): number {
    const t = this.t;
    const end = this.closeOf[k] > k ? this.closeOf[k] : this.semiAt(k, b);
    // name: last identifier before "(" or ";" in the header
    const headEnd = findTop(t, k + 1, end, (y) => isOp(y, "(") || isOp(y, ";"));
    const head = t.slice(k + 1, headEnd < 0 ? end : headEnd).filter((x) => isName(x));
    const nameTok = head[head.length - 1];
    if (nameTok) (t[k].v === "function" ? u.functions : "tasks" in u ? u.tasks : u.functions).add(nameTok.v);
    if ("reads" in u) {
      const locals = new Set<string>(nameTok ? [nameTok.v] : []);
      // arguments
      if (headEnd >= 0 && isOp(t[headEnd], "(")) {
        const c = matchBracket(t, headEnd, end);
        for (const [s, e] of splitTop(t, headEnd + 1, c, ",")) {
          const names = t.slice(s, e).filter((x) => isName(x));
          const n = names[names.length - 1];
          if (n) locals.add(n.v);
        }
      }
      const bodyStart = this.toSemi(k + 1, end);
      const body = this.seq(bodyStart, end, locals);
      const writes = new Map<string, number>();
      collectWrites(body, writes);
      for (const [name] of writes) if (!locals.has(name)) u.subroutineWrites.add(name);
      const reads = new Set<string>();
      collectReads(body, reads);
      for (const r of reads) if (!locals.has(r)) u.reads.push(r);
    }
    return this.skipLabel(end + 1);
  }

  instance(k: number, b: number, u: VUnit, arms: Arm[], primitive: boolean): number {
    const t = this.t;
    const semi = this.semiAt(k, b);
    const target = t[k].v;
    let j = k + 1;
    let params: VConn[] = [];
    if (primitive && isOp(t[j], "(") && !isName(t[j + 1])) j = matchBracket(t, j, semi) + 1; // strength
    if (isOp(t[j], "#")) {
      if (isOp(t[j + 1], "(")) {
        const c = matchBracket(t, j + 1, semi);
        params = this.conns(j + 2, c);
        j = c + 1;
      } else j += 2;
    }
    for (const [s, e] of splitTop(t, j, semi, ",")) {
      let p = s;
      let label = `(line ${t[k].line})`;
      if (isName(t[p])) {
        label = t[p].v;
        p++;
        while (isOp(t[p], "[")) p = matchBracket(t, p, e) + 1;
      }
      if (!isOp(t[p], "(")) continue;
      const c = matchBracket(t, p, e);
      const ports = this.conns(p + 1, c);
      const wildcard = ports.some((x) => x.formal === "*");
      u.instances.push({
        target,
        label,
        line: t[s].line,
        params,
        ports: ports.filter((x) => x.formal !== "*"),
        wildcard,
        primitive,
        arms,
      });
    }
    return semi + 1;
  }

  conns(a: number, b: number): VConn[] {
    const t = this.t;
    if (a >= b) return [];
    return splitTop(t, a, b, ",").map(([s, e]) => {
      const line = (t[s] ?? t[a]).line;
      if (isOp(t[s], ".*")) return { formal: "*", actual: [], actualName: null, actualWhole: false, empty: false, implicit: false, line };
      if (isOp(t[s], ".") && isName(t[s + 1])) {
        const formal = t[s + 1].v;
        if (!isOp(t[s + 2], "(")) {
          return { formal, actual: [t[s + 1]], actualName: formal, actualWhole: true, empty: false, implicit: true, line };
        }
        const c = matchBracket(t, s + 2, e + 1);
        const actual = t.slice(s + 3, c);
        return { formal, ...actualInfo(actual), empty: actual.length === 0, implicit: false, line };
      }
      const actual = t.slice(s, e);
      return { formal: null, ...actualInfo(actual), empty: actual.length === 0, implicit: false, line };
    });
  }

  /** Module items in [a, b). */
  items(a: number, b: number, u: VUnit, arms: Arm[]) {
    const t = this.t;
    let k = a;
    let guard = 0;
    while (k < b && guard++ < 200_000) {
      if (!(arms.length || this.inGenerate)) this.declCount = u.decls.size;
      const x = t[k];
      if (isOp(x, ";")) {
        k++;
        continue;
      }
      // label: item (SV)
      if (isName(x) && isOp(t[k + 1], ":") && !isOp(t[k + 2], ":")) {
        u.labels.add(x.v);
        k += 2;
        continue;
      }
      if (isOp(x, "(*full_case*)")) {
        k++;
        continue;
      }
      if (x.k !== "id") {
        k = this.toSemi(k, b);
        continue;
      }
      const v = x.v;
      if (v.startsWith("`")) {
        // An unknown macro as a module item (an assertion, a flop …): its arguments may be driven or read.
        k++;
        if (isOp(t[k], "(")) {
          const c = matchBracket(t, k, b);
          for (const r of readsIn(t, k + 1, c)) u.macroArgs.add(r);
          k = c + 1;
        }
        if (isOp(t[k], ";")) k++;
        continue;
      }
      if (v === "input" || v === "output" || v === "inout" || v === "ref") {
        k = this.portDecl(k, b, u);
      } else if (NET_TYPES.has(v) || VAR_TYPES.has(v) || TYPE_MODS.has(v)) {
        k = this.declaration(k, b, u, arms);
        if (arms.length || this.inGenerate) this.markLocals(u);
      } else if (v === "parameter" || v === "localparam" || v === "specparam") {
        const semi = this.semiAt(k, b);
        for (const p of this.paramItems(k, semi)) {
          u.params.push(p);
          u.decls.set(p.name, p);
        }
        k = semi + 1;
      } else if (v === "genvar") {
        const semi = this.semiAt(k, b);
        for (const it of this.declItems(k + 1, semi)) u.decls.set(it.name, { name: it.name, kind: "genvar", type: null, dims: [], unpacked: false, init: null, line: it.line });
        k = semi + 1;
      } else if (v === "typedef") {
        k = this.typedef(k, b, u);
      } else if (v === "function" || v === "task") {
        k = this.subroutine(k, b, u);
      } else if (v === "assign") {
        k = this.contAssign(k, b, u, arms);
      } else if (PROCS.has(v)) {
        k = this.proc(k, b, u, arms);
      } else if (v === "generate" || v === "endgenerate") {
        k++;
      } else if (v === "begin") {
        const end = this.closeOf[k] > k ? this.closeOf[k] : b;
        const inner = this.skipLabel(k + 1);
        if (inner > k + 1) u.labels.add(t[k + 2].v);
        this.inGenerate++;
        this.items(inner, end, u, arms);
        this.inGenerate--;
        k = this.skipLabel(end + 1);
      } else if (v === "for") {
        k = this.genFor(k, b, u, arms);
      } else if (v === "if") {
        k = this.genIf(k, b, u, arms);
      } else if (v === "case") {
        k = this.genCase(k, b, u, arms);
      } else if (v === "import") {
        const semi = this.semiAt(k, b);
        u.imports.push(...this.importNames(k, semi));
        k = semi + 1;
      } else if (ASSERTIONS.has(v)) {
        const semi = this.semiAt(k, b);
        u.reads.push(...readsIn(t, k + 1, semi));
        k = semi + 1;
      } else if (PRIMITIVES.has(v)) {
        k = this.instance(k, b, u, arms, true);
      } else if (this.closeOf[k] > k) {
        // clocking, property, sequence, covergroup, specify, class … : skip the block
        k = this.skipLabel(this.closeOf[k] + 1);
      } else if (isVKeyword(v)) {
        k = this.toSemi(k, b);
      } else if (isName(x)) {
        // user type declaration (T name; pkg::T name; T [3:0] name;) or an instance (M u (…); M #(…) u (…);)
        const n1 = t[k + 1];
        if (isOp(n1, "#") || (isName(n1) && this.instanceAhead(k + 2, b))) {
          k = this.instance(k, b, u, arms, false);
        } else if (isOp(n1, "::") || isName(n1) || isOp(n1, "[")) {
          k = this.declaration(k, b, u, arms);
          if (arms.length || this.inGenerate) this.markLocals(u);
        } else {
          k = this.toSemi(k, b);
        }
      } else {
        k = this.toSemi(k, b);
      }
    }
  }

  /** After "M u", is this an instance? u [range] ( … */
  instanceAhead(k: number, b: number): boolean {
    const t = this.t;
    while (k < b && isOp(t[k], "[")) k = matchBracket(t, k, b) + 1;
    return isOp(t[k], "(");
  }

  /** Generate body after a for/if/case header: begin … end or a single item. */
  genBody(k: number, b: number, u: VUnit, arms: Arm[]): number {
    const t = this.t;
    if (isId(t[k], "begin")) {
      const end = this.closeOf[k] > k ? this.closeOf[k] : b;
      const inner = this.skipLabel(k + 1);
      if (inner > k + 1) u.labels.add(t[k + 2].v);
      this.inGenerate++;
      this.items(inner, end, u, arms);
      this.inGenerate--;
      return this.skipLabel(end + 1);
    }
    if (isId(t[k], "if")) return this.genIf(k, b, u, arms);
    if (isId(t[k], "for")) return this.genFor(k, b, u, arms);
    if (isId(t[k], "case")) return this.genCase(k, b, u, arms);
    // a single item: run items() over just that statement
    const end = PROCS.has(t[k]?.v ?? "") ? this.procEnd(k, b) : this.toSemi(k, b);
    this.items(k, end, u, arms);
    return end;
  }

  procEnd(k: number, b: number): number {
    const scratch = this.newUnit("module", "", "", 0, 0, "wire");
    return this.proc(k, b, scratch, []);
  }

  genFor(k: number, b: number, u: VUnit, arms: Arm[]): number {
    const t = this.t;
    const open = k + 1;
    if (!isOp(t[open], "(")) return this.toSemi(k, b);
    const close = matchBracket(t, open, b);
    const init = splitTop(t, open + 1, close, ";")[0];
    if (init) {
      const ids = t.slice(init[0], init[1]).filter((x) => isName(x));
      if (ids[0]) u.decls.set(ids[0].v, { name: ids[0].v, kind: "genvar", type: null, dims: [], unpacked: false, init: null, line: ids[0].line });
    }
    u.reads.push(...readsIn(t, open + 1, close));
    return this.genBody(close + 1, b, u, arms);
  }

  genIf(k: number, b: number, u: VUnit, arms: Arm[]): number {
    const t = this.t;
    const gen = ++this.gen;
    let arm = 0;
    let j = k;
    for (;;) {
      const open = j + 1;
      if (!isOp(t[open], "(")) return this.toSemi(j, b);
      const close = matchBracket(t, open, b);
      u.reads.push(...readsIn(t, open + 1, close));
      j = this.genBody(close + 1, b, u, [...arms, { gen, arm: arm++ }]);
      if (!isId(t[j], "else")) return j;
      if (isId(t[j + 1], "if")) {
        j = j + 1;
        continue;
      }
      return this.genBody(j + 1, b, u, [...arms, { gen, arm: arm++ }]);
    }
  }

  genCase(k: number, b: number, u: VUnit, arms: Arm[]): number {
    const t = this.t;
    const end = this.closeOf[k] > k ? this.closeOf[k] : b;
    const gen = ++this.gen;
    let j = k + 1;
    if (isOp(t[j], "(")) {
      const c = matchBracket(t, j, end);
      u.reads.push(...readsIn(t, j + 1, c));
      j = c + 1;
    }
    let arm = 0;
    let guard = 0;
    while (j < end && guard++ < 10_000) {
      if (isOp(t[j], ";")) {
        j++;
        continue;
      }
      if (isId(t[j], "default")) {
        j++;
        if (isOp(t[j], ":")) j++;
      } else {
        const colon = findTop(t, j, end, (y) => isOp(y, ":"));
        if (colon < 0) break;
        u.reads.push(...readsIn(t, j, colon));
        j = colon + 1;
      }
      const next = this.genBody(j, end, u, [...arms, { gen, arm: arm++ }]);
      j = next > j ? next : j + 1;
    }
    return this.skipLabel(end + 1);
  }

  /** Package or $unit-scope items: parameters, types, functions, imports. */
  scopeItems(a: number, b: number, p: VPackage, imports?: { name: string; line: number }[]) {
    const t = this.t;
    let k = a;
    let guard = 0;
    while (k < b && guard++ < 100_000) {
      const x = t[k];
      if (x.k !== "id") {
        k = this.toSemi(k, b);
        continue;
      }
      if (x.v === "import") {
        const semi = this.semiAt(k, b);
        imports?.push(...this.importNames(k, semi));
        k = semi + 1;
      } else if (x.v === "parameter" || x.v === "localparam") {
        const semi = this.semiAt(k, b);
        for (const d of this.paramItems(k, semi)) p.decls.set(d.name, d);
        k = semi + 1;
      } else if (x.v === "typedef") {
        k = this.typedef(k, b, p);
      } else if (x.v === "function" || x.v === "task") {
        k = this.subroutine(k, b, p);
      } else if (NET_TYPES.has(x.v) || VAR_TYPES.has(x.v)) {
        k = this.declaration(k, b, p, []);
      } else if (this.closeOf[k] > k) {
        k = this.skipLabel(this.closeOf[k] + 1);
      } else {
        k = this.toSemi(k, b);
      }
    }
  }
}

function actualInfo(actual: VToken[]): { actual: VToken[]; actualName: string | null; actualWhole: boolean } {
  const simple = actual.length >= 1 && isName(actual[0]) && (actual.length === 1 || isOp(actual[1], "["));
  return { actual, actualName: simple ? actual[0].v : null, actualWhole: simple && actual.length === 1 };
}

/** Assignment targets in a statement tree, with the line of the first write. */
export function collectWrites(stmts: VStmt[], out: Map<string, number>) {
  for (const s of stmts) {
    if (s.k === "assign") for (const tg of s.targets) if (!out.has(tg.name)) out.set(tg.name, s.line);
    if (s.k === "if") s.branches.forEach((b) => collectWrites(b.body, out));
    else if (s.k === "case") s.items.forEach((i) => collectWrites(i.body, out));
    else if (s.k === "loop" || s.k === "timing") collectWrites(s.body, out);
  }
  return out;
}

/** Every name read in a statement tree (conditions, selectors, right-hand sides, call arguments). */
export function collectReads(stmts: VStmt[], out: Set<string>) {
  for (const s of stmts) {
    switch (s.k) {
      case "assign":
      case "other":
      case "call":
      case "decl":
        s.reads.forEach((r) => out.add(r));
        break;
      case "if":
        for (const b of s.branches) {
          readsIn(b.cond).forEach((r) => out.add(r));
          collectReads(b.body, out);
        }
        break;
      case "case":
        readsIn(s.selector).forEach((r) => out.add(r));
        for (const i of s.items) {
          readsIn(i.labels).forEach((r) => out.add(r));
          collectReads(i.body, out);
        }
        break;
      case "loop":
      case "timing":
        s.reads.forEach((r) => out.add(r));
        collectReads(s.body, out);
        break;
    }
  }
  return out;
}

/** Calls made in a statement tree (system tasks and user functions/tasks). */
export function collectCalls(stmts: VStmt[], out: { name: string; sys: boolean; args: VToken[]; line: number }[] = []) {
  for (const s of stmts) {
    if (s.k === "call") out.push({ name: s.name, sys: s.sys, args: s.args, line: s.line });
    else if (s.k === "if") s.branches.forEach((b) => collectCalls(b.body, out));
    else if (s.k === "case") s.items.forEach((i) => collectCalls(i.body, out));
    else if (s.k === "loop" || s.k === "timing") collectCalls(s.body, out);
  }
  return out;
}

export function tokText(t: VToken[]): string {
  let s = "";
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    const prev = t[i - 1];
    const tight = !prev || isOp(prev, "(") || isOp(x, ")") || isOp(x, ",") || isOp(x, "[") || isOp(prev, "[") || isOp(x, "]") || isOp(x, ":") || isOp(prev, ":") || isOp(x, ".") || isOp(prev, ".") || isOp(prev, "~") || isOp(prev, "!");
    s += (tight ? "" : " ") + x.v;
  }
  return s.trim();
}

/* ---------- file parser ---------- */

export function parseVerilogFile(path: string, text: string, host: PreprocessHost = {}): VFileModel {
  const lang = /\.(sv|svh)$/i.test(path) ? "systemverilog" : "verilog";
  const header = /\.(vh|svh|h|inc)$/i.test(path);
  const pp = preprocess(path, text, host);
  const t = pp.tokens;
  const model: VFileModel = {
    path,
    lang,
    header,
    lines: text.split(/\r?\n/),
    units: [],
    packages: [],
    includes: pp.includes,
    unitScope: { name: "$unit", file: path, line: 1, decls: new Map(), types: new Map(), enumConsts: new Set(), functions: new Set() },
    imports: [],
    timescale: pp.timescale,
    nettypeNone: pp.nettype.some((n) => n.value === "none"),
    unknownMacros: pp.unknownMacros,
    syntax: pp.errors.map((e) => ({ line: e.line, message: e.message, fix: "Close the literal, comment or `ifdef where it should end." })),
    parsed: true,
  };
  const { closeOf, issues } = blockPass(t);
  model.syntax.push(...issues);
  if (issues.length) {
    model.parsed = false;
    return model;
  }
  const p = new Parser(t, closeOf);
  const nettypeAt = (at: number) => {
    let v = "wire";
    for (const n of pp.nettype) if (n.at <= at) v = n.value;
    return v;
  };
  let k = 0;
  let scopeStart = 0;
  // $unit items between design units
  const flushScope = (end: number) => {
    if (end > scopeStart) p.scopeItems(scopeStart, end, model.unitScope, model.imports);
  };
  while (k < t.length) {
    const x = t[k];
    const isUnit = x.k === "id" && (x.v === "module" || x.v === "macromodule" || x.v === "interface" || x.v === "program") && closeOf[k] > k;
    if (isUnit) {
      flushScope(k);
      const end = closeOf[k];
      const nameAt = isId(t[k + 1], "automatic") || isId(t[k + 1], "static") ? k + 2 : k + 1;
      const name = isName(t[nameAt]) ? t[nameAt].v : "?";
      const kind: VUnit["kind"] = x.v === "interface" ? "interface" : x.v === "program" ? "program" : "module";
      const u = p.newUnit(kind, name, path, x.line, t[end].line, nettypeAt(k));
      const bodyStart = p.header(k, end, u);
      p.items(bodyStart, end, u, []);
      model.units.push(u);
      k = p.skipLabel(end + 1);
      scopeStart = k;
      continue;
    }
    if (isId(x, "package") && closeOf[k] > k) {
      flushScope(k);
      const end = closeOf[k];
      const nameTok = t[k + 1];
      const pkg: VPackage = { name: isName(nameTok) ? nameTok.v : "?", file: path, line: x.line, decls: new Map(), types: new Map(), enumConsts: new Set(), functions: new Set() };
      p.scopeItems(p.toSemi(k + 1, end), end, pkg);
      model.packages.push(pkg);
      k = p.skipLabel(end + 1);
      scopeStart = k;
      continue;
    }
    if (x.k === "id" && closeOf[k] > k && (x.v === "class" || x.v === "checker" || x.v === "primitive" || x.v === "config")) {
      flushScope(k);
      k = p.skipLabel(closeOf[k] + 1);
      scopeStart = k;
      continue;
    }
    k++;
  }
  flushScope(t.length);
  return model;
}

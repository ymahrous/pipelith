/**
 * Code review: static analysis of a VHDL processor codebase.
 *
 * Every finding names a file and line, explains why it matters, and suggests
 * a concrete fix. Pipeline checks adapt to the selected depth (5 or 6 stages).
 */
import { activePaths, describeForwarding, FULL_FORWARDING, geometry, type Depth, type ForwardingConfig } from "../pipeline/pipeline";
import type { SourceFile } from "./intake";
import type { Token } from "./lexer";
import {
  parseFile,
  tokText,
  type Architecture,
  type Assoc,
  type Component,
  type Entity,
  type FileModel,
  type Iface,
  type Process,
  type Stmt,
} from "./parse";

export type Severity = "error" | "warning" | "info";
export type Category = "Syntax" | "Structure" | "Connectivity" | "Processes" | "Pipeline" | "Style";

export interface Finding {
  id: string;
  rule: string;
  category: Category;
  severity: Severity;
  file: string;
  line: number;
  title: string;
  message: string;
  fix: string;
  fixCode?: string;
  excerpt?: { start: number; lines: string[]; focus: number };
}

export interface HierarchyNode {
  entity: string;
  label: string;
  file: string | null;
  children: HierarchyNode[];
}

export interface PipelineSummary {
  selected: Depth;
  inferred: Depth | null;
  registersFound: { pair: string; entity: string; file: string }[];
  expected: string[];
  stages: { stage: string; entity: string | null }[];
  forwardingUnit: string | null;
  hazardUnit: string | null;
  /** Forwarding the user selected, and the paths the forwarding unit's ports suggest. */
  forwarding: { description: string; selected: string[]; found: string[] };
}

export interface ReviewReport {
  files: number;
  lines: number;
  entities: number;
  architectures: number;
  processes: number;
  instances: number;
  findings: Finding[];
  counts: Record<Severity, number>;
  top: string | null;
  testbenches: string[];
  hierarchy: HierarchyNode | null;
  compileOrder: string[];
  compileOrderNote: string | null;
  pipeline: PipelineSummary;
  unparsed: string[];
}

/* ---------- width evaluation ---------- */

interface Env {
  consts: Map<string, number>;
  subtypes: Map<string, Token[]>;
}

function evalNum(tokens: Token[], env: Env): number | null {
  let i = 0;
  const peek = () => tokens[i];
  const expr = (): number | null => {
    let v = term();
    while (v !== null && peek() && peek().k === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = tokens[i++].v;
      const r = term();
      if (r === null) return null;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const term = (): number | null => {
    let v = factor();
    while (v !== null && peek() && ((peek().k === "op" && (peek().v === "*" || peek().v === "/" || peek().v === "**")) || (peek().k === "id" && peek().v === "mod"))) {
      const op = tokens[i++].v;
      const r = factor();
      if (r === null) return null;
      v = op === "*" ? v * r : op === "/" ? (r ? Math.trunc(v / r) : null) : op === "**" ? v ** r : r ? ((v % r) + r) % r : null;
      if (v === null) return null;
    }
    return v;
  };
  const factor = (): number | null => {
    const t = tokens[i++];
    if (!t) return null;
    if (t.k === "op" && t.v === "-") {
      const f = factor();
      return f === null ? null : -f;
    }
    if (t.k === "op" && t.v === "(") {
      const v = expr();
      if (!(peek()?.k === "op" && peek().v === ")")) return null;
      i++;
      return v;
    }
    if (t.k === "num") {
      const m = /^(\d+)#([0-9a-f_]+)#$/i.exec(t.v);
      if (m) return parseInt(m[2].replace(/_/g, ""), Number(m[1]));
      const n = Number(t.v.replace(/_/g, ""));
      return Number.isInteger(n) ? n : null;
    }
    if (t.k === "id") return env.consts.get(t.v) ?? null;
    return null;
  };
  const v = expr();
  return i === tokens.length ? v : null;
}

const VECTOR_TYPES = new Set(["std_logic_vector", "std_ulogic_vector", "unsigned", "signed", "bit_vector"]);
const SCALAR_BITS = new Set(["std_logic", "std_ulogic", "bit"]);

function rangeWidth(tokens: Token[], env: Env): number | null {
  const dir = tokens.findIndex((t) => t.k === "id" && (t.v === "downto" || t.v === "to"));
  if (dir < 0) return null;
  const a = evalNum(tokens.slice(0, dir), env);
  const b = evalNum(tokens.slice(dir + 1), env);
  if (a === null || b === null) return null;
  return Math.abs(a - b) + 1;
}

function typeWidth(type: Token[], env: Env, depth = 0): number | null {
  if (!type.length || depth > 8) return null;
  const head = type[0];
  if (head.k !== "id") return null;
  if (type.length === 1 && SCALAR_BITS.has(head.v)) return 1;
  if (VECTOR_TYPES.has(head.v) && type[1]?.v === "(" && type[type.length - 1]?.v === ")") {
    return rangeWidth(type.slice(2, -1), env);
  }
  if (type.length === 1 && env.subtypes.has(head.v)) return typeWidth(env.subtypes.get(head.v)!, env, depth + 1);
  return null;
}

function literalWidth(rhs: Token[]): number | null {
  if (rhs.length !== 1) return null;
  const t = rhs[0];
  if (t.k === "str" && /^"[01uxzwlh-]*"$/i.test(t.v)) return t.v.length - 2;
  if (t.k === "bits") {
    const m = /^(\d*)([us]?)([box])"([^"]*)"$/i.exec(t.v);
    if (!m) return null;
    if (m[1]) return Number(m[1]);
    const digits = m[4].replace(/_/g, "").length;
    return m[3].toLowerCase() === "x" ? digits * 4 : m[3].toLowerCase() === "o" ? digits * 3 : digits;
  }
  return null;
}

/* ---------- helpers ---------- */

const PIPE_TOKENS = ["if", "id", "ex", "ex1", "ex2", "mem", "wb"];
const PIPE_RE = /(?:^|_)(if|id|ex1|ex2|ex|mem|wb)_(id|ex1|ex2|ex|mem|wb)(?:_|$)/;

function pipelinePair(name: string): string | null {
  const m = PIPE_RE.exec(name.toLowerCase());
  if (!m || PIPE_TOKENS.indexOf(m[1]) >= PIPE_TOKENS.indexOf(m[2])) return null;
  return `${m[1].toUpperCase()}/${m[2].toUpperCase()}`;
}

function excerpt(file: FileModel | undefined, line: number) {
  if (!file || line < 1) return undefined;
  const start = Math.max(1, line - 2);
  const end = Math.min(file.lines.length, line + 2);
  return { start, lines: file.lines.slice(start - 1, end).map((l) => l.replace(/\t/g, "  ").slice(0, 200)), focus: line };
}

function assignsIn(stmts: Stmt[], out: Map<string, { line: number; whole: boolean }[]>, signalsOnly = true) {
  for (const s of stmts) {
    if (s.k === "assign" && (s.signal || !signalsOnly)) {
      const list = out.get(s.target) ?? [];
      list.push({ line: s.line, whole: s.whole });
      out.set(s.target, list);
    } else if (s.k === "if") s.branches.forEach((b) => assignsIn(b.body, out, signalsOnly));
    else if (s.k === "case") s.alts.forEach((a) => assignsIn(a, out, signalsOnly));
    else if (s.k === "loop") assignsIn(s.body, out, signalsOnly);
  }
  return out;
}

function readsIn(stmts: Stmt[], out: Set<string>, loopVars: Set<string>) {
  const tokIds = (t: Token[]) => {
    for (let j = 0; j < t.length; j++) {
      const x = t[j];
      if (x.k !== "id") continue;
      const p = t[j - 1];
      if (p && p.k === "op" && (p.v === "." || p.v === "'")) continue;
      out.add(x.v);
    }
  };
  for (const s of stmts) {
    if (s.k === "assign" || s.k === "wait" || s.k === "other") s.reads.forEach((r) => out.add(r));
    else if (s.k === "if") {
      for (const b of s.branches) {
        tokIds(b.cond);
        readsIn(b.body, out, loopVars);
      }
    } else if (s.k === "case") {
      tokIds(s.selector);
      for (const a of s.alts) readsIn(a, out, loopVars);
    }
    else if (s.k === "loop") {
      if (s.loopVar) loopVars.add(s.loopVar);
      readsIn(s.body, out, loopVars);
    }
  }
  return out;
}

/** Signals assigned on every path through the statements. */
function definitelyAssigned(stmts: Stmt[]): Set<string> {
  const out = new Set<string>();
  for (const s of stmts) {
    if (s.k === "assign" && s.signal && s.whole) out.add(s.target);
    else if (s.k === "if") {
      if (!s.hasElse) continue;
      const sets = s.branches.map((b) => definitelyAssigned(b.body));
      for (const n of sets[0]) if (sets.every((x) => x.has(n))) out.add(n);
    } else if (s.k === "case") {
      if (!s.alts.length) continue;
      const sets = s.alts.map(definitelyAssigned);
      for (const n of sets[0]) if (sets.every((x) => x.has(n))) out.add(n);
    }
  }
  return out;
}

interface EdgeInfo {
  clock: string;
  kind: "rising" | "falling";
  legacy: boolean;
  line: number;
}

function edgeIn(cond: Token[], line: number): EdgeInfo | null {
  for (let j = 0; j < cond.length; j++) {
    const t = cond[j];
    if (t.k === "id" && (t.v === "rising_edge" || t.v === "falling_edge") && cond[j + 1]?.v === "(" && cond[j + 2]?.k === "id") {
      return { clock: cond[j + 2].v, kind: t.v === "rising_edge" ? "rising" : "falling", legacy: false, line };
    }
    if (t.k === "id" && cond[j + 1]?.v === "'" && cond[j + 2]?.v === "event") {
      const lvl = cond.slice(j).find((x) => x.k === "chr");
      return { clock: t.v, kind: lvl?.v === "'0'" ? "falling" : "rising", legacy: true, line };
    }
  }
  return null;
}

function findEdge(stmts: Stmt[]): EdgeInfo | null {
  for (const s of stmts) {
    if (s.k === "if") {
      for (const b of s.branches) {
        const e = edgeIn(b.cond, b.line) ?? findEdge(b.body);
        if (e) return e;
      }
    } else if (s.k === "wait") {
      // wait until rising_edge(clk)
    } else if (s.k === "case") {
      for (const a of s.alts) {
        const e = findEdge(a);
        if (e) return e;
      }
    }
  }
  return null;
}

/** rst, reset, rst_n, nreset, arst, sys_rst … but not reset_z (a flag clear). */
const RESET_NAME = /^(?:n|a|s)?(?:rst|reset)(?:_?n|_?b|_?l)?$|_(?:rst|reset)(?:_?n)?$/;

function resetCond(cond: Token[]): { name: string; level: "0" | "1" } | null {
  for (let j = 0; j + 2 < cond.length; j++) {
    if (cond[j].k === "id" && cond[j + 1].v === "=" && cond[j + 2].k === "chr" && RESET_NAME.test(cond[j].v)) {
      const lv = cond[j + 2].v.replace(/'/g, "");
      if (lv === "0" || lv === "1") return { name: cond[j].v, level: lv };
    }
  }
  return null;
}

/* ---------- main ---------- */

export function reviewCodebase(sources: SourceFile[], depth: Depth, forwarding: ForwardingConfig = FULL_FORWARDING): ReviewReport {
  const files = sources.map((f) => parseFile(f.path, f.text));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const findings: Finding[] = [];
  let seq = 0;
  const add = (f: Omit<Finding, "id" | "excerpt"> & { excerpt?: Finding["excerpt"] }) =>
    findings.push({ id: `F${++seq}`, excerpt: excerpt(byPath.get(f.file), f.line), ...f });

  // Syntax
  for (const f of files) {
    for (const s of f.syntax) {
      add({ rule: "syntax", category: "Syntax", severity: "error", file: f.path, line: s.line, title: "Syntax error", message: s.message, fix: s.fix });
    }
  }

  const entities = new Map<string, Entity>();
  for (const f of files)
    for (const e of f.entities) {
      const prev = entities.get(e.name);
      if (prev) {
        add({
          rule: "duplicate-entity",
          category: "Structure",
          severity: "warning",
          file: e.file,
          line: e.line,
          title: `Entity ${e.name} is defined twice`,
          message: `It is also defined in ${prev.file}:${prev.line}. The simulator keeps whichever file it compiles last.`,
          fix: "Delete or rename one of them, and make sure only one is in the compile list.",
        });
      }
      entities.set(e.name, e);
    }
  const archs: Architecture[] = files.flatMap((f) => f.architectures);
  const packageComponents: Component[] = files.flatMap((f) => f.packages.flatMap((p) => p.components));
  const packageConsts = new Map<string, number>();
  const packageSubtypes = new Map<string, Token[]>();
  const packageNames = new Set<string>();
  for (const f of files)
    for (const p of f.packages) {
      for (const [k, v] of p.subtypes) packageSubtypes.set(k, v);
      for (const d of p.decls.values()) {
        packageNames.add(d.name);
        if (d.kind === "constant" && d.init) {
          const n = evalNum(d.init, { consts: packageConsts, subtypes: packageSubtypes });
          if (n !== null) packageConsts.set(d.name, n);
        }
      }
    }

  const envFor = (ent: Entity | undefined, arch: Architecture | null, overrides?: Map<string, number>): Env => {
    const env: Env = { consts: new Map(packageConsts), subtypes: new Map(packageSubtypes) };
    for (const g of ent?.generics ?? []) {
      const o = overrides?.get(g.name);
      const v = o ?? (g.defaultValue ? evalNum(g.defaultValue, env) : null);
      if (v !== null && v !== undefined) env.consts.set(g.name, v);
    }
    if (arch) {
      for (const [k, v] of arch.subtypes) env.subtypes.set(k, v);
      for (const d of arch.decls.values()) {
        if (d.kind === "constant" && d.init) {
          const n = evalNum(d.init, env);
          if (n !== null) env.consts.set(d.name, n);
        }
      }
    }
    return env;
  };

  const instantiated = new Set<string>();
  const testbenches: string[] = [];
  for (const e of entities.values()) if (!e.ports.length) testbenches.push(e.name);
  const isTb = (name: string) => testbenches.includes(name);

  // Architecture ↔ entity
  for (const a of archs) {
    if (!entities.has(a.entity)) {
      add({
        rule: "arch-without-entity",
        category: "Structure",
        severity: "error",
        file: a.file,
        line: a.line,
        title: `Architecture ${a.name} is for an entity that isn't in the codebase`,
        message: `No file defines entity “${a.entity}”, so this architecture cannot be compiled.`,
        fix: `Add the file that declares entity ${a.entity}, or fix the name after “of”.`,
      });
    }
  }
  for (const e of entities.values()) {
    if (!archs.some((a) => a.entity === e.name)) {
      add({
        rule: "entity-without-arch",
        category: "Structure",
        severity: "warning",
        file: e.file,
        line: e.line,
        title: `Entity ${e.name} has no architecture`,
        message: "Instances of it elaborate as empty boxes and drive nothing.",
        fix: `Add “architecture rtl of ${e.name} is … begin … end architecture;”, or include the file that has it.`,
      });
    }
  }

  // Files: names and use clauses
  for (const f of files) {
    const base = f.path.split("/").pop()!.replace(/\.(vhd|vhdl|vho)$/i, "").toLowerCase();
    if (f.entities.length === 1 && f.entities[0].name !== base && !isTb(f.entities[0].name)) {
      add({
        rule: "file-name",
        category: "Style",
        severity: "info",
        file: f.path,
        line: f.entities[0].line,
        title: "File name differs from the entity name",
        message: `The file is “${base}” but declares entity “${f.entities[0].name}”. Tools and people find units by file name.`,
        fix: `Rename the file to ${f.entities[0].name}.vhd, or rename the entity.`,
      });
    }
    for (const u of f.uses) {
      const m = /^work\.([a-z0-9_]+)/.exec(u.name);
      if (!m || m[1] === "all" || files.some((x) => x.packages.some((p) => p.name === m[1])) || entities.has(m[1])) continue;
      add({
        rule: "missing-package",
        category: "Structure",
        severity: "error",
        file: f.path,
        line: u.line,
        title: `Package ${m[1]} is not in the upload`,
        message: `This file uses work.${m[1]}, but none of the uploaded files declares “package ${m[1]}”. The file won't compile, and anything it uses from the package can't be checked.`,
        fix: `Add the file that contains “package ${m[1]} is … end package;” to your .zip (any folder is fine), then upload again.`,
      });
    }
    const nonStd = f.uses.filter((u) => /^ieee\.std_logic_(arith|unsigned|signed)/.test(u.name));
    if (nonStd.length) {
      const mixes = f.uses.some((u) => u.name.startsWith("ieee.numeric_std"));
      add({
        rule: "non-standard-package",
        category: "Style",
        severity: "warning",
        file: f.path,
        line: nonStd[0].line,
        title: mixes ? "numeric_std is mixed with Synopsys arithmetic packages" : "Non-standard arithmetic package",
        message: `${nonStd.map((u) => u.name).join(", ")} ${mixes ? "defines its own unsigned/signed types that clash with numeric_std's, causing ambiguous overloads." : "is a vendor package, not an IEEE standard; behaviour differs between tools."}`,
        fix: "Use only ieee.numeric_std and convert explicitly with unsigned(), signed(), to_integer() and std_logic_vector().",
        fixCode: "library ieee;\nuse ieee.std_logic_1164.all;\nuse ieee.numeric_std.all;",
      });
    }
  }

  const resetUses: { name: string; level: "0" | "1"; file: string; line: number }[] = [];
  let processCount = 0;
  let instanceCount = 0;

  for (const a of archs) {
    const ent = entities.get(a.entity);
    const env = envFor(ent, a);
    const ports = new Map<string, Iface>((ent?.ports ?? []).map((p) => [p.name, p]));
    const generics = new Set((ent?.generics ?? []).map((g) => g.name));
    const comps = new Map<string, Component>([...packageComponents, ...a.components].map((c) => [c.name, c]));
    const scopeType = (name: string): Token[] | null => {
      const d = a.decls.get(name);
      if (d && d.kind !== "alias") return d.type;
      return ports.get(name)?.type ?? null;
    };
    const declared = (name: string) =>
      a.decls.has(name) || ports.has(name) || generics.has(name) || packageNames.has(name) || a.loopVars.has(name);
    const tb = isTb(a.entity);

    type Src = { kind: "process" | "assign" | "instance"; where: string; line: number; whole: boolean };
    const drivers = new Map<string, Src[]>();
    const reads = new Set<string>(a.reads);
    const addDriver = (name: string, s: Src) => {
      const l = drivers.get(name) ?? [];
      l.push(s);
      drivers.set(name, l);
    };

    const checkAssignTarget = (target: string, line: number) => {
      const p = ports.get(target);
      if (p && p.mode === "in") {
        add({
          rule: "assign-to-input",
          category: "Connectivity",
          severity: "error",
          file: a.file,
          line,
          title: `Input port ${target} is assigned`,
          message: "Ports of mode in can only be read inside the architecture.",
          fix: `Assign an internal signal instead, or change the port to “out”/“inout” in entity ${a.entity}.`,
        });
      } else if (!declared(target)) {
        add({
          rule: "undeclared",
          category: "Connectivity",
          severity: "error",
          file: a.file,
          line,
          title: `${target} is not declared`,
          message: `Nothing named “${target}” is declared in architecture ${a.name}, its entity's ports, or the packages in the codebase.`,
          fix: `Declare it (“signal ${target} : std_logic;”) or fix the spelling.`,
        });
      }
    };

    const checkWidth = (targetTokens: Token[], rhs: Token[], line: number, what: string) => {
      if (targetTokens.length !== 1) return;
      const tt = scopeType(targetTokens[0].v);
      const tw = tt ? typeWidth(tt, env) : null;
      if (tw === null) return;
      let rw: number | null = null;
      let rname = "";
      if (rhs.length === 1 && rhs[0].k === "id") {
        const rt = scopeType(rhs[0].v);
        rw = rt ? typeWidth(rt, env) : null;
        rname = rhs[0].v;
      } else {
        rw = literalWidth(rhs);
        rname = rhs[0]?.v ?? "";
      }
      if (rw !== null && rw !== tw) {
        add({
          rule: "width-mismatch",
          category: "Connectivity",
          severity: "error",
          file: a.file,
          line,
          title: `Width mismatch in ${what}`,
          message: `${targetTokens[0].v} is ${tw} bit${tw > 1 ? "s" : ""} wide but ${rname} is ${rw}. Simulation stops with a bound-check failure.`,
          fix:
            rw < tw
              ? `Extend the value, e.g. ${targetTokens[0].v} <= std_logic_vector(resize(unsigned(${rname}), ${tw}));`
              : `Take a slice, e.g. ${targetTokens[0].v} <= ${rname}(${tw - 1} downto 0);`,
        });
      }
    };

    // Concurrent assignments
    for (const s of a.assigns) {
      checkAssignTarget(s.target, s.line);
      addDriver(s.target, { kind: "assign", where: `line ${s.line}`, line: s.line, whole: s.whole });
      s.reads.forEach((r) => reads.add(r));
      checkWidth(s.targetTokens, s.rhs, s.line, "assignment");
    }

    // Processes
    for (const p of a.processes) {
      processCount++;
      const where = p.label ? `process ${p.label}` : `process at line ${p.line}`;
      const assigned = assignsIn(p.body, new Map());
      const loopVars = new Set<string>();
      const pReads = readsIn(p.body, new Set(), loopVars);
      for (const [name, list] of assigned) {
        if (p.variables.has(name)) continue;
        checkAssignTarget(name, list[0].line);
        addDriver(name, { kind: "process", where, line: list[0].line, whole: list.every((x) => x.whole) });
      }
      pReads.forEach((r) => {
        if (!p.variables.has(r) && !loopVars.has(r)) reads.add(r);
      });
      reviewProcess(p, a, where, assigned, pReads, loopVars, ports, scopeType, env, tb, resetUses, add, checkWidth);
    }

    // Instances
    for (const inst of a.instances) {
      instanceCount++;
      instantiated.add(inst.target);
      const target = entities.get(inst.target);
      const comp = comps.get(inst.target);
      // Port maps bind to the component declaration when there is one; entity mismatches are checked separately.
      const iface = inst.kind === "component" && comp ? comp : (target ?? comp);
      if (!iface) {
        const vendor = (byPath.get(a.file)?.uses ?? []).some((u) => !/^(work|ieee|std)\./.test(u.name));
        add({
          rule: "unknown-unit",
          category: "Structure",
          severity: vendor ? "warning" : "error",
          file: a.file,
          line: inst.line,
          title: `Instance ${inst.label} uses ${inst.target}, which isn't defined`,
          message: vendor
            ? `There is no entity or component named “${inst.target}” in the upload. This file uses a vendor library, so it may be a vendor primitive the review can't see.`
            : `There is no entity or component named “${inst.target}” in the codebase.`,
          fix: vendor
            ? `If ${inst.target} is a vendor primitive, ignore this. Otherwise add the file that defines it to the .zip.`
            : `Add the file that defines entity ${inst.target} to the upload, or fix the name.`,
        });
        continue;
      }
      if (!target && comp) {
        add({
          rule: "unbound-component",
          category: "Structure",
          severity: "warning",
          file: a.file,
          line: inst.line,
          title: `Component ${inst.target} has no matching entity`,
          message: "Elaboration fails (or leaves an empty black box) because nothing implements the component.",
          fix: `Add entity ${inst.target} to the codebase, or instantiate an existing entity.`,
        });
      }
      const portsOf = new Map(iface.ports.map((p) => [p.name, p]));
      // generic overrides
      const overrides = new Map<string, number>();
      inst.generics.forEach((g, gi) => {
        const name = g.formal ?? iface.generics[gi]?.name;
        const v = evalNum(g.actual, env);
        if (name && v !== null) overrides.set(name, v);
      });
      const targetEnv = envFor(target ?? iface, null, overrides);
      const seen = new Set<string>();
      inst.ports.forEach((as, pi) => {
        const formal = as.formal ?? iface.ports[pi]?.name ?? null;
        if (!formal) {
          add({
            rule: "port-map-count",
            category: "Connectivity",
            severity: "error",
            file: a.file,
            line: as.line,
            title: `Too many positional ports in ${inst.label}`,
            message: `${inst.target} has ${iface.ports.length} ports but the map lists more.`,
            fix: "Use named association (formal => actual) so the order can't drift.",
          });
          return;
        }
        seen.add(formal);
        const port = portsOf.get(formal);
        if (!port) {
          add({
            rule: "unknown-formal",
            category: "Connectivity",
            severity: "error",
            file: a.file,
            line: as.line,
            title: `${inst.target} has no port named ${formal}`,
            message: `Instance ${inst.label} connects “${formal}”, which isn't in the ${target ? "entity" : "component"}'s port list.`,
            fix: `Fix the name, or add the port to ${inst.target}. Its ports are: ${iface.ports.map((p) => p.name).join(", ")}.`,
          });
          return;
        }
        if (as.open) return;
        if (port.mode === "in" || port.mode === "inout") as.actual.forEach((t, j) => t.k === "id" && !(as.actual[j - 1]?.v === "'") && reads.add(t.v));
        if ((port.mode === "out" || port.mode === "buffer" || port.mode === "inout") && as.actualName) {
          addDriver(as.actualName, { kind: "instance", where: `${inst.label}.${formal}`, line: as.line, whole: as.actualWhole && !as.formalPartial });
          if (port.mode !== "inout") checkAssignTarget(as.actualName, as.line);
        }
        if (as.actualName && as.actualWhole && !as.formalPartial) {
          const fw = typeWidth(port.type, targetEnv);
          const at = scopeType(as.actualName);
          const aw = at ? typeWidth(at, env) : null;
          if (fw !== null && aw !== null && fw !== aw) {
            add({
              rule: "width-mismatch",
              category: "Connectivity",
              severity: "error",
              file: a.file,
              line: as.line,
              title: `Width mismatch on ${inst.label}.${formal}`,
              message: `Port ${formal} of ${inst.target} is ${fw} bits but ${as.actualName} is ${aw}.`,
              fix: `Connect a ${fw}-bit signal, take a slice (${as.actualName}(${fw - 1} downto 0)), or set the instance's width generic.`,
            });
          }
        }
      });
      for (const p of iface.ports) {
        if (seen.has(p.name)) continue;
        if (p.mode === "in" && !p.defaultValue) {
          add({
            rule: "input-unconnected",
            category: "Connectivity",
            severity: "error",
            file: a.file,
            line: inst.line,
            title: `Input ${p.name} of ${inst.label} is not connected`,
            message: `${inst.target}.${p.name} has no default value, so it floats at 'U' and everything it feeds becomes undefined.`,
            fix: `Connect it in the port map: ${p.name} => <signal>, or give the port a default in ${inst.target}.`,
            fixCode: `${p.name} => '0',  -- or the signal that should drive it`,
          });
        } else if (p.mode === "out") {
          add({
            rule: "output-unconnected",
            category: "Connectivity",
            severity: "info",
            file: a.file,
            line: inst.line,
            title: `Output ${p.name} of ${inst.label} is left unconnected`,
            message: "Unused outputs are fine, but leaving them out of the map hides whether that was intended.",
            fix: `Write it explicitly: ${p.name} => open,`,
          });
        }
      }
    }

    // Signal-level rules
    const unusedSigs: typeof a.decls extends Map<string, infer D> ? D[] : never = [];
    const unreadSigs: typeof unusedSigs = [];
    for (const d of a.decls.values()) {
      if (d.kind !== "signal") continue;
      const drv = drivers.get(d.name) ?? [];
      const isRead = reads.has(d.name);
      if (!drv.length && isRead && !d.init) {
        add({
          rule: "undriven",
          category: "Connectivity",
          severity: "warning",
          file: a.file,
          line: d.line,
          title: `${d.name} is read but never driven`,
          message: "It stays at 'U' for the whole simulation, and synthesis ties it to a constant.",
          fix: `Assign it somewhere in ${a.name}, connect it to an instance output, or make it a constant.`,
        });
      } else if (!drv.length && !isRead) {
        unusedSigs.push(d);
      } else if (drv.length && !isRead) {
        unreadSigs.push(d);
      }
      const whole = drv.filter((x) => x.whole);
      const distinct = new Set(whole.map((x) => x.where));
      if (drv.length && drv.every((x) => x.whole) && distinct.size > 1) {
        add({
          rule: "multiple-drivers",
          category: "Connectivity",
          severity: "error",
          file: a.file,
          line: whole[1].line,
          title: `${d.name} has ${distinct.size} drivers`,
          message: `It is driven by ${[...distinct].join(" and ")}. Conflicting values resolve to 'X' in simulation, and synthesis rejects it.`,
          fix: "Drive it from one place. Merge the logic into one process, or use a multiplexer that selects between the sources.",
        });
      }
    }

    // Port-level rules
    if (ent) {
      for (const p of ent.ports) {
        const drv = drivers.get(p.name) ?? [];
        if ((p.mode === "in" || p.mode === "inout") && !reads.has(p.name) && !tb) {
          add({
            rule: "unused-input",
            category: "Connectivity",
            severity: "warning",
            file: ent.file,
            line: p.line,
            title: `Input ${p.name} of ${ent.name} is never used`,
            message: `Architecture ${a.name} never reads it, so whatever is connected has no effect${RESET_NAME.test(p.name) ? " — this unit ignores reset" : ""}.`,
            fix: RESET_NAME.test(p.name)
              ? `Use it, e.g. in the clocked process: if ${p.name} = '0' then <reset values> elsif rising_edge(clk) then …`
              : "Use it, or remove the port (and its connections).",
          });
        }
        if ((p.mode === "out" || p.mode === "buffer") && !drv.length) {
          add({
            rule: "undriven-output",
            category: "Connectivity",
            severity: "warning",
            file: ent.file,
            line: p.line,
            title: `Output ${p.name} of ${ent.name} is never driven`,
            message: "It reads 'U' wherever it is used.",
            fix: `Assign ${p.name} in architecture ${a.name}, or remove the port.`,
          });
        }
        if (p.mode === "out" && reads.has(p.name)) {
          add({
            rule: "read-output",
            category: "Style",
            severity: "info",
            file: ent.file,
            line: p.line,
            title: `Output ${p.name} is read inside ${ent.name}`,
            message: "Reading an out port is legal only in VHDL-2008; VHDL-93 tools reject it.",
            fix: `Compile with VHDL-2008, or use an internal signal (${p.name}_i) and assign ${p.name} <= ${p.name}_i;`,
          });
        }
      }
    }

    // Initial values (one finding per architecture)
    const inits = [...a.decls.values()].filter((d) => d.kind === "signal" && d.init);
    if (inits.length && !tb) {
      add({
        rule: "signal-init",
        category: "Style",
        severity: "info",
        file: a.file,
        line: inits[0].line,
        title: `${inits.length} signal${inits.length > 1 ? "s have" : " has"} initial values`,
        message: `${inits
          .slice(0, 6)
          .map((d) => d.name)
          .join(", ")}${inits.length > 6 ? "…" : ""}. FPGA tools load them at configuration, but ASIC flows ignore them, so the design may only work thanks to the initial value.`,
        fix: "Set these values in the reset branch instead, and keep initial values for simulation convenience only.",
      });
    }
    const list = (ds: { name: string }[]) => ds.slice(0, 8).map((d) => d.name).join(", ") + (ds.length > 8 ? ` and ${ds.length - 8} more` : "");
    if (unusedSigs.length) {
      add({
        rule: "unused-signal",
        category: "Style",
        severity: "info",
        file: a.file,
        line: unusedSigs[0].line,
        title: `${unusedSigs.length} signal${unusedSigs.length > 1 ? "s are" : " is"} never used`,
        message: `${list(unusedSigs)} ${unusedSigs.length > 1 ? "are" : "is"} declared but neither driven nor read.`,
        fix: "Remove the declarations.",
      });
    }
    if (unreadSigs.length) {
      add({
        rule: "unread-signal",
        category: "Style",
        severity: "info",
        file: a.file,
        line: unreadSigs[0].line,
        title: `${unreadSigs.length} signal${unreadSigs.length > 1 ? "s are" : " is"} driven but never read`,
        message: `${list(unreadSigs)}. The logic driving ${unreadSigs.length > 1 ? "them" : "it"} has no effect and is optimised away. Debug taps for the waveform viewer are fine to keep.`,
        fix: "Remove them, or connect them to what was meant to use them. Check especially control outputs like stall or enable signals.",
      });
    }
    const ints = [...a.decls.values()].filter((d) => d.kind === "signal" && d.type.length === 1 && d.type[0].v === "integer");
    if (ints.length) {
      add({
        rule: "integer-range",
        category: "Style",
        severity: "info",
        file: a.file,
        line: ints[0].line,
        title: `${ints.length} unconstrained integer signal${ints.length > 1 ? "s" : ""}`,
        message: `${list(ints)}: synthesis builds a 32-bit register for each.`,
        fix: "Constrain each to the range it needs.",
        fixCode: `signal ${ints[0].name} : integer range 0 to 7;`,
      });
    }
  }

  // Component declarations vs entities
  const usedIn = (c: Component) =>
    archs.some((a) => (a.components.includes(c) || packageComponents.includes(c)) && a.instances.some((i) => i.target === c.name && i.kind === "component"));
  const compsAll = [...packageComponents, ...archs.flatMap((a) => a.components)].filter(usedIn);
  const checkedComp = new Set<string>();
  for (const c of compsAll) {
    const e = entities.get(c.name);
    const key = `${c.file}:${c.line}`;
    if (!e || checkedComp.has(key)) continue;
    checkedComp.add(key);
    const ep = new Map(e.ports.map((p) => [p.name, p]));
    const cp = new Map(c.ports.map((p) => [p.name, p]));
    for (const p of e.ports) {
      if (cp.has(p.name)) continue;
      const fatal = p.mode === "in" && !p.defaultValue;
      add({
        rule: "component-mismatch",
        category: "Connectivity",
        severity: fatal ? "error" : "warning",
        file: c.file,
        line: c.line,
        title: `Component ${c.name} is missing port ${p.name}`,
        message: `Entity ${e.name} (${e.file}:${p.line}) has ${p.mode} port ${p.name}, but this component declaration doesn't. ${fatal ? "The input is left unbound and elaboration fails." : "It is left unbound — GHDL warns “port … is not bound”."}`,
        fix: `Copy the entity's port list into the component declaration, or instantiate with “entity work.${e.name}” and delete the component.`,
        fixCode: `${p.name} : ${p.mode} ${tokText(p.type)};`,
      });
    }
    for (const p of c.ports) {
      const q = ep.get(p.name);
      if (!q) {
        add({
          rule: "component-mismatch",
          category: "Connectivity",
          severity: "error",
          file: c.file,
          line: p.line,
          title: `Component ${c.name} declares port ${p.name}, which the entity doesn't have`,
          message: `Entity ${e.name} in ${e.file} has no port “${p.name}”. Binding fails.`,
          fix: `Remove ${p.name} from the component, or add it to the entity.`,
        });
        continue;
      }
      if (q.mode !== p.mode) {
        add({
          rule: "component-mismatch",
          category: "Connectivity",
          severity: "error",
          file: c.file,
          line: p.line,
          title: `Port ${p.name} is “${p.mode}” in the component but “${q.mode}” in the entity`,
          message: "Binding fails because port modes must match.",
          fix: `Change the component declaration to “${p.name} : ${q.mode} …”.`,
        });
      }
      // Only compare widths that don't depend on generics: instances may override those.
      const fixed: Env = { consts: new Map(packageConsts), subtypes: new Map(packageSubtypes) };
      const cw = typeWidth(p.type, fixed);
      const ew = typeWidth(q.type, fixed);
      if (cw !== null && ew !== null && cw !== ew) {
        add({
          rule: "component-mismatch",
          category: "Connectivity",
          severity: "error",
          file: c.file,
          line: p.line,
          title: `Port ${p.name} is ${cw} bits in the component but ${ew} in the entity`,
          message: `${c.name}'s declaration in ${c.file} disagrees with entity ${e.name} in ${e.file}.`,
          fix: "Make the widths (or the generic defaults) agree.",
        });
      }
    }
  }

  // Reset polarity across the design
  const lows = resetUses.filter((r) => r.level === "0");
  const highs = resetUses.filter((r) => r.level === "1");
  if (lows.length && highs.length) {
    const minority = lows.length < highs.length ? lows : highs;
    add({
      rule: "reset-polarity",
      category: "Processes",
      severity: "warning",
      file: minority[0].file,
      line: minority[0].line,
      title: "Reset polarity is mixed across the design",
      message: `${lows.length} process${lows.length > 1 ? "es treat" : " treats"} reset as active-low and ${highs.length} as active-high (minority: ${minority
        .slice(0, 4)
        .map((r) => `${r.file.split("/").pop()}:${r.line}`)
        .join(", ")}). Some blocks will be held in reset while others run.`,
      fix: "Pick one polarity for the whole design (the top level's reset port) and use it everywhere.",
    });
  }

  // Hierarchy, top, compile order
  const childrenOf = (e: string) => archs.filter((a) => a.entity === e).flatMap((a) => a.instances);
  const candidates = [...entities.values()].filter((e) => !instantiated.has(e.name) && !isTb(e.name) && archs.some((a) => a.entity === e.name));
  candidates.sort((x, y) => childrenOf(y.name).length - childrenOf(x.name).length);
  const top = candidates[0]?.name ?? null;
  const buildTree = (entity: string, label: string, seen: Set<string>): HierarchyNode => {
    const node: HierarchyNode = { entity, label, file: entities.get(entity)?.file ?? null, children: [] };
    if (seen.has(entity) || seen.size > 60) return node;
    const next = new Set(seen).add(entity);
    for (const i of childrenOf(entity)) node.children.push(buildTree(i.target, i.label, next));
    return node;
  };
  const hierarchy = top ? buildTree(top, top, new Set()) : null;

  const deps = new Map<string, Set<string>>();
  for (const f of files) {
    const d = new Set<string>();
    for (const a of f.architectures) {
      const ef = entities.get(a.entity)?.file;
      if (ef && ef !== f.path) d.add(ef);
      for (const i of a.instances) {
        const tf = entities.get(i.target)?.file;
        if (tf && tf !== f.path) d.add(tf);
      }
    }
    for (const u of f.uses) {
      const m = /^work\.([a-z0-9_]+)/.exec(u.name);
      const pf = m && files.find((x) => x.packages.some((p) => p.name === m[1]))?.path;
      if (pf && pf !== f.path) d.add(pf);
    }
    deps.set(f.path, d);
  }
  const order: string[] = [];
  const state = new Map<string, number>();
  let cyclic = false;
  const visit = (p: string) => {
    const st = state.get(p);
    if (st === 2) return;
    if (st === 1) {
      cyclic = true;
      return;
    }
    state.set(p, 1);
    for (const d of [...(deps.get(p) ?? [])].sort()) visit(d);
    state.set(p, 2);
    order.push(p);
  };
  for (const f of [...files].sort((x, y) => x.path.localeCompare(y.path))) {
    const onlyTb = f.entities.length && f.entities.every((e) => isTb(e.name));
    if (!onlyTb) visit(f.path);
  }
  const compileOrderNote = cyclic ? "Some files depend on each other in a cycle; the order shown breaks the cycle arbitrarily." : null;

  // Pipeline structure (depth-aware)
  const geo = geometry(depth);
  const foundPaths: string[] = [];
  const pairs: PipelineSummary["registersFound"] = [];
  for (const e of entities.values()) {
    const pair = pipelinePair(e.name);
    if (pair && !pairs.some((p) => p.pair === pair)) pairs.push({ pair, entity: e.name, file: e.file });
  }
  // Also count pipeline registers built inline in the top level (signals named like if_id_*).
  const inferred: Depth | null = pairs.length >= 4 ? (pairs.some((p) => /EX1|EX2/.test(p.pair)) || pairs.length >= 5 ? 6 : 5) : null;
  const expected = geo.registers.map((p) => p.toUpperCase());
  const stageWords: Record<string, RegExp[]> = {
    IF: [/^fetch(_stage)?$/, /fetch/],
    ID: [/^decode(_stage)?$/, /decode/],
    EX: [/^execute(_stage)?$/, /^ex(_stage)?$/, /execute(?!_?\d)/],
    EX1: [/^execute_?1(_stage)?$/, /execute_?1/],
    EX2: [/^execute_?2(_stage)?$/, /execute_?2/],
    MEM: [/^memory_stage$/, /^mem(_stage)?$/, /mem(ory)?_stage/],
    WB: [/^write_?back(_stage)?$/, /write_?back/],
  };
  const stages = geo.stages.map((s) => {
    for (const re of stageWords[s]) {
      const hit = [...entities.values()].find((e) => re.test(e.name));
      if (hit) return { stage: s, entity: hit.name };
    }
    return { stage: s, entity: null as string | null };
  });
  const fwd = [...entities.values()].find((e) => /forward/.test(e.name))?.name ?? null;
  const hz = [...entities.values()].find((e) => /hazard/.test(e.name))?.name ?? null;
  const pipeAnchor = pairs[0] ?? (top ? { file: entities.get(top)!.file, entity: top } : null);

  if (pipeAnchor) {
    if (inferred && inferred !== depth) {
      add({
        rule: "pipeline-depth",
        category: "Pipeline",
        severity: "warning",
        file: pipeAnchor.file,
        line: entities.get(pipeAnchor.entity)?.line ?? 1,
        title: `The code looks like a ${inferred}-stage pipeline, but ${depth} stages are selected`,
        message: `Pipeline registers found: ${pairs.map((p) => p.pair).join(", ")}. Timing estimates, the testbench length and the stage checks below assume ${depth} stages.`,
        fix: `Switch the depth to ${inferred} stages at the top of this page (and in the workbench), or add/remove the pipeline registers you intended.`,
      });
    }
    for (const want of expected) {
      if (pairs.some((p) => p.pair === want)) continue;
      add({
        rule: "pipeline-register-missing",
        category: "Pipeline",
        severity: inferred === depth || !inferred ? "warning" : "info",
        file: pipeAnchor.file,
        line: 1,
        title: `No ${want} pipeline register found`,
        message: `A ${depth}-stage pipeline (${geo.stages.join(" → ")}) needs a register between ${want.replace("/", " and ")}. None of the entities is named like it.`,
        fix: `Add an entity such as ${want.toLowerCase().replace("/", "_")}_register with clock, reset, stall and flush inputs, or rename the existing one so it can be found.`,
      });
    }
    for (const s of stages) {
      if (s.entity) continue;
      add({
        rule: "pipeline-stage-missing",
        category: "Pipeline",
        severity: "info",
        file: pipeAnchor.file,
        line: 1,
        title: `No separate entity for the ${s.stage} stage`,
        message: `Expected something named like “${s.stage === "WB" ? "writeback" : s.stage.toLowerCase()}_stage”. That's fine if the logic lives in the top level — this only affects how findable it is.`,
        fix: "Optional: keep each stage in its own entity so it can be reviewed and tested alone.",
      });
    }
    const wanted = activePaths(geo, forwarding);
    const fwdDesc = describeForwarding(geo, forwarding);
    const portsMention = (names: string, src: string) => {
      const [x, y] = src.toLowerCase().split("/");
      return new RegExp(`${x}_?${y}|${x}${y}`).test(names);
    };
    if (fwd) {
      const fe = entities.get(fwd)!;
      const names = fe.ports.map((p) => p.name).join(" ");
      foundPaths.push(...geo.forwardingSources.filter((src) => portsMention(names, src)));
      if (!wanted.length) {
        add({
          rule: "forwarding-unexpected",
          category: "Pipeline",
          severity: "info",
          file: fe.file,
          line: fe.line,
          title: "A forwarding unit exists, but forwarding is set to off",
          message: `The review and the timing estimate assume ${fwdDesc}. ${fwd} looks like it forwards from ${foundPaths.join(", ") || "later stages"}.`,
          fix: "If the design forwards, turn forwarding on and pick its paths in the settings at the top. If the unit is disabled on purpose, ignore this.",
        });
      } else {
        const missing = wanted.filter((src) => !foundPaths.includes(src));
        if (missing.length) {
          add({
            rule: "forwarding-sources",
            category: "Pipeline",
            severity: "warning",
            file: fe.file,
            line: fe.line,
            title: `Forwarding unit has no inputs from ${missing.join(", ")}`,
            message: `You selected ${fwdDesc}, but no port of ${fwd} is named after ${missing.join(", ")}. A dependent instruction that needs that path will read a stale register.`,
            fix: `Add the ${missing.join(" and ")} path(s) to the forwarding mux, or deselect them in the settings so the hazard unit is expected to stall instead.`,
          });
        }
        const extra = foundPaths.filter((src) => !wanted.includes(src));
        if (extra.length) {
          add({
            rule: "forwarding-extra",
            category: "Pipeline",
            severity: "info",
            file: fe.file,
            line: fe.line,
            title: `Forwarding unit also uses ${extra.join(", ")}`,
            message: `Those paths aren't in your forwarding selection (${fwdDesc}), so the timing estimate is more pessimistic than the design.`,
            fix: `Select ${extra.join(", ")} in the forwarding settings if the design really forwards from there.`,
          });
        }
      }
    } else if (wanted.length) {
      add({
        rule: "no-forwarding",
        category: "Pipeline",
        severity: "warning",
        file: pipeAnchor.file,
        line: 1,
        title: "Forwarding is selected, but no forwarding unit was found",
        message: `You selected ${fwdDesc}. Without a unit that bypasses results from ${wanted.join(", ")}, back-to-back dependent instructions read stale registers unless the hazard unit stalls them.`,
        fix: "Add a forwarding unit that compares the source registers in EX with destination registers in later pipeline registers — or select “No forwarding” if the design stalls instead.",
      });
    }
    if (!hz) {
      const noFwd = !wanted.length;
      add({
        rule: "no-hazard-unit",
        category: "Pipeline",
        severity: noFwd ? "warning" : "info",
        file: pipeAnchor.file,
        line: 1,
        title: "No hazard-detection unit found",
        message: noFwd
          ? `With ${fwdDesc}, every instruction that reads a register written by one of the previous ${geo.depth - 2} instructions must stall until write-back. Nothing in the design appears to do that.`
          : `A load's result is ready only after ${geo.stages[geo.memory]}, so a dependent instruction right behind it needs ${geo.memory - geo.execute} stall cycle(s) on ${depth} stages.`,
        fix: noFwd
          ? "Add a hazard unit that compares ID's source registers with the destinations in EX…WB and freezes PC and IF/ID until the value is written."
          : "Add a hazard unit that detects load-use and freezes PC and IF/ID while inserting a bubble.",
      });
    }
    for (const p of pairs) {
      const e = entities.get(p.entity)!;
      const names = e.ports.map((x) => x.name);
      if (!names.some((n) => /flush|stall|enable|(^|_)en$|clear|bubble|freeze|hold/.test(n))) {
        add({
          rule: "pipeline-register-control",
          category: "Pipeline",
          severity: "info",
          file: e.file,
          line: e.line,
          title: `${p.pair} register has no stall or flush input`,
          message: "Hazard handling needs to freeze (stall) or clear (flush) pipeline registers.",
          fix: "Add stall and flush inputs and gate the register update with them.",
        });
      }
      const ins = e.ports.filter((x) => x.mode === "in" && /_in$/.test(x.name)).map((x) => x.name.replace(/_in$/, ""));
      const outs = new Set(e.ports.filter((x) => x.mode === "out" && /_out$/.test(x.name)).map((x) => x.name.replace(/_out$/, "")));
      for (const f of ins) {
        if (outs.has(f)) continue;
        add({
          rule: "pipeline-field-dropped",
          category: "Pipeline",
          severity: "warning",
          file: e.file,
          line: e.ports.find((x) => x.name === `${f}_in`)!.line,
          title: `${p.pair} register takes ${f}_in but has no ${f}_out`,
          message: "The field is latched but never passed to the next stage, so later stages can't see it.",
          fix: `Add “${f}_out : out …” and assign it in the clocked process, or remove ${f}_in.`,
        });
      }
    }
  }

  const unparsed = files.filter((f) => !f.parsed).map((f) => f.path);
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const sev = { error: 0, warning: 1, info: 2 };
  findings.sort((x, y) => sev[x.severity] - sev[y.severity] || x.file.localeCompare(y.file) || x.line - y.line);

  return {
    files: files.length,
    lines: files.reduce((n, f) => n + f.lines.length, 0),
    entities: entities.size,
    architectures: archs.length,
    processes: processCount,
    instances: instanceCount,
    findings,
    counts,
    top,
    testbenches,
    hierarchy,
    compileOrder: order,
    compileOrderNote,
    pipeline: {
      selected: depth,
      inferred,
      registersFound: pairs,
      expected,
      stages,
      forwardingUnit: fwd,
      hazardUnit: hz,
      forwarding: { description: describeForwarding(geo, forwarding), selected: activePaths(geo, forwarding), found: foundPaths },
    },
    unparsed,
  };
}

function reviewProcess(
  p: Process,
  a: Architecture,
  where: string,
  assigned: Map<string, { line: number; whole: boolean }[]>,
  pReads: Set<string>,
  loopVars: Set<string>,
  ports: Map<string, Iface>,
  scopeType: (n: string) => Token[] | null,
  env: Env,
  tb: boolean,
  resetUses: { name: string; level: "0" | "1"; file: string; line: number }[],
  add: (f: Omit<Finding, "id" | "excerpt">) => void,
  checkWidth: (target: Token[], rhs: Token[], line: number, what: string) => void,
) {
  const edge = findEdge(p.body);
  const hasWait = JSON.stringify(p.body.map((s) => s.k)).includes("wait");
  const isSignal = (n: string) => (a.decls.get(n)?.kind === "signal" || (ports.has(n) && ports.get(n)!.mode !== "out")) && !p.variables.has(n) && !loopVars.has(n);

  // Width checks on simple assignments.
  const walk = (stmts: Stmt[]) => {
    for (const s of stmts) {
      if (s.k === "assign" && s.signal) checkWidth(s.targetTokens, s.rhs, s.line, "assignment");
      else if (s.k === "if") s.branches.forEach((b) => walk(b.body));
      else if (s.k === "case") s.alts.forEach(walk);
      else if (s.k === "loop") walk(s.body);
    }
  };
  walk(p.body);

  // case on a vector without "when others"
  const caseWalk = (stmts: Stmt[]) => {
    for (const s of stmts) {
      if (s.k === "case") {
        const sel = s.selector.filter((t) => !(t.k === "op" && (t.v === "(" || t.v === ")")));
        const ty = sel.length === 1 && sel[0].k === "id" ? scopeType(sel[0].v) : null;
        if (!s.hasOthers && ty && (typeWidth(ty, env) ?? 0) >= 1 && /std_u?logic/.test(ty[0].v)) {
          add({
            rule: "case-others",
            category: "Processes",
            severity: "error",
            file: a.file,
            line: s.line,
            title: "case on a std_logic value has no “when others”",
            message: `${sel[0].v} can also be 'U', 'X', 'Z' … so the choices can't be complete. VHDL compilers reject this.`,
            fix: "Add a final branch with safe defaults.",
            fixCode: "when others => null;  -- or the safe default assignments",
          });
        }
        s.alts.forEach(caseWalk);
      } else if (s.k === "if") s.branches.forEach((b) => caseWalk(b.body));
      else if (s.k === "loop") caseWalk(s.body);
    }
  };
  caseWalk(p.body);

  if (!tb && (p.afterLines.length || (hasWait && !edge))) {
    add({
      rule: "delay-in-rtl",
      category: "Processes",
      severity: "warning",
      file: a.file,
      line: p.afterLines[0] ?? p.line,
      title: "Timing statements in design code",
      message: "“after” delays and “wait for” are ignored by synthesis, so the hardware will behave differently from the simulation.",
      fix: "Keep delays in testbenches. In RTL, use clocked processes and counters.",
    });
  }

  if (edge) {
    if (edge.legacy) {
      add({
        rule: "legacy-edge",
        category: "Style",
        severity: "info",
        file: a.file,
        line: edge.line,
        title: `Old-style clock edge on ${edge.clock}`,
        message: `“${edge.clock}'event and ${edge.clock} = '1'” also fires on 'X'→'1' and 'U'→'1' transitions.`,
        fix: `Use ${edge.kind}_edge(${edge.clock}).`,
        fixCode: `elsif ${edge.kind}_edge(${edge.clock}) then`,
      });
    }
    // Async reset branch before the edge?
    let reset: { name: string; level: "0" | "1" } | null = null;
    const top = p.body.find((s) => s.k === "if" && s.branches.some((b) => edgeIn(b.cond, b.line)));
    if (top && top.k === "if") {
      const edgeIdx = top.branches.findIndex((b) => edgeIn(b.cond, b.line));
      if (edgeIdx > 0) reset = resetCond(top.branches[0].cond);
      // synchronous reset inside the edge branch
      const inner = top.branches[edgeIdx]?.body.find((s) => s.k === "if");
      const sync = inner && inner.k === "if" ? resetCond(inner.branches[0].cond) : null;
      for (const r of [reset, sync]) if (r) resetUses.push({ ...r, file: a.file, line: top.line });
      // branches after the edge branch
      for (const b of top.branches.slice(edgeIdx + 1)) {
        const as = assignsIn(b.body, new Map());
        if (as.size) {
          add({
            rule: "outside-edge",
            category: "Processes",
            severity: "warning",
            file: a.file,
            line: b.line,
            title: "Assignments after the clock-edge branch",
            message: `In ${where}, ${[...as.keys()].slice(0, 4).join(", ")} change on clock events that aren't ${edge.kind} edges. That is neither a flip-flop nor clean combinational logic.`,
            fix: "Move these assignments inside the edge branch, or into a separate combinational process.",
          });
        }
      }
    }
    const outside = p.body.filter((s) => s !== top && s.k === "assign" && s.signal);
    if (outside.length) {
      const names = [...new Set(outside.map((s) => (s.k === "assign" ? s.target : "")))];
      add({
        rule: "outside-edge",
        category: "Processes",
        severity: "warning",
        file: a.file,
        line: outside[0].line,
        title: `${names.length} signal${names.length > 1 ? "s" : ""} assigned outside the clock edge`,
        message: `In ${where}, ${names.slice(0, 5).join(", ")} ${names.length > 1 ? "are" : "is"} assigned on every event of the sensitivity list (both clock edges), not on the ${edge.kind} edge. In simulation they update twice per cycle; synthesis may build a latch or reject it.`,
        fix: `Move ${names.length > 1 ? "them" : "it"} inside “if ${edge.kind}_edge(${edge.clock}) then”, or into a separate combinational process.`,
      });
    }
    if (Array.isArray(p.sensitivity)) {
      const sens = new Set(p.sensitivity);
      if (!sens.has(edge.clock)) {
        add({
          rule: "sensitivity-clock",
          category: "Processes",
          severity: "error",
          file: a.file,
          line: p.sensLine,
          title: `Clocked process doesn't list ${edge.clock}`,
          message: `${where} waits for ${edge.kind}_edge(${edge.clock}) but ${edge.clock} isn't in its sensitivity list, so it never runs on the clock in simulation.`,
          fix: `Add ${edge.clock} to the sensitivity list.`,
          fixCode: `process (${[edge.clock, ...(reset ? [reset.name] : [])].join(", ")})`,
        });
      }
      if (reset && !sens.has(reset.name)) {
        add({
          rule: "sensitivity-reset",
          category: "Processes",
          severity: "warning",
          file: a.file,
          line: p.sensLine,
          title: `Asynchronous reset ${reset.name} missing from the sensitivity list`,
          message: "The reset only takes effect at the next clock edge in simulation, while hardware resets immediately.",
          fix: `Add ${reset.name} to the sensitivity list.`,
          fixCode: `process (${edge.clock}, ${reset.name})`,
        });
      }
      const extra = [...sens].filter((s) => s !== edge.clock && s !== reset?.name);
      if (extra.length && !outside.length) {
        add({
          rule: "sensitivity-extra",
          category: "Processes",
          severity: "info",
          file: a.file,
          line: p.sensLine,
          title: "Clocked process has extra signals in its sensitivity list",
          message: `${extra.join(", ")} only matter at the clock edge, so listing them just wakes the process for nothing.`,
          fix: `List only the clock${reset ? " and the asynchronous reset" : ""}.`,
          fixCode: `process (${[edge.clock, ...(reset ? [reset.name] : [])].join(", ")})`,
        });
      }
    }
    return;
  }

  if (hasWait) return; // wait-based process: no sensitivity list to check

  // Combinational process
  if (Array.isArray(p.sensitivity)) {
    const sens = new Set(p.sensitivity);
    const missing = [...pReads].filter((r) => isSignal(r) && !sens.has(r) && !assigned.has(r));
    if (missing.length) {
      add({
        rule: "sensitivity-incomplete",
        category: "Processes",
        severity: "warning",
        file: a.file,
        line: p.sensLine,
        title: `Sensitivity list is missing ${missing.length} signal${missing.length > 1 ? "s" : ""}`,
        message: `${where} reads ${missing.join(", ")} but doesn't re-run when ${missing.length > 1 ? "they change" : "it changes"}. Simulation then disagrees with the synthesised hardware.`,
        fix: "Add them, or use VHDL-2008 process(all) so the list can never go stale.",
        fixCode: `process (all)  -- or: process (${[...sens, ...missing].join(", ")})`,
      });
    }
    const unused = [...sens].filter((s) => !pReads.has(s));
    if (unused.length) {
      add({
        rule: "sensitivity-unused",
        category: "Style",
        severity: "info",
        file: a.file,
        line: p.sensLine,
        title: "Sensitivity list has signals the process never reads",
        message: `${unused.join(", ")} ${unused.length > 1 ? "are" : "is"} listed but not used in ${where}.`,
        fix: "Remove them from the list.",
      });
    }
  }
  const definite = definitelyAssigned(p.body);
  const latches = [...assigned.entries()].filter(([n, list]) => !definite.has(n) && list.some((x) => x.whole) && !p.variables.has(n));
  if (latches.length) {
    add({
      rule: "latch",
      category: "Processes",
      severity: "warning",
      file: a.file,
      line: latches[0][1][0].line,
      title: `Possible latch on ${latches.map(([n]) => n).slice(0, 4).join(", ")}${latches.length > 4 ? "…" : ""}`,
      message: `In ${where} (no clock edge), some paths through the if/case statements don't assign ${latches.length > 1 ? "these signals" : "this signal"}, so ${latches.length > 1 ? "they keep" : "it keeps"} the old value — synthesis infers a latch.`,
      fix: "Give every output a default at the top of the process, or assign it in every branch (add the missing else).",
      fixCode: latches
        .slice(0, 4)
        .map(([n]) => {
          const ty = scopeType(n);
          const w = ty ? typeWidth(ty, env) : null;
          return `${n} <= ${w === 1 ? "'0'" : "(others => '0')"};  -- default`;
        })
        .join("\n"),
    });
  }
}

/** Keep the finding list readable when one rule fires hundreds of times. */
export function groupFindings(findings: Finding[]) {
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const l = byFile.get(f.file) ?? [];
    l.push(f);
    byFile.set(f.file, l);
  }
  return byFile;
}

export type { Assoc };

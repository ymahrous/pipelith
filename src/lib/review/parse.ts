/**
 * Tolerant structural parser for VHDL: just enough of the grammar to review
 * a processor codebase — design units, interfaces, declarations, processes
 * (as statement trees), concurrent assignments and instances. It never
 * evaluates or executes anything.
 */
import { lex, type Token } from "./lexer";

/* ---------- model ---------- */

export interface Iface {
  name: string;
  mode: "in" | "out" | "inout" | "buffer" | "linkage";
  type: Token[];
  defaultValue: Token[] | null;
  line: number;
}

export interface Entity {
  name: string;
  file: string;
  line: number;
  generics: Iface[];
  ports: Iface[];
}

export interface Component extends Entity {
  /** Where it is declared: an architecture or package name. */
  scope: string;
}

export interface Decl {
  name: string;
  kind: "signal" | "constant" | "alias" | "variable";
  type: Token[];
  init: Token[] | null;
  line: number;
}

export type Stmt =
  | { k: "assign"; target: string; whole: boolean; signal: boolean; line: number; reads: string[]; rhs: Token[]; targetTokens: Token[] }
  | { k: "if"; line: number; branches: { cond: Token[]; body: Stmt[]; line: number }[]; hasElse: boolean }
  | { k: "case"; line: number; selector: Token[]; alts: Stmt[][]; hasOthers: boolean }
  | { k: "loop"; line: number; loopVar: string | null; body: Stmt[] }
  | { k: "wait"; line: number; hasFor: boolean; reads: string[] }
  | { k: "other"; line: number; reads: string[]; first: string };

export interface Process {
  label: string | null;
  line: number;
  endLine: number;
  sensitivity: string[] | "all" | null;
  sensLine: number;
  variables: Set<string>;
  body: Stmt[];
  afterLines: number[];
}

export interface Assoc {
  formal: string | null;
  formalPartial: boolean;
  actual: Token[];
  actualName: string | null;
  actualWhole: boolean;
  open: boolean;
  line: number;
}

export interface Instance {
  label: string;
  line: number;
  target: string;
  kind: "entity" | "component";
  generics: Assoc[];
  ports: Assoc[];
}

export interface ConcAssign {
  target: string;
  whole: boolean;
  line: number;
  reads: string[];
  rhs: Token[];
  targetTokens: Token[];
}

export interface Architecture {
  name: string;
  entity: string;
  file: string;
  line: number;
  endLine: number;
  decls: Map<string, Decl>;
  subtypes: Map<string, Token[]>;
  components: Component[];
  processes: Process[];
  assigns: ConcAssign[];
  instances: Instance[];
  /** Names read by concurrent statements outside processes (assert, generate conditions …). */
  reads: string[];
  /** Generate-loop variables (treated as constants). */
  loopVars: Set<string>;
}

export interface Package {
  name: string;
  file: string;
  line: number;
  components: Component[];
  decls: Map<string, Decl>;
  subtypes: Map<string, Token[]>;
}

export interface SyntaxIssue {
  line: number;
  message: string;
  fix: string;
}

export interface FileModel {
  path: string;
  lines: string[];
  entities: Entity[];
  architectures: Architecture[];
  packages: Package[];
  uses: { name: string; line: number }[];
  syntax: SyntaxIssue[];
  parsed: boolean;
}

/* ---------- block structure ---------- */

interface Block {
  kind: string;
  start: number;
  endTok: number; // index of "end"
  close: number; // index of the ";" after end
  line: number;
  endLine: number;
  parent: number;
  sawThen?: boolean;
}

const CLOSERS = new Set([
  "if", "case", "loop", "process", "generate", "block", "component", "record", "units",
  "function", "procedure", "entity", "architecture", "package", "protected", "configuration", "context", "for",
]);

function blockPass(t: Token[]) {
  const blocks: Block[] = [];
  const stack: number[] = [];
  const owner = new Int32Array(t.length).fill(-1);
  const issues: SyntaxIssue[] = [];
  const open = (kind: string, i: number) => {
    blocks.push({ kind, start: i, endTok: -1, close: -1, line: t[i].line, endLine: -1, parent: stack.length ? stack[stack.length - 1] : -1 });
    stack.push(blocks.length - 1);
  };
  const top = () => (stack.length ? blocks[stack[stack.length - 1]] : null);

  for (let i = 0; i < t.length; i++) {
    owner[i] = stack.length ? stack[stack.length - 1] : -1;
    const tok = t[i];
    if (tok.k !== "id") continue;
    const v = tok.v;
    const prev = t[i - 1];
    if (prev && prev.k === "id" && prev.v === "end") continue;
    const afterColon = prev?.k === "op" && prev.v === ":";

    if (v === "end") {
      const nx = t[i + 1];
      const kind = nx && nx.k === "id" && CLOSERS.has(nx.v) ? nx.v : null;
      let j = i;
      while (j < t.length && !(t[j].k === "op" && t[j].v === ";")) j++;
      // Recover from a forgotten "end …": if this end names an outer block, close the inner ones first.
      if (kind && stack.length && blocks[stack[stack.length - 1]].kind !== kind) {
        let match = -1;
        for (let s2 = stack.length - 1; s2 >= 0; s2--) {
          if (blocks[stack[s2]].kind === kind) {
            match = s2;
            break;
          }
        }
        if (match >= 0) {
          while (stack.length - 1 > match) {
            const inner = blocks[stack.pop()!];
            inner.endTok = i;
            inner.close = j;
            inner.endLine = tok.line;
            issues.push({
              line: inner.line,
              message: `The ${inner.kind} opened on line ${inner.line} is still open when “end ${kind}” is reached on line ${tok.line}.`,
              fix: `Add “end ${inner.kind};” before line ${tok.line}.`,
            });
          }
        }
      }
      const id = stack.pop();
      if (id === undefined) {
        issues.push({
          line: tok.line,
          message: `“end${kind ? " " + kind : ""}” has nothing to close.`,
          fix: "Remove it, or add the statement it was meant to close above it.",
        });
      } else {
        const b = blocks[id];
        b.endTok = i;
        b.close = j;
        b.endLine = tok.line;
        if (kind && kind !== b.kind) {
          issues.push({
            line: tok.line,
            message: `“end ${kind}” closes the ${b.kind} opened on line ${b.line}.`,
            fix: `Check that “end ${kind}” is meant to be “end ${b.kind}”, or add the missing “${kind}”.`,
          });
        }
      }
      for (let m = i; m <= j && m < t.length; m++) owner[m] = stack.length ? stack[stack.length - 1] : -1;
      i = j;
      continue;
    }

    switch (v) {
      case "process":
      case "case":
      case "loop":
      case "record":
      case "units":
        open(v, i);
        break;
      case "if":
        open("if", i);
        break;
      case "then": {
        const b = top();
        if (b?.kind === "if") b.sawThen = true;
        break;
      }
      case "generate": {
        const b = top();
        if (b && (b.kind === "if" || b.kind === "case") && !b.sawThen) b.kind = "generate";
        else open("generate", i);
        break;
      }
      case "block":
        if (afterColon) open("block", i);
        break;
      case "component":
        if (!afterColon) open("component", i);
        break;
      case "protected":
        open("protected", i);
        break;
      case "function":
      case "procedure": {
        let depth = 0;
        let isBody = false;
        for (let j = i + 1; j < t.length; j++) {
          const x = t[j];
          if (x.k === "op" && x.v === "(") depth++;
          else if (x.k === "op" && x.v === ")") depth--;
          else if (depth === 0 && x.k === "op" && x.v === ";") break;
          else if (depth === 0 && x.k === "id" && x.v === "is") {
            isBody = t[j + 1]?.v !== "new";
            break;
          }
        }
        if (isBody) open(v, i);
        break;
      }
      case "entity":
        if (!afterColon && t[i + 2]?.v === "is") open("entity", i);
        break;
      case "architecture":
      case "configuration":
        open(v, i);
        break;
      case "package": {
        const isAt = t[i + 1]?.v === "body" ? i + 3 : i + 2;
        if (t[isAt]?.v === "is" && t[isAt + 1]?.v !== "new") open("package", i);
        break;
      }
      case "context":
        if (t[i + 2]?.v === "is") open("context", i);
        break;
      case "for": {
        const b = top();
        if (b && (b.kind === "configuration" || b.kind === "for")) open("for", i);
        break;
      }
    }
  }
  for (const id of stack.reverse()) {
    const b = blocks[id];
    issues.push({
      line: b.line,
      message: `This ${b.kind} is never closed.`,
      fix: `Add “end ${b.kind};” where it should finish.`,
    });
  }
  return { blocks, owner, issues };
}

/* ---------- helpers ---------- */

const isOp = (t: Token | undefined, v: string) => !!t && t.k === "op" && t.v === v;
const isId = (t: Token | undefined, v?: string) => !!t && t.k === "id" && (v === undefined || t.v === v);

function matchParen(t: Token[], i: number, end = t.length): number {
  let d = 0;
  for (let j = i; j < end; j++) {
    if (isOp(t[j], "(")) d++;
    else if (isOp(t[j], ")")) {
      d--;
      if (d === 0) return j;
    }
  }
  return end - 1;
}

function splitTop(t: Token[], a: number, b: number, sep: string): [number, number][] {
  const out: [number, number][] = [];
  let d = 0;
  let s = a;
  for (let j = a; j < b; j++) {
    if (isOp(t[j], "(")) d++;
    else if (isOp(t[j], ")")) d--;
    else if (d === 0 && isOp(t[j], sep)) {
      out.push([s, j]);
      s = j + 1;
    }
  }
  if (s < b) out.push([s, b]);
  return out;
}

function findTop(t: Token[], a: number, b: number, pred: (x: Token) => boolean): number {
  let d = 0;
  for (let j = a; j < b; j++) {
    if (isOp(t[j], "(")) d++;
    else if (isOp(t[j], ")")) d--;
    else if (d === 0 && pred(t[j])) return j;
  }
  return -1;
}

/** Identifiers in a token range, skipping record fields after "." and attribute names after "'". */
function idsIn(t: Token[], a = 0, b = t.length): string[] {
  const out: string[] = [];
  for (let j = a; j < b; j++) {
    const x = t[j];
    if (x.k !== "id") continue;
    if (isOp(t[j - 1], ".") || isOp(t[j - 1], "'")) continue;
    // Named association inside a call/aggregate: "name =>" is a formal, not a read.
    if (isOp(t[j + 1], "=>")) continue;
    out.push(x.v);
  }
  return out;
}

export function tokText(t: Token[]): string {
  let s = "";
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    const prev = t[i - 1];
    const tight = !prev || isOp(prev, "(") || isOp(x, ")") || isOp(x, ",") || isOp(x, "'") || isOp(prev, "'") || isOp(x, ".") || isOp(prev, ".") || isOp(x, "(") && prev.k === "id";
    s += (tight ? "" : " ") + x.v;
  }
  return s.trim();
}

function parseIface(t: Token[], a: number, b: number, defaultMode: Iface["mode"]): Iface[] {
  const out: Iface[] = [];
  for (const [s, e] of splitTop(t, a, b, ";")) {
    let k = s;
    if (isId(t[k], "signal") || isId(t[k], "constant") || isId(t[k], "variable") || isId(t[k], "file")) k++;
    const colon = findTop(t, k, e, (x) => x.k === "op" && x.v === ":");
    if (colon < 0) continue;
    const names = t.slice(k, colon).filter((x) => x.k === "id").map((x) => x.v);
    let m = colon + 1;
    let mode: Iface["mode"] = defaultMode;
    if (t[m]?.k === "id" && ["in", "out", "inout", "buffer", "linkage"].includes(t[m].v)) {
      mode = t[m].v as Iface["mode"];
      m++;
    }
    const assign = findTop(t, m, e, (x) => x.k === "op" && x.v === ":=");
    const type = t.slice(m, assign < 0 ? e : assign);
    const def = assign < 0 ? null : t.slice(assign + 1, e);
    for (const n of names) out.push({ name: n, mode, type, defaultValue: def, line: t[k].line });
  }
  return out;
}

function parseInterfaces(t: Token[], a: number, b: number) {
  let generics: Iface[] = [];
  let ports: Iface[] = [];
  for (let j = a; j < b; j++) {
    if (isId(t[j], "generic") && isOp(t[j + 1], "(") && !isId(t[j + 1], "map")) {
      const c = matchParen(t, j + 1, b + 1);
      generics = parseIface(t, j + 2, c, "in");
      j = c;
    } else if (isId(t[j], "port") && isOp(t[j + 1], "(")) {
      const c = matchParen(t, j + 1, b + 1);
      ports = parseIface(t, j + 2, c, "in");
      j = c;
    }
  }
  return { generics, ports };
}

/* ---------- sequential statements ---------- */

class SeqParser {
  constructor(
    private t: Token[],
    private end: number,
  ) {}
  k = 0;

  seq(stop: Set<string>): Stmt[] {
    const out: Stmt[] = [];
    let guard = 0;
    while (this.k < this.end && guard++ < 100_000) {
      const x = this.t[this.k];
      if (x.k === "id" && stop.has(x.v)) return out;
      const s = this.stmt();
      if (s) out.push(s);
    }
    return out;
  }

  private toSemi(): number {
    const j = findTop(this.t, this.k, this.end, (x) => x.k === "op" && x.v === ";");
    return j < 0 ? this.end : j;
  }

  private stmt(): Stmt | null {
    const t = this.t;
    // label:
    if (t[this.k].k === "id" && isOp(t[this.k + 1], ":")) this.k += 2;
    const x = t[this.k];
    if (!x) return null;
    const line = x.line;
    if (isId(x, "if")) {
      const branches: { cond: Token[]; body: Stmt[]; line: number }[] = [];
      let hasElse = false;
      let kw = "if";
      for (;;) {
        if (kw === "else") {
          this.k++;
          const body = this.seq(new Set(["end"]));
          branches.push({ cond: [], body, line: t[this.k - 1]?.line ?? line });
          hasElse = true;
        } else {
          const th = findTop(t, this.k + 1, this.end, (y) => y.k === "id" && y.v === "then");
          const thenAt = th < 0 ? this.end : th;
          const cond = t.slice(this.k + 1, thenAt);
          this.k = thenAt + 1;
          const bl = t[this.k - 1]?.line ?? line;
          const body = this.seq(new Set(["elsif", "else", "end"]));
          branches.push({ cond, body, line: bl });
        }
        const nx = t[this.k];
        if (isId(nx, "elsif")) kw = "elsif";
        else if (isId(nx, "else")) kw = "else";
        else break;
      }
      this.k = this.toSemi() + 1; // end if [label];
      return { k: "if", line, branches, hasElse };
    }
    if (isId(x, "case")) {
      const isAt = findTop(t, this.k + 1, this.end, (y) => y.k === "id" && y.v === "is");
      const selector = t.slice(this.k + 1, isAt < 0 ? this.end : isAt);
      this.k = (isAt < 0 ? this.end : isAt) + 1;
      const alts: Stmt[][] = [];
      let hasOthers = false;
      while (isId(t[this.k], "when")) {
        const arrow = findTop(t, this.k + 1, this.end, (y) => y.k === "op" && y.v === "=>");
        const choice = t.slice(this.k + 1, arrow < 0 ? this.end : arrow);
        if (choice.some((c) => isId(c, "others"))) hasOthers = true;
        this.k = (arrow < 0 ? this.end : arrow) + 1;
        alts.push(this.seq(new Set(["when", "end"])));
      }
      this.k = this.toSemi() + 1;
      return { k: "case", line, selector, alts, hasOthers };
    }
    if (isId(x, "for") || isId(x, "while") || isId(x, "loop")) {
      let loopVar: string | null = null;
      if (isId(x, "for")) loopVar = t[this.k + 1]?.v ?? null;
      const lp = isId(x, "loop") ? this.k : findTop(t, this.k, this.end, (y) => y.k === "id" && y.v === "loop");
      this.k = (lp < 0 ? this.end : lp) + 1;
      const body = this.seq(new Set(["end"]));
      this.k = this.toSemi() + 1;
      return { k: "loop", line, loopVar, body };
    }
    const semi = this.toSemi();
    const span = t.slice(this.k, semi);
    this.k = semi + 1;
    if (isId(x, "wait")) {
      return { k: "wait", line, hasFor: span.some((y) => isId(y, "for")), reads: idsIn(span, 1) };
    }
    const statementKeyword = x.k === "id" && ["assert", "report", "return", "exit", "next", "null"].includes(x.v);
    const opAt = statementKeyword
      ? -1
      : span.findIndex((y, idx) => y.k === "op" && (y.v === "<=" || y.v === ":=") && depthAt(span, idx) === 0);
    if (opAt > 0) {
      const target = span.slice(0, opAt);
      const rhs = span.slice(opAt + 1);
      const base = target.find((y) => y.k === "id");
      if (base) {
        const indexReads = idsIn(target).slice(1);
        return {
          k: "assign",
          target: base.v,
          whole: target.length === 1,
          signal: span[opAt].v === "<=",
          line,
          reads: [...idsIn(rhs), ...indexReads],
          rhs,
          targetTokens: target,
        };
      }
    }
    return { k: "other", line, reads: idsIn(span), first: x.v };
  }
}

function depthAt(t: Token[], idx: number) {
  let d = 0;
  for (let j = 0; j < idx; j++) {
    if (isOp(t[j], "(")) d++;
    else if (isOp(t[j], ")")) d--;
  }
  return d;
}

/* ---------- file parser ---------- */

export function parseFile(path: string, text: string): FileModel {
  const lines = text.split(/\r?\n/);
  const { tokens: t, errors } = lex(text);
  const model: FileModel = { path, lines, entities: [], architectures: [], packages: [], uses: [], syntax: [], parsed: true };
  for (const e of errors) model.syntax.push({ line: e.line, message: e.message, fix: "Close the literal or comment on the same line." });
  const { blocks, owner, issues } = blockPass(t);
  model.syntax.push(...issues);
  if (issues.length) {
    model.parsed = false;
    return model;
  }
  const byStart = new Map<number, number>();
  blocks.forEach((b, i) => byStart.set(b.start, i));

  // use clauses
  for (let i = 0; i < t.length; i++) {
    if (isId(t[i], "use") && owner[i] === -1) {
      let j = i + 1;
      const parts: string[] = [];
      while (j < t.length && !isOp(t[j], ";")) {
        if (t[j].k === "id") parts.push(t[j].v);
        j++;
      }
      model.uses.push({ name: parts.join("."), line: t[i].line });
    }
  }

  blocks.forEach((b, id) => {
    if (b.kind === "entity" && b.parent === -1) {
      const { generics, ports } = parseInterfaces(t, b.start, b.endTok);
      model.entities.push({ name: t[b.start + 1].v, file: path, line: b.line, generics, ports });
    } else if (b.kind === "architecture" && b.parent === -1) {
      model.architectures.push(parseArchitecture(t, blocks, owner, byStart, id, path));
    } else if (b.kind === "package" && b.parent === -1 && !isId(t[b.start + 1], "body")) {
      const pkg: Package = { name: t[b.start + 1].v, file: path, line: b.line, components: [], decls: new Map(), subtypes: new Map() };
      parseDeclRegion(t, blocks, owner, byStart, id, b.start + 3, b.endTok, pkg.decls, pkg.subtypes, pkg.components, pkg.name, path);
      model.packages.push(pkg);
    }
  });
  return model;
}

function parseDeclRegion(
  t: Token[],
  blocks: Block[],
  owner: Int32Array,
  byStart: Map<number, number>,
  blockId: number,
  a: number,
  b: number,
  decls: Map<string, Decl>,
  subtypes: Map<string, Token[]>,
  components: Component[],
  scope: string,
  file: string,
) {
  let s = a;
  for (let k = a; k < b; k++) {
    const nested = byStart.get(k);
    if (nested !== undefined && blocks[nested].parent === blockId) {
      const nb = blocks[nested];
      if (nb.kind === "component") {
        const { generics, ports } = parseInterfaces(t, nb.start, nb.endTok);
        components.push({ name: t[nb.start + 1].v, file, line: nb.line, generics, ports, scope });
        k = nb.close;
        s = k + 1;
        continue;
      }
      if (nb.kind === "function" || nb.kind === "procedure" || nb.kind === "protected") {
        k = nb.close;
        s = k + 1;
        continue;
      }
      // records/units belong to the enclosing type declaration: skip to its end.
      k = nb.close;
      continue;
    }
    if (owner[k] !== blockId || !isOp(t[k], ";")) continue;
    const st = t.slice(s, k);
    s = k + 1;
    if (!st.length || st[0].k !== "id") continue;
    const kw = st[0].v;
    if (kw === "signal" || kw === "constant" || kw === "shared" || kw === "variable") {
      const off = kw === "shared" ? 2 : 1;
      const colon = st.findIndex((x) => isOp(x, ":"));
      if (colon < 0) continue;
      const names = st.slice(off, colon).filter((x) => x.k === "id").map((x) => x.v);
      const assign = findTop(st, colon + 1, st.length, (x) => isOp(x, ":="));
      const type = st.slice(colon + 1, assign < 0 ? st.length : assign);
      const init = assign < 0 ? null : st.slice(assign + 1);
      const dk: Decl["kind"] = kw === "constant" ? "constant" : kw === "signal" ? "signal" : "variable";
      for (const n of names) decls.set(n, { name: n, kind: dk, type, init, line: st[0].line });
    } else if (kw === "subtype" && isId(st[2], "is")) {
      subtypes.set(st[1].v, st.slice(3));
    } else if (kw === "alias" && st[1]) {
      decls.set(st[1].v, { name: st[1].v, kind: "alias", type: [], init: null, line: st[0].line });
    } else if (kw === "type" && isId(st[2], "is")) {
      // array types of vectors: remember as a subtype so widths stay unknown but names resolve.
      subtypes.set(st[1].v, st.slice(3));
    }
  }
}

function parseArchitecture(
  t: Token[],
  blocks: Block[],
  owner: Int32Array,
  byStart: Map<number, number>,
  id: number,
  file: string,
): Architecture {
  const b = blocks[id];
  const arch: Architecture = {
    name: t[b.start + 1].v,
    entity: t[b.start + 3]?.v ?? "",
    file,
    line: b.line,
    endLine: b.endLine,
    decls: new Map(),
    subtypes: new Map(),
    components: [],
    processes: [],
    assigns: [],
    instances: [],
    reads: [],
    loopVars: new Set(),
  };
  let begin = -1;
  for (let k = b.start; k < b.endTok; k++) {
    if (owner[k] === id && isId(t[k], "begin")) {
      begin = k;
      break;
    }
  }
  if (begin < 0) return arch;
  parseDeclRegion(t, blocks, owner, byStart, id, b.start + 5, begin, arch.decls, arch.subtypes, arch.components, arch.name, file);
  parseConcurrent(t, blocks, owner, byStart, id, begin + 1, b.endTok, arch);
  return arch;
}

function parseConcurrent(
  t: Token[],
  blocks: Block[],
  owner: Int32Array,
  byStart: Map<number, number>,
  regionId: number,
  a: number,
  b: number,
  arch: Architecture,
) {
  let s = a;
  for (let k = a; k < b; k++) {
    const nested = byStart.get(k);
    if (nested !== undefined && blocks[nested].parent === regionId) {
      const nb = blocks[nested];
      const label = s < k && t[s].k === "id" && isOp(t[s + 1], ":") ? t[s].v : null;
      if (nb.kind === "process") arch.processes.push(parseProcess(t, blocks, owner, nested, label));
      else if (nb.kind === "generate") {
        // header: for i in … generate | if cond generate
        const gen = findTop(t, s, nb.endTok, (x) => isId(x, "generate"));
        const header = t.slice(s, gen < 0 ? k : gen);
        const forAt = header.findIndex((x) => isId(x, "for"));
        if (forAt >= 0 && header[forAt + 1]) arch.loopVars.add(header[forAt + 1].v);
        arch.reads.push(...idsIn(header));
        let inner = (gen < 0 ? k : gen) + 1;
        for (let m = inner; m < nb.endTok; m++) {
          if (owner[m] === nested && isId(t[m], "begin")) {
            inner = m + 1;
            break;
          }
        }
        parseConcurrent(t, blocks, owner, byStart, nested, inner, nb.endTok, arch);
      } else if (nb.kind === "block") {
        let inner = nb.start + 1;
        for (let m = inner; m < nb.endTok; m++) {
          if (owner[m] === nested && isId(t[m], "begin")) {
            inner = m + 1;
            break;
          }
        }
        parseConcurrent(t, blocks, owner, byStart, nested, inner, nb.endTok, arch);
      }
      k = nb.close;
      s = k + 1;
      continue;
    }
    if (owner[k] !== regionId || !isOp(t[k], ";")) continue;
    const st = t.slice(s, k);
    s = k + 1;
    if (st.length) concurrentStatement(st, arch);
  }
}

function concurrentStatement(st: Token[], arch: Architecture) {
  let label: string | null = null;
  let i = 0;
  if (st[0].k === "id" && isOp(st[1], ":")) {
    label = st[0].v;
    i = 2;
  }
  if (isId(st[i], "postponed")) i++;
  const body = st.slice(i);
  if (!body.length) return;
  const head = body[0];
  if (isId(head, "assert")) {
    arch.reads.push(...idsIn(body, 1));
    return;
  }
  const mapAt = body.findIndex((x, idx) => isId(x, "map") && (isId(body[idx - 1], "port") || isId(body[idx - 1], "generic")));
  if (mapAt > 0) {
    arch.instances.push(parseInstance(body, label ?? `(line ${head.line})`, head.line));
    return;
  }
  if (isId(head, "with")) {
    const sel = body.findIndex((x) => isId(x, "select"));
    const le = body.findIndex((x) => isOp(x, "<="));
    if (sel > 0 && le > sel) {
      let ts = sel + 1;
      if (isOp(body[ts], "?")) ts++;
      const target = body.slice(ts, le);
      const base = target.find((x) => x.k === "id");
      if (base) {
        arch.assigns.push({
          target: base.v,
          whole: target.length === 1,
          line: head.line,
          reads: [...idsIn(body, 1, sel), ...idsIn(body, le + 1), ...idsIn(target).slice(1)],
          rhs: body.slice(le + 1),
          targetTokens: target,
        });
        return;
      }
    }
  }
  const le = findTop(body, 0, body.length, (x) => isOp(x, "<="));
  if (le > 0) {
    const target = body.slice(0, le);
    const base = target.find((x) => x.k === "id");
    if (base) {
      arch.assigns.push({
        target: base.v,
        whole: target.length === 1,
        line: head.line,
        reads: [...idsIn(body, le + 1), ...idsIn(target).slice(1)],
        rhs: body.slice(le + 1),
        targetTokens: target,
      });
      return;
    }
  }
  arch.reads.push(...idsIn(body));
}

function parseAssocList(t: Token[], a: number, b: number): Assoc[] {
  return splitTop(t, a, b, ",").map(([s, e]) => {
    const arrow = findTop(t, s, e, (x) => isOp(x, "=>"));
    const formalToks = arrow < 0 ? [] : t.slice(s, arrow);
    const actual = t.slice(arrow < 0 ? s : arrow + 1, e);
    const fid = formalToks.find((x) => x.k === "id");
    const open = actual.length === 1 && isId(actual[0], "open");
    const simple = actual.length >= 1 && actual[0].k === "id" && !open;
    return {
      formal: fid ? fid.v : null,
      formalPartial: formalToks.length > 1,
      actual,
      actualName: simple && (actual.length === 1 || isOp(actual[1], "(")) ? actual[0].v : null,
      actualWhole: simple && actual.length === 1,
      open,
      line: (t[s] ?? t[a]).line,
    };
  });
}

function parseInstance(body: Token[], label: string, line: number): Instance {
  let i = 0;
  let kind: Instance["kind"] = "component";
  if (isId(body[i], "entity")) {
    kind = "entity";
    i++;
  } else if (isId(body[i], "component")) i++;
  else if (isId(body[i], "configuration")) i++;
  // lib.name → name
  let target = body[i]?.v ?? "";
  if (isOp(body[i + 1], ".")) target = body[i + 2]?.v ?? target;
  let generics: Assoc[] = [];
  let ports: Assoc[] = [];
  for (let j = i; j < body.length; j++) {
    if (isId(body[j], "map") && isOp(body[j + 1], "(")) {
      const c = matchParen(body, j + 1);
      const list = parseAssocList(body, j + 2, c);
      if (isId(body[j - 1], "generic")) generics = list;
      else ports = list;
      j = c;
    }
  }
  return { label, line, target, kind, generics, ports };
}

function parseProcess(t: Token[], blocks: Block[], owner: Int32Array, id: number, label: string | null): Process {
  const b = blocks[id];
  let k = b.start + 1;
  let sensitivity: Process["sensitivity"] = null;
  const sensLine = t[b.start].line;
  if (isOp(t[k], "(")) {
    const c = matchParen(t, k, b.endTok);
    const names = idsIn(t, k + 1, c);
    sensitivity = names.length === 1 && names[0] === "all" ? "all" : names;
    k = c + 1;
  }
  let begin = -1;
  for (let m = k; m < b.endTok; m++) {
    if (owner[m] === id && isId(t[m], "begin")) {
      begin = m;
      break;
    }
  }
  const variables = new Set<string>();
  if (begin > 0) {
    let s = k;
    for (let m = k; m < begin; m++) {
      if (!isOp(t[m], ";")) continue;
      const st = t.slice(s, m);
      s = m + 1;
      if (isId(st[0], "variable") || isId(st[0], "constant")) {
        const colon = st.findIndex((x) => isOp(x, ":"));
        for (const x of st.slice(1, colon)) if (x.k === "id") variables.add(x.v);
      }
    }
  }
  const bodyToks = t.slice(begin + 1, b.endTok);
  const p = new SeqParser(bodyToks, bodyToks.length);
  const body = p.seq(new Set());
  const afterLines = bodyToks.filter((x) => isId(x, "after")).map((x) => x.line);
  return { label, line: b.line, endLine: b.endLine, sensitivity, sensLine, variables, body, afterLines };
}

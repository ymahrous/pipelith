/**
 * Verilog / SystemVerilog lexer and preprocessor (IEEE 1364-2005 and
 * 1800-2017 lexical rules, tolerant of errors).
 *
 * The preprocessor handles `define (with arguments), `undef, `ifdef / `ifndef /
 * `elsif / `else / `endif and `include, which is inlined when the file is in the
 * upload. Expansion is bounded so hostile macros can't blow up the tab.
 * Identifiers keep their case: Verilog is case-sensitive.
 */

export type VTokKind = "id" | "num" | "str" | "op" | "sys";

export interface VToken {
  k: VTokKind;
  v: string;
  line: number;
  col: number;
}

export interface VLexError {
  line: number;
  col: number;
  message: string;
}

interface Directive {
  k: "dir";
  v: string;
  arg: string;
  line: number;
  col: number;
}
interface MacroUse {
  k: "macro";
  v: string;
  line: number;
  col: number;
}
type Raw = VToken | Directive | MacroUse;

const OPS = [
  "<<<=", ">>>=", "===", "!==", "==?", "!=?", "<<<", ">>>", "<<=", ">>=", "->>", "<->", "|->", "|=>", "'{",
  "<=", ">=", "==", "!=", "&&", "||", "**", "<<", ">>", "~&", "~|", "~^", "^~", "+:", "-:", "->", "::", "++", "--",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", ".*", "##", "@@",
];
const SINGLE = "()[]{};:,.=+-*/%&|^~!?<>#@'$`";

/** Directives whose argument is the rest of the line. */
const LINE_DIRECTIVES = new Set(["define", "include", "timescale", "default_nettype", "line", "pragma", "begin_keywords", "unconnected_drive", "default_decay_time", "default_trireg_strength"]);
/** Directives that take one identifier. */
const NAME_DIRECTIVES = new Set(["ifdef", "ifndef", "elsif", "undef"]);
const BARE_DIRECTIVES = new Set([
  "else", "endif", "resetall", "celldefine", "endcelldefine", "nounconnected_drive", "end_keywords", "undefineall",
  "delay_mode_distributed", "delay_mode_path", "delay_mode_unit", "delay_mode_zero",
]);

function lexRaw(src: string, errors: VLexError[]): Raw[] {
  const out: Raw[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const col = (p: number) => p - lineStart + 1;
  const push = (k: VTokKind, v: string, start: number) => out.push({ k, v, line, col: col(start) });
  const isIdStart = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
  const isIdChar = (c: string) => isIdStart(c) || (c >= "0" && c <= "9") || c === "$";
  const isDigit = (c: string) => c >= "0" && c <= "9";

  /** Rest of the line from i (with \-newline continuations when `cont`), comments stripped. */
  const restOfLine = (cont: boolean): string => {
    let s = "";
    let inStr = false;
    while (i < n) {
      const c = src[i];
      if (c === "\n") {
        if (cont && s.endsWith("\\")) {
          s = s.slice(0, -1) + "\n";
          line++;
          i++;
          lineStart = i;
          continue;
        }
        break;
      }
      if (!inStr && c === "/" && src[i + 1] === "/") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (!inStr && c === "/" && src[i + 1] === "*") {
        i += 2;
        while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
          if (src[i] === "\n") {
            line++;
            lineStart = i + 1;
          }
          i++;
        }
        i += 2;
        s += " ";
        continue;
      }
      if (c === '"' && src[i - 1] !== "\\") inStr = !inStr;
      s += c;
      i++;
    }
    return s.trim();
  };

  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v" || c === " ") {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const startLine = line;
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") {
          line++;
          lineStart = i + 1;
        }
        i++;
      }
      if (i >= n) errors.push({ line: startLine, col: 1, message: "Block comment /* … is never closed with */." });
      i += 2;
      continue;
    }
    const start = i;
    // Attributes (* … *) are skipped; "(*)" is the event control @(*).
    if (c === "(" && src[i + 1] === "*") {
      let j = i + 2;
      while (j < n && (src[j] === " " || src[j] === "\t")) j++;
      if (src[j] === ")") {
        push("op", "(", start);
        push("op", "*", start + 1);
        push("op", ")", j);
        i = j + 1;
        continue;
      }
      const attrStart = i;
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === ")")) {
        if (src[i] === "\n") {
          line++;
          lineStart = i + 1;
        }
        i++;
      }
      i += 2;
      // (* full_case *) right before a case statement: synthesis treats the case as complete.
      if (/full_case/.test(src.slice(attrStart, i)) && /^\s*(case|casez|casex)\b/.test(src.slice(i, i + 40))) push("op", "(*full_case*)", attrStart);
      continue;
    }
    // Compiler directives and macro uses.
    if (c === "`") {
      if (isIdStart(src[i + 1] ?? "")) {
        let j = i + 1;
        while (j < n && isIdChar(src[j])) j++;
        const name = src.slice(i + 1, j);
        i = j;
        if (LINE_DIRECTIVES.has(name)) {
          const d: Directive = { k: "dir", v: name, arg: "", line, col: col(start) };
          d.arg = restOfLine(name === "define");
          out.push(d);
        } else if (NAME_DIRECTIVES.has(name)) {
          while (i < n && (src[i] === " " || src[i] === "\t")) i++;
          let k = i;
          while (k < n && isIdChar(src[k])) k++;
          out.push({ k: "dir", v: name, arg: src.slice(i, k), line, col: col(start) });
          i = k;
        } else if (BARE_DIRECTIVES.has(name)) {
          out.push({ k: "dir", v: name, arg: "", line, col: col(start) });
        } else if (name === "__LINE__") {
          push("num", String(line), start);
        } else if (name === "__FILE__") {
          push("str", '"file"', start);
        } else {
          out.push({ k: "macro", v: name, line, col: col(start) });
        }
        continue;
      }
      push("op", "`", start);
      i++;
      continue;
    }
    // Identifiers and keywords.
    if (isIdStart(c)) {
      while (i < n && isIdChar(src[i])) i++;
      push("id", src.slice(start, i), start);
      continue;
    }
    // Escaped identifier: \name up to white space.
    if (c === "\\") {
      i++;
      while (i < n && !/\s/.test(src[i])) i++;
      push("id", src.slice(start + 1, i), start);
      continue;
    }
    // System tasks and functions.
    if (c === "$" && isIdChar(src[i + 1] ?? "") && !isDigit(src[i + 1])) {
      i++;
      while (i < n && isIdChar(src[i])) i++;
      push("sys", src.slice(start, i), start);
      continue;
    }
    // Numbers: 12, 1.5e3, 8'hFF, 'b101, '0, 10ns.
    if (isDigit(c) || (c === "'" && /^'[sS]?[bBoOdDhH]|^'[01xXzZ](?![A-Za-z0-9_])/.test(src.slice(i, i + 3)))) {
      if (isDigit(c)) {
        while (i < n && (isDigit(src[i]) || src[i] === "_")) i++;
        if (src[i] === "." && isDigit(src[i + 1] ?? "")) {
          i++;
          while (i < n && (isDigit(src[i]) || src[i] === "_")) i++;
        }
        if ((src[i] === "e" || src[i] === "E") && /[-+0-9]/.test(src[i + 1] ?? "")) {
          i += 2;
          while (i < n && isDigit(src[i])) i++;
        }
        const unit = /^(fs|ps|ns|us|ms|s|step)(?![A-Za-z0-9_$])/.exec(src.slice(i, i + 5));
        if (unit) i += unit[0].length;
      }
      // Optional base: [size] ' [s] base digits (white space allowed around the base).
      let j = i;
      while (j < n && (src[j] === " " || src[j] === "\t")) j++;
      if (src[j] === "'" && /^[sS]?[bBoOdDhH]/.test(src.slice(j + 1, j + 3))) {
        j++;
        if (src[j] === "s" || src[j] === "S") j++;
        j++;
        while (j < n && (src[j] === " " || src[j] === "\t")) j++;
        while (j < n && /[0-9a-fA-F_xXzZ?]/.test(src[j])) j++;
        i = j;
      } else if (c === "'") {
        i += 2; // '0 '1 'x 'z
      }
      push("num", src.slice(start, i).replace(/\s+/g, ""), start);
      continue;
    }
    if (c === '"') {
      i++;
      for (;;) {
        if (i >= n || src[i] === "\n") {
          errors.push({ line, col: col(start), message: "String literal is not closed on this line." });
          break;
        }
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      push("str", src.slice(start, i), start);
      continue;
    }
    let matched = "";
    for (const op of OPS) {
      if (src.startsWith(op, i)) {
        matched = op;
        break;
      }
    }
    if (matched) {
      push("op", matched, start);
      i += matched.length;
      continue;
    }
    if (SINGLE.includes(c)) {
      push("op", c, start);
      i++;
      continue;
    }
    errors.push({ line, col: col(start), message: `Unexpected character “${c}”.` });
    i++;
  }
  return out;
}

/* ---------- preprocessor ---------- */

export interface Macro {
  params: string[] | null;
  body: Raw[];
}

export interface IncludeRef {
  name: string;
  line: number;
  /** Path of the uploaded file it resolved to. */
  path: string | null;
}

export interface Preprocessed {
  tokens: VToken[];
  /** A macro was used that no file defines: what it expands to is unknown. */
  unknownMacros: boolean;
  errors: VLexError[];
  includes: IncludeRef[];
  /** Line of the first `timescale (in this file or a header it includes). */
  timescale: number | null;
  /** `default_nettype changes, by position in the token stream. */
  nettype: { at: number; value: string; line: number }[];
  defines: Map<string, Macro>;
}

export interface PreprocessHost {
  /** Resolve an `include name to an uploaded file. */
  include?: (name: string, from: string) => { path: string; text: string } | null;
  /** Macros defined anywhere in the upload, for files that rely on another file's `define. */
  fallback?: Map<string, Macro>;
}

export const MAX_TOKENS = 600_000;
const MAX_DEPTH = 16;
const MAX_INCLUDE_DEPTH = 8;

/** Lex and preprocess one file. */
export function preprocess(path: string, text: string, host: PreprocessHost = {}): Preprocessed {
  const errors: VLexError[] = [];
  const res: Preprocessed = { tokens: [], unknownMacros: false, errors, includes: [], timescale: null, nettype: [], defines: new Map() };
  const out = res.tokens;
  let budget = MAX_TOKENS;
  let overflow = false;

  const emit = (t: VToken) => {
    if (budget-- <= 0) {
      if (!overflow) errors.push({ line: t.line, col: 1, message: "Macro expansion produces too much code; the rest of the file was not reviewed." });
      overflow = true;
      return;
    }
    out.push(t);
  };

  const parseDefine = (d: Directive) => {
    const m = /^([A-Za-z_][A-Za-z0-9_$]*)(\([^)]*\))?\s*([\s\S]*)$/.exec(d.arg);
    if (!m) return;
    const params = m[2]
      ? m[2]
          .slice(1, -1)
          .split(",")
          .map((p) => p.trim().replace(/\s*=.*$/, ""))
          .filter(Boolean)
      : null;
    const sub: VLexError[] = [];
    res.defines.set(m[1], { params, body: lexRaw(m[3] ?? "", sub) });
  };

  /** Expand a token list (macro body or file) at `useLine` (null: keep the tokens' own lines). */
  const run = (raw: Raw[], useLine: number | null, depth: number, file: string, incDepth: number) => {
    const cond: { active: boolean; taken: boolean; parent: boolean }[] = [];
    const active = () => (cond.length ? cond[cond.length - 1].active : true);
    for (let p = 0; p < raw.length && !overflow; p++) {
      const t = raw[p];
      if (t.k === "dir") {
        switch (t.v) {
          case "ifdef":
          case "ifndef": {
            const parent = active();
            const def = res.defines.has(t.arg);
            const on = parent && (t.v === "ifdef" ? def : !def);
            cond.push({ active: on, taken: on, parent });
            continue;
          }
          case "elsif": {
            const top = cond[cond.length - 1];
            if (!top) {
              errors.push({ line: t.line, col: t.col, message: "`elsif without a matching `ifdef." });
              continue;
            }
            const on = top.parent && !top.taken && res.defines.has(t.arg);
            top.active = on;
            top.taken ||= on;
            continue;
          }
          case "else": {
            const top = cond[cond.length - 1];
            if (!top) {
              errors.push({ line: t.line, col: t.col, message: "`else without a matching `ifdef." });
              continue;
            }
            top.active = top.parent && !top.taken;
            top.taken = true;
            continue;
          }
          case "endif":
            if (!cond.pop()) errors.push({ line: t.line, col: t.col, message: "`endif without a matching `ifdef." });
            continue;
        }
        if (!active()) continue;
        const line = useLine ?? t.line;
        switch (t.v) {
          case "define":
            parseDefine(t);
            break;
          case "undef":
            res.defines.delete(t.arg);
            break;
          case "undefineall":
            res.defines.clear();
            break;
          case "timescale":
            res.timescale ??= line;
            break;
          case "default_nettype":
            res.nettype.push({ at: out.length, value: t.arg.trim().split(/\s+/)[0] ?? "wire", line });
            break;
          case "resetall":
            res.nettype.push({ at: out.length, value: "wire", line });
            break;
          case "include": {
            const name = /^["<]([^">]+)[">]/.exec(t.arg)?.[1] ?? t.arg;
            const found = incDepth < MAX_INCLUDE_DEPTH ? (host.include?.(name, file) ?? null) : null;
            res.includes.push({ name, line, path: found?.path ?? null });
            if (found) run(lexRaw(found.text, []), line, depth, found.path, incDepth + 1);
            break;
          }
        }
        continue;
      }
      if (!active()) continue;
      if (t.k === "macro") {
        const m = res.defines.get(t.v) ?? host.fallback?.get(t.v);
        const line = useLine ?? t.line;
        if (!m || depth >= MAX_DEPTH) {
          // Unknown macro: a placeholder; its arguments stay, so the names in them still count.
          emit({ k: "id", v: "`" + t.v, line, col: t.col });
          res.unknownMacros = true;
          continue;
        }
        let body = m.body;
        if (m.params) {
          if (!(raw[p + 1]?.k === "op" && (raw[p + 1] as VToken).v === "(")) {
            emit({ k: "id", v: "`" + t.v, line, col: t.col });
            continue;
          }
          const { args, end } = collectArgs(raw, p + 1);
          p = end;
          const bind = new Map(m.params.map((name, idx) => [name, args[idx] ?? []]));
          body = m.body.flatMap((b) => (b.k === "id" && bind.has(b.v) ? bind.get(b.v)! : [b]));
        }
        run(body, line, depth + 1, file, incDepth);
        continue;
      }
      emit(useLine === null ? t : { ...t, line: useLine });
    }
    if (cond.length && useLine === null) {
      errors.push({ line: raw[raw.length - 1]?.line ?? 1, col: 1, message: "`ifdef is never closed with `endif." });
    }
  };

  run(lexRaw(text, errors), null, 0, path, 0);
  return res;
}

function collectArgs(raw: Raw[], open: number): { args: Raw[][]; end: number } {
  const args: Raw[][] = [[]];
  let d = 0;
  for (let j = open; j < raw.length; j++) {
    const t = raw[j];
    const op = t.k === "op" ? t.v : "";
    if (op === "(" || op === "[" || op === "{") {
      d++;
      if (d === 1) continue;
    } else if (op === ")" || op === "]" || op === "}") {
      d--;
      if (d === 0) return { args, end: j };
    } else if (op === "," && d === 1) {
      args.push([]);
      continue;
    }
    args[args.length - 1].push(t);
  }
  return { args, end: raw.length - 1 };
}

/** Macros a file defines, without expanding anything else (for the cross-file fallback). */
export function collectDefines(text: string): Map<string, Macro> {
  return preprocess("", text).defines;
}

/* ---------- keywords ---------- */

const KEYWORDS = new Set(
  (
    "accept_on alias always always_comb always_ff always_latch and assert assign assume automatic before begin bind bins binsof bit break buf bufif0 bufif1 byte case casex casez cell chandle checker class clocking cmos config const constraint context continue cover covergroup coverpoint cross deassign default defparam design disable dist do edge else end endcase endchecker endclass endclocking endconfig endfunction endgenerate endgroup endinterface endmodule endpackage endprimitive endprogram endproperty endspecify endsequence endtable endtask enum event eventually expect export extends extern final first_match for force foreach forever fork forkjoin function generate genvar global highz0 highz1 if iff ifnone ignore_bins illegal_bins implements implies import incdir include initial inout input inside instance int integer interconnect interface intersect join join_any join_none large let liblist library local localparam logic longint macromodule matches medium modport module nand negedge nettype new nexttime nmos nor noshowcancelled not notif0 notif1 null or output package packed parameter pmos posedge primitive priority program property protected pull0 pull1 pulldown pullup pulsestyle_ondetect pulsestyle_onevent pure rand randc randcase randsequence rcmos real realtime ref reg reject_on release repeat restrict return rnmos rpmos rtran rtranif0 rtranif1 s_always s_eventually s_nexttime s_until s_until_with scalared sequence shortint shortreal showcancelled signed small soft solve specify specparam static string strong strong0 strong1 struct super supply0 supply1 sync_accept_on sync_reject_on table tagged task this throughout time timeprecision timeunit tran tranif0 tranif1 tri tri0 tri1 triand trior trireg type typedef union unique unique0 unsigned until until_with untyped use uwire var vectored virtual void wait wait_order wand weak weak0 weak1 while wildcard wire with within wor xnor xor"
  ).split(" "),
);

export function isVKeyword(v: string): boolean {
  return KEYWORDS.has(v);
}

/** Built-in gate and switch primitives: instantiated like modules, never defined in the upload. */
export const PRIMITIVES = new Set(
  "and nand or nor xor xnor buf not bufif0 bufif1 notif0 notif1 pullup pulldown nmos pmos rnmos rpmos cmos rcmos tran rtran tranif0 tranif1 rtranif0 rtranif1".split(" "),
);

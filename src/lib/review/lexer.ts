/** VHDL lexer (IEEE 1076-2008 lexical rules, tolerant of errors). */

export type TokKind = "id" | "num" | "str" | "chr" | "bits" | "op";

export interface Token {
  k: TokKind;
  /** Lower-cased for identifiers; verbatim otherwise. */
  v: string;
  line: number;
  col: number;
}

export interface LexError {
  line: number;
  col: number;
  message: string;
}

const TWO_CHAR = new Set(["<=", ":=", "=>", "/=", ">=", "**", "??", "<<", ">>", "?=", "<>"]);

export function lex(src: string): { tokens: Token[]; errors: LexError[] } {
  const tokens: Token[] = [];
  const errors: LexError[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const n = src.length;
  const push = (k: TokKind, v: string, start: number) => tokens.push({ k, v, line, col: start - lineStart + 1 });

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
    // -- comment
    if (c === "-" && src[i + 1] === "-") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    // /* block comment */ (VHDL-2008)
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
    // identifier, possibly a bit-string prefix (x"..", b"..", o"..", 12ux"..")
    if (/[A-Za-z]/.test(c)) {
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
      const word = src.slice(start, i);
      if (src[i] === '"' && /^(b|o|x|d|ub|uo|ux|sb|so|sx)$/i.test(word)) {
        i++;
        while (i < n && src[i] !== '"' && src[i] !== "\n") i++;
        if (src[i] !== '"') errors.push({ line, col: start - lineStart + 1, message: "Bit-string literal is not closed." });
        i++;
        push("bits", src.slice(start, i), start);
        continue;
      }
      push("id", word.toLowerCase(), start);
      continue;
    }
    // extended identifier \foo\
    if (c === "\\") {
      i++;
      while (i < n && src[i] !== "\\" && src[i] !== "\n") i++;
      i++;
      push("id", src.slice(start, i), start);
      continue;
    }
    // numbers, including based literals 16#FF# and sized bit strings 8x"FF"
    if (/[0-9]/.test(c)) {
      while (i < n && /[0-9_]/.test(src[i])) i++;
      if (src[i] === "#") {
        i++;
        while (i < n && /[0-9A-Fa-f_.]/.test(src[i])) i++;
        if (src[i] === "#") i++;
        push("num", src.slice(start, i), start);
        continue;
      }
      if (/[A-Za-z]/.test(src[i] ?? "") && src.slice(i).match(/^(b|o|x|d|ub|uo|ux|sb|so|sx)"/i)) {
        while (src[i] !== '"') i++;
        i++;
        while (i < n && src[i] !== '"' && src[i] !== "\n") i++;
        i++;
        push("bits", src.slice(start, i), start);
        continue;
      }
      if (src[i] === "." && /[0-9]/.test(src[i + 1] ?? "")) {
        i++;
        while (i < n && /[0-9_]/.test(src[i])) i++;
      }
      if (/[eE]/.test(src[i] ?? "") && /[-+0-9]/.test(src[i + 1] ?? "")) {
        i += 2;
        while (i < n && /[0-9]/.test(src[i])) i++;
      }
      push("num", src.slice(start, i), start);
      continue;
    }
    if (c === '"') {
      i++;
      for (;;) {
        if (i >= n || src[i] === "\n") {
          errors.push({ line, col: start - lineStart + 1, message: "String literal is not closed on this line." });
          break;
        }
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      push("str", src.slice(start, i), start);
      continue;
    }
    if (c === "'") {
      const prev = tokens[tokens.length - 1];
      const attributeTick = prev && (prev.k === "id" || (prev.k === "op" && (prev.v === ")" || prev.v === "]"))) && !isKeyword(prev.v);
      if (!attributeTick && src[i + 2] === "'" && src[i + 1] !== "\n") {
        push("chr", src.slice(i, i + 3), start);
        i += 3;
        continue;
      }
      push("op", "'", start);
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR.has(two)) {
      push("op", two, start);
      i += 2;
      continue;
    }
    if ("()[];:,.&|+-*/<>=@#?^`".includes(c)) {
      push("op", c, start);
      i++;
      continue;
    }
    errors.push({ line, col: start - lineStart + 1, message: `Unexpected character “${c}”.` });
    i++;
  }
  return { tokens, errors };
}

const KEYWORDS = new Set(
  (
    "abs access after alias all and architecture array assert assume attribute begin block body buffer bus case component configuration constant context cover default disconnect downto else elsif end entity exit fairness file for force function generate generic group guarded if impure in inertial inout is label library linkage literal loop map mod nand new next nor not null of on open or others out package parameter port postponed procedure process property protected pure range record register reject release rem report restrict return rol ror select sequence severity shared signal sla sll sra srl strong subtype then to transport type unaffected units until use variable vmode vprop vunit wait when while with xnor xor"
  ).split(" "),
);

export function isKeyword(v: string) {
  return KEYWORDS.has(v);
}

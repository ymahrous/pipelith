/**
 * Assembler — bit-for-bit compatible with src/assembler/assembler.py from the
 * reference project, plus diagnostics the Python tool does not give:
 * every error is collected (not just the first), and silent behaviours such as
 * overlapping .ORG regions or a bare "ADD" being read as hex data are flagged.
 */
import type { InstructionDef, ProcessorProfile } from "../isa/profile";

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  line: number; // 1-based source line
  severity: Severity;
  code: string;
  message: string;
}

export interface SourceLine {
  line: number;
  code: string; // source with the comment removed, trimmed
  comment: string; // comment text without the marker
}

export interface AddressInfo {
  line: number;
  kind: "instruction" | "immediate" | "data";
  text: string;
}

export interface AssemblyResult {
  ok: boolean;
  /** Sparse memory image: address → 32-bit word. */
  memory: Map<number, number>;
  /** Address → origin in the source. */
  sourceMap: Map<number, AddressInfo>;
  /** Source line → first address emitted by that line. */
  lineAddress: Map<number, number>;
  lines: SourceLine[];
  diagnostics: Diagnostic[];
  highestAddress: number;
}

const REGISTER_RE = /^R([0-7])$/i;
const HEX_RE = /^[+-]?(0x)?[0-9a-f]+(_[0-9a-f]+)*$/i;
const DATA_LINE_RE = /^(0x)?[0-9A-Fa-f]+$/;
const MEM_OPERAND_RE = /^(.+)\((R[0-7])\)$/i;

/** Hard limits that keep a hostile or accidental input from locking up the tab. */
export const MAX_SOURCE_BYTES = 512 * 1024;
export const MAX_SOURCE_LINES = 20000;

class AsmError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

export function parseHex(token: string): number {
  const t = token.trim();
  if (!HEX_RE.test(t)) throw new AsmError(`'${token}' is not a hex number`, "bad-number");
  const negative = t.startsWith("-");
  const digits = t.replace(/^[+-]/, "").replace(/^0x/i, "").replace(/_/g, "");
  // Parse with BigInt so values wider than 2^53 are masked exactly like Python.
  let v = BigInt("0x" + digits);
  if (negative) v = -v;
  return Number(BigInt.asUintN(32, v));
}

function hexValueBig(token: string): bigint {
  const digits = token.trim().replace(/^[+-]/, "").replace(/^0x/i, "").replace(/_/g, "");
  return BigInt("0x" + digits);
}

export function parseReg(token: string | undefined): number {
  if (token === undefined) throw new AsmError("missing register operand", "missing-operand");
  const m = REGISTER_RE.exec(token.trim());
  if (!m) throw new AsmError(`invalid register '${token}' (must be R0–R7)`, "bad-register");
  return Number(m[1]);
}

/** Split a source line into code and comment, mirroring the Python preprocessor. */
export function splitComment(raw: string): { code: string; comment: string } {
  let cut = raw.length;
  let markerLen = 0;
  for (const marker of [";", "#", "//"]) {
    const i = raw.indexOf(marker);
    if (i !== -1 && i < cut) {
      cut = i;
      markerLen = marker.length;
    }
  }
  const code = raw.slice(0, cut).replace(/\bINT([0-3])\b/gi, "INT $1").trim();
  const comment = cut < raw.length ? raw.slice(cut + markerLen).trim() : "";
  return { code, comment };
}

export function preprocess(source: string): SourceLine[] {
  const out: SourceLine[] = [];
  const rows = source.split(/\r?\n/);
  rows.forEach((raw, i) => {
    const { code, comment } = splitComment(raw);
    if (code || comment) out.push({ line: i + 1, code, comment });
  });
  return out;
}

interface Encoded {
  words: number[];
  warnings: { code: string; message: string }[];
}

function need(args: string[], n: number, def: InstructionDef) {
  if (args.length < n) {
    throw new AsmError(
      `${def.mnemonic} expects ${n} operand${n === 1 ? "" : "s"}: ${def.syntax}`,
      "missing-operand",
    );
  }
}

export function encodeInstruction(line: string, profile: ProcessorProfile): Encoded {
  const parts = line.split(/[,\s]+/).filter(Boolean);
  const mnem = parts[0].toUpperCase();
  const args = parts.slice(1);
  const def = profile.instructions.find((d) => d.mnemonic === mnem);
  if (!def) throw new AsmError(`unknown instruction '${parts[0]}'`, "unknown-mnemonic");

  const warnings: Encoded["warnings"] = [];
  let rsrc1 = 0,
    rsrc2 = 0,
    rdst = 0,
    index = 0;
  let imm: number | null = null;

  const expected: Record<InstructionDef["operands"], number> = {
    none: 0,
    rdst: 1,
    rsrc1: 1,
    rdst_rsrc1: 2,
    rdst_rsrc1_rsrc2: 3,
    rdst_rsrc1_imm: 3,
    rdst_imm: 2,
    rdst_mem: 2,
    rsrc_mem: 2,
    imm: 1,
    index: 1,
  };
  need(args, expected[def.operands], def);
  if (args.length > expected[def.operands]) {
    warnings.push({
      code: "extra-operands",
      message: `${def.mnemonic} takes ${expected[def.operands]} operand(s); extra operands are ignored: ${args
        .slice(expected[def.operands])
        .join(", ")}`,
    });
  }

  const immLimit = (value: string, what: string) => {
    if (hexValueBig(value) > (1n << BigInt(profile.immediateBits)) - 1n && !value.trim().startsWith("-")) {
      warnings.push({
        code: "wide-immediate",
        message: `${what} 0x${parseHex(value).toString(16).toUpperCase()} is wider than the ${profile.immediateBits}-bit immediate field the ISA documents`,
      });
    }
  };

  switch (def.operands) {
    case "none":
      break;
    case "rdst":
      rdst = parseReg(args[0]);
      break;
    case "rsrc1":
      rsrc1 = parseReg(args[0]);
      break;
    case "rdst_rsrc1":
      rdst = parseReg(args[0]);
      rsrc1 = parseReg(args[1]);
      break;
    case "rdst_rsrc1_rsrc2":
      rdst = parseReg(args[0]);
      rsrc1 = parseReg(args[1]);
      rsrc2 = parseReg(args[2]);
      break;
    case "rdst_rsrc1_imm":
      rdst = parseReg(args[0]);
      rsrc1 = parseReg(args[1]);
      if (HEX_RE.test(args[2].trim())) {
        imm = parseHex(args[2]);
        immLimit(args[2], "Immediate");
      } else {
        rsrc2 = parseReg(args[2]);
        warnings.push({
          code: "iadd-register",
          message:
            "IADD with a register third operand emits no immediate word (same as the Python assembler), but the hardware decoder still treats IADD as two words.",
        });
      }
      break;
    case "rdst_imm":
      rdst = parseReg(args[0]);
      imm = parseHex(args[1]);
      immLimit(args[1], "Immediate");
      break;
    case "rdst_mem":
    case "rsrc_mem": {
      const valueReg = parseReg(args[0]);
      const m = MEM_OPERAND_RE.exec(args[1]);
      if (!m) {
        throw new AsmError(
          `invalid ${def.mnemonic} operand: expected offset(Rn), got '${args[1]}'`,
          "bad-mem-operand",
        );
      }
      rsrc1 = parseReg(m[2]);
      imm = parseHex(m[1]);
      immLimit(m[1], "Offset");
      if (def.operands === "rdst_mem") rdst = valueReg;
      else rsrc2 = valueReg;
      break;
    }
    case "imm":
      imm = parseHex(args[0]);
      if (imm >= profile.memoryWords) {
        warnings.push({
          code: "target-out-of-range",
          message: `${def.mnemonic} target 0x${imm.toString(16).toUpperCase()} is outside the ${profile.memoryWords}-word memory`,
        });
      }
      break;
    case "index": {
      const raw = parseHex(args[0]);
      index = raw & 0b11;
      if (raw !== index || index > profile.maxIntIndex) {
        warnings.push({
          code: "int-index",
          message: `INT index ${raw} is outside 0–${profile.maxIntIndex}; it is encoded as ${index} and reads vector M[${profile.intVectorBase + index}]`,
        });
      }
      if (index & 1) {
        warnings.push({
          code: "int-index-bit",
          message:
            "This encoding puts the INT index in bits 17:16, so INT 1 sets bit 16. The ISA sheet lists the index at bit 17 — check which bit your decoder reads.",
        });
      }
      break;
    }
  }

  let word = 0;
  word |= (def.opcode & 0x1f) << 27;
  word |= (rsrc1 & 0x07) << 24;
  word |= (rsrc2 & 0x07) << 21;
  word |= (rdst & 0x07) << 18;
  word |= (index & 0x03) << 16;
  const words = [word >>> 0];
  if (imm !== null) words.push(imm >>> 0);
  return { words, warnings };
}

export function assemble(source: string, profile: ProcessorProfile): AssemblyResult {
  const diagnostics: Diagnostic[] = [];
  const memory = new Map<number, number>();
  const sourceMap = new Map<number, AddressInfo>();
  const lineAddress = new Map<number, number>();

  if (source.length > MAX_SOURCE_BYTES) {
    diagnostics.push({
      line: 1,
      severity: "error",
      code: "too-large",
      message: `Program is larger than ${MAX_SOURCE_BYTES / 1024} KB. Split it or remove unused sections.`,
    });
    return { ok: false, memory, sourceMap, lineAddress, lines: [], diagnostics, highestAddress: 0 };
  }

  const lines = preprocess(source).slice(0, MAX_SOURCE_LINES);
  const maxAddr = profile.memoryWords - 1;
  let addr = 0;

  const emit = (line: number, value: number, kind: AddressInfo["kind"], text: string) => {
    if (addr > maxAddr) {
      diagnostics.push({
        line,
        severity: "error",
        code: "address-overflow",
        message: `Address 0x${addr.toString(16).toUpperCase()} is past the end of the ${profile.memoryWords}-word memory; the word is dropped.`,
      });
      addr++;
      return;
    }
    const prev = sourceMap.get(addr);
    if (prev) {
      diagnostics.push({
        line,
        severity: "warning",
        code: "overlap",
        message: `Address 0x${addr.toString(16).toUpperCase()} was already written by line ${prev.line}; this line overwrites it.`,
      });
    }
    memory.set(addr, value >>> 0);
    sourceMap.set(addr, { line, kind, text });
    if (!lineAddress.has(line)) lineAddress.set(line, addr);
    addr++;
  };

  for (const { line, code } of lines) {
    if (!code) continue;
    try {
      if (/^\.ORG\b/i.test(code)) {
        const parts = code.split(/\s+/);
        if (parts.length !== 2) throw new AsmError("usage: .ORG <hex address>", "bad-org");
        addr = parseHex(parts[1]);
        if (addr > maxAddr) {
          diagnostics.push({
            line,
            severity: "warning",
            code: "org-out-of-range",
            message: `.ORG 0x${addr.toString(16).toUpperCase()} is past the end of memory (max 0x${maxAddr.toString(16).toUpperCase()}).`,
          });
        }
        continue;
      }
      if (DATA_LINE_RE.test(code)) {
        if (profile.instructions.some((d) => d.mnemonic === code.toUpperCase())) {
          diagnostics.push({
            line,
            severity: "warning",
            code: "mnemonic-as-data",
            message: `'${code}' is also a valid hex number, so it is stored as the data word 0x${parseHex(code)
              .toString(16)
              .toUpperCase()}, not as an instruction. Add its operands.`,
          });
        }
        emit(line, parseHex(code), "data", code);
        continue;
      }
      const { words, warnings } = encodeInstruction(code, profile);
      for (const w of warnings) diagnostics.push({ line, severity: "warning", ...w });
      words.forEach((w, i) => emit(line, w, i === 0 ? "instruction" : "immediate", code));
    } catch (e) {
      const err = e instanceof AsmError ? e : new AsmError(String(e), "internal");
      diagnostics.push({ line, severity: "error", code: err.code, message: err.message });
    }
  }

  const resetTarget = memory.get(profile.resetVector);
  if (resetTarget === undefined) {
    diagnostics.push({
      line: 1,
      severity: "warning",
      code: "no-reset-vector",
      message: `M[${profile.resetVector}] (reset vector) is never set, so execution starts at address 0.`,
    });
  } else if (!sourceMap.has(resetTarget) || sourceMap.get(resetTarget)?.kind !== "instruction") {
    diagnostics.push({
      line: sourceMap.get(profile.resetVector)?.line ?? 1,
      severity: "warning",
      code: "reset-target",
      message: `The reset vector points to 0x${resetTarget.toString(16).toUpperCase()}, which holds no instruction.`,
    });
  }

  const highestAddress = memory.size ? Math.max(...memory.keys()) : 0;
  const ok = !diagnostics.some((d) => d.severity === "error");
  return { ok, memory, sourceMap, lineAddress, lines, diagnostics, highestAddress };
}

/** Render the .mem file exactly like write_mem() in the Python assembler. */
export function toMemFile(memory: Map<number, number>, profile: ProcessorProfile): string {
  const max = memory.size ? Math.min(Math.max(...memory.keys()), profile.memoryWords - 1) : 0;
  const rows: string[] = new Array(max + 1);
  for (let a = 0; a <= max; a++) rows[a] = ((memory.get(a) ?? 0) >>> 0).toString(2).padStart(32, "0");
  return rows.join("\n") + "\n";
}

export function hex(v: number, digits = 8): string {
  return (v >>> 0).toString(16).toUpperCase().padStart(digits, "0");
}

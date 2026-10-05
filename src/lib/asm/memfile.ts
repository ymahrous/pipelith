/**
 * .mem file import and disassembly.
 *
 * The VHDL memory model reads one 32-bit binary word per line and silently
 * skips lines it cannot read — which shifts every later word down by one
 * address. We report those lines instead of hiding them.
 */
import type { ProcessorProfile } from "../isa/profile";
import type { Diagnostic } from "./assembler";
import { hex } from "./assembler";

export const MAX_MEM_BYTES = 2 * 1024 * 1024;

export interface MemImport {
  memory: Map<number, number>;
  diagnostics: Diagnostic[];
}

export function parseMemFile(text: string, profile: ProcessorProfile): MemImport {
  const diagnostics: Diagnostic[] = [];
  const memory = new Map<number, number>();
  if (text.length > MAX_MEM_BYTES) {
    diagnostics.push({
      line: 1,
      severity: "error",
      code: "too-large",
      message: `File is larger than ${MAX_MEM_BYTES / 1024 / 1024} MB.`,
    });
    return { memory, diagnostics };
  }
  const rows = text.split(/\r?\n/);
  let addr = 0;
  rows.forEach((raw, i) => {
    const line = raw.trim();
    if (line === "") return;
    if (!/^[01]{32}$/.test(line)) {
      diagnostics.push({
        line: i + 1,
        severity: "error",
        code: "bad-word",
        message: `Line ${i + 1} is not 32 binary digits. The VHDL loader skips it, so every following word lands one address lower than intended.`,
      });
      return;
    }
    if (addr >= profile.memoryWords) {
      if (addr === profile.memoryWords) {
        diagnostics.push({
          line: i + 1,
          severity: "warning",
          code: "past-end",
          message: `Words from line ${i + 1} onward are past the ${profile.memoryWords}-word memory and are ignored.`,
        });
      }
      addr++;
      return;
    }
    const v = parseInt(line, 2) >>> 0;
    if (v !== 0) memory.set(addr, v);
    addr++;
  });
  return { memory, diagnostics };
}

export interface Decoded {
  mnemonic: string;
  text: string;
  words: 1 | 2;
  opcode: number;
  rsrc1: number;
  rsrc2: number;
  rdst: number;
  index: number;
  known: boolean;
  /** Bits that should be zero for this instruction but are not. */
  strayBits: number;
}

export function decodeWord(word: number, next: number | undefined, profile: ProcessorProfile): Decoded {
  const opcode = (word >>> 27) & 0x1f;
  const rsrc1 = (word >>> 24) & 7;
  const rsrc2 = (word >>> 21) & 7;
  const rdst = (word >>> 18) & 7;
  const index = (word >>> 16) & 3;
  const def = profile.instructions.find((d) => d.opcode === opcode);
  const base = { opcode, rsrc1, rsrc2, rdst, index };
  if (!def) {
    return { ...base, mnemonic: "???", text: `.word 0x${hex(word)}`, words: 1, known: false, strayBits: 0 };
  }
  const imm = next === undefined ? "?" : (next >>> 0).toString(16).toUpperCase();
  const R = (n: number) => `R${n}`;
  let text = def.mnemonic;
  let words: 1 | 2 = def.words;
  let used = 0xf8000000;
  switch (def.operands) {
    case "rdst":
      text += ` ${R(rdst)}`;
      used |= 7 << 18;
      break;
    case "rsrc1":
      text += ` ${R(rsrc1)}`;
      used |= 7 << 24;
      break;
    case "rdst_rsrc1":
      text += ` ${R(rdst)}, ${R(rsrc1)}`;
      used |= (7 << 18) | (7 << 24);
      break;
    case "rdst_rsrc1_rsrc2":
      text += ` ${R(rdst)}, ${R(rsrc1)}, ${R(rsrc2)}`;
      used |= (7 << 18) | (7 << 24) | (7 << 21);
      break;
    case "rdst_rsrc1_imm":
      text += ` ${R(rdst)}, ${R(rsrc1)}, ${imm}`;
      used |= (7 << 18) | (7 << 24) | (7 << 21);
      break;
    case "rdst_imm":
      text += ` ${R(rdst)}, ${imm}`;
      used |= 7 << 18;
      break;
    case "rdst_mem":
      text += ` ${R(rdst)}, ${imm}(${R(rsrc1)})`;
      used |= (7 << 18) | (7 << 24);
      break;
    case "rsrc_mem":
      text += ` ${R(rsrc2)}, ${imm}(${R(rsrc1)})`;
      used |= (7 << 21) | (7 << 24);
      break;
    case "imm":
      text += ` ${imm}`;
      break;
    case "index":
      text += ` ${index}`;
      used |= 3 << 16;
      break;
    case "none":
      break;
  }
  if (def.words === 1) words = 1;
  const strayBits = (word & ~used) >>> 0;
  return { ...base, mnemonic: def.mnemonic, text, words, known: true, strayBits };
}

export interface DisasmRow {
  address: number;
  word: number;
  kind: "instruction" | "immediate" | "data";
  text: string;
}

/**
 * Linear disassembly that follows the reset vector: data words at vector
 * addresses are labelled, and the word after a two-word instruction is
 * shown as its immediate.
 */
export function disassemble(memory: Map<number, number>, profile: ProcessorProfile): DisasmRow[] {
  const rows: DisasmRow[] = [];
  const addrs = [...memory.keys()].sort((a, b) => a - b);
  const vectorAddrs = new Set([
    profile.resetVector,
    profile.extIntVector,
    ...Array.from({ length: profile.maxIntIndex + 1 }, (_, i) => profile.intVectorBase + i),
  ]);
  let skip = -1;
  for (const a of addrs) {
    const w = memory.get(a) ?? 0;
    if (a === skip) {
      rows.push({ address: a, word: w, kind: "immediate", text: `imm 0x${hex(w)}` });
      continue;
    }
    if (vectorAddrs.has(a)) {
      rows.push({ address: a, word: w, kind: "data", text: `vector → 0x${w.toString(16).toUpperCase()}` });
      continue;
    }
    const d = decodeWord(w, memory.get(a + 1) ?? 0, profile);
    rows.push({ address: a, word: w, kind: d.known ? "instruction" : "data", text: d.text });
    if (d.known && d.words === 2) skip = a + 1;
  }
  return rows;
}

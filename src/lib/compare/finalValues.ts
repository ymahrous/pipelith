/**
 * Final-values comparison: the quick option for anyone who can't export a
 * waveform (an FPGA board, a screenshot of the simulator's register view,
 * ModelSim `examine` output). Only end-of-program state is compared.
 *
 * Accepted, one or more per line, separated by spaces, commas or semicolons:
 *   R1=1E   r1: 0x1E   R1 0000001E   /processor/r1 0000001E   tb.uut.r1=1e
 *   SP=FFE  OUT=6  out_port=6  Z=1  N=0  C=1
 * Values are hex (optional 0x). A run of more than 8 binary digits is read as binary.
 */
import { hex } from "../asm/assembler";
import type { SimResult } from "../sim/simulator";
import { FLAG_C, FLAG_N, FLAG_Z } from "../sim/simulator";

export type FinalKey = `R${number}` | "SP" | "OUT" | "Z" | "N" | "C";

export interface FinalEntry {
  key: FinalKey;
  value: number;
  line: number;
}
export interface FinalParse {
  entries: FinalEntry[];
  errors: { line: number; message: string }[];
}

export interface FinalRow {
  key: FinalKey;
  expected: string;
  actual: string;
  status: "match" | "mismatch";
}
export interface FinalReport {
  rows: FinalRow[];
  passed: number;
  failed: number;
}

const NAME_ALIASES: Record<string, FinalKey> = {
  sp: "SP",
  sp_value: "SP",
  stack_pointer: "SP",
  out: "OUT",
  out_port: "OUT",
  outport: "OUT",
  z: "Z",
  n: "N",
  c: "C",
};

function keyOf(raw: string, registerCount: number): FinalKey | null {
  // Strip hierarchical prefixes like /processor/ or tb.uut.
  const name = raw.replace(/^.*[/.]/, "").toLowerCase();
  const r = /^r([0-9]{1,2})$/.exec(name);
  if (r) return Number(r[1]) < registerCount ? (`R${Number(r[1])}` as FinalKey) : null;
  return Object.prototype.hasOwnProperty.call(NAME_ALIASES, name) ? NAME_ALIASES[name] : null;
}

function valueOf(raw: string): number | null {
  const t = raw.trim().replace(/_/g, "");
  if (/^0b[01]{1,32}$/i.test(t)) return parseInt(t.slice(2), 2) >>> 0;
  if (/^[01]{9,32}$/.test(t)) return parseInt(t, 2) >>> 0;
  const h = t.replace(/^0x/i, "").replace(/^x"(.*)"$/i, "$1");
  if (/^[0-9a-f]{1,8}$/i.test(h)) return parseInt(h, 16) >>> 0;
  return null;
}

export function parseFinalValues(text: string, registerCount = 8): FinalParse {
  const entries: FinalEntry[] = [];
  const errors: FinalParse["errors"] = [];
  const lines = text.slice(0, 8_000).split(/\r?\n/);
  lines.forEach((rawLine, i) => {
    const line = rawLine.replace(/(#|\/\/).*$/, "").trim();
    if (!line) return;
    // name[=: ]value pairs; names may contain path characters.
    const re = /([A-Za-z_/.][\w/.]*)\s*(?:=|:|\s)\s*((?:0x|0b)?[0-9A-Fa-f_]+|x"[0-9A-Fa-f]+")/g;
    let matched = false;
    for (const m of line.matchAll(re)) {
      matched = true;
      const key = keyOf(m[1], registerCount);
      const value = valueOf(m[2]);
      if (!key) {
        errors.push({ line: i + 1, message: `“${m[1]}” is not a register name. Use R0–R${registerCount - 1}, SP, OUT, Z, N or C.` });
      } else if (value === null || ((key === "Z" || key === "N" || key === "C") && value > 1)) {
        errors.push({ line: i + 1, message: `“${m[2]}” is not a valid value for ${key}.` });
      } else {
        const prev = entries.findIndex((e) => e.key === key);
        if (prev !== -1) entries.splice(prev, 1);
        entries.push({ key, value, line: i + 1 });
      }
    }
    if (!matched) errors.push({ line: i + 1, message: "Write each value as NAME=VALUE, for example R1=1E." });
  });
  return { entries, errors };
}

const ORDER = (k: FinalKey) =>
  k.startsWith("R") ? Number(k.slice(1)) : { SP: 100, OUT: 101, Z: 102, N: 103, C: 104 }[k as "SP"];

export function compareFinalValues(sim: SimResult, entries: FinalEntry[]): FinalReport {
  const f = sim.final;
  const rows = [...entries]
    .sort((a, b) => ORDER(a.key) - ORDER(b.key))
    .map((e): FinalRow => {
      let expected: number;
      let fmt = (v: number) => hex(v);
      if (e.key.startsWith("R")) expected = f.regs[Number(e.key.slice(1))];
      else if (e.key === "SP") {
        expected = f.sp;
        fmt = (v) => hex(v, 3);
      } else if (e.key === "OUT") expected = f.out ?? 0;
      else {
        expected = f.flags & { Z: FLAG_Z, N: FLAG_N, C: FLAG_C }[e.key as "Z"] ? 1 : 0;
        fmt = (v) => String(v);
      }
      return { key: e.key, expected: fmt(expected), actual: fmt(e.value), status: expected === e.value ? "match" : "mismatch" };
    });
  return { rows, passed: rows.filter((r) => r.status === "match").length, failed: rows.filter((r) => r.status !== "match").length };
}

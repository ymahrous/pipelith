/**
 * Quick start: decide what a set of dropped files is for, so the visitor
 * lands on the right page with the files already open.
 */

export type Destination =
  | { kind: "review"; files: number[] }
  | { kind: "program"; program: number }
  | { kind: "waveform"; waveform: number }
  | { kind: "program+waveform"; program: number; waveform: number }
  | { kind: "values"; values: number }
  | { kind: "program+values"; program: number; values: number }
  | { kind: "unknown"; reason: string };

/** Any HDL source or header: VHDL, Verilog or SystemVerilog. */
const HDL = /\.(vhd|vhdl|vho|v|vh|sv|svh)$/i;
const ZIP = /\.zip$/i;
const PROGRAM = /\.(asm|s|mem)$/i;
const WAVE = /\.vcd(\.gz)?$/i;
const VALUES = /\.txt$/i;

export const QUICK_ACCEPT = ".zip,.vhd,.vhdl,.v,.vh,.sv,.svh,.asm,.s,.mem,.vcd,.gz,.txt";

/** Route by file name only; contents are validated later by the page that opens them. */
export function routeFiles(names: readonly string[]): Destination {
  if (!names.length) return { kind: "unknown", reason: "No files were dropped." };
  const idx = (re: RegExp) => names.flatMap((n, i) => (re.test(n) ? [i] : []));
  const code = [...idx(ZIP), ...idx(HDL)];
  if (code.length) {
    // A codebase: every file goes to Code review (it also lists .asm programs).
    return { kind: "review", files: names.map((_, i) => i) };
  }
  const programs = idx(PROGRAM);
  const waves = idx(WAVE);
  const values = idx(VALUES);
  if (programs.length > 1) return { kind: "unknown", reason: "Drop one program at a time (.asm or .mem)." };
  if (waves.length > 1) return { kind: "unknown", reason: "Drop one waveform at a time (.vcd or .vcd.gz)." };
  const [p] = programs;
  const [w] = waves;
  const [v] = values;
  if (p !== undefined && w !== undefined) return { kind: "program+waveform", program: p, waveform: w };
  if (p !== undefined && v !== undefined) return { kind: "program+values", program: p, values: v };
  if (p !== undefined) return { kind: "program", program: p };
  if (w !== undefined) return { kind: "waveform", waveform: w };
  if (v !== undefined) return { kind: "values", values: v };
  return {
    kind: "unknown",
    reason:
      "Pipelith opens .zip, .vhd, .v and .sv (code review), .asm and .mem (programs), .vcd and .vcd.gz (waveforms) and .txt (final register values).",
  };
}

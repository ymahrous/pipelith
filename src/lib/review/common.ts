/**
 * Types and helpers shared by the VHDL rules (vhdl.ts), the Verilog and
 * SystemVerilog rules (verilog/review.ts) and the design-level checks in
 * review.ts.
 */

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

export type FindingInput = Omit<Finding, "id" | "excerpt">;
export type AddFinding = (f: FindingInput) => void;

/** A reset branch found in a clocked process or always block, for the design-wide polarity check. */
export interface ResetUse {
  name: string;
  level: "0" | "1";
  file: string;
  line: number;
}

export type PortMode = "in" | "out" | "inout" | "buffer" | "linkage";

/**
 * A design unit in any language: a VHDL entity (with its architectures) or a
 * Verilog/SystemVerilog module or interface. Hierarchy, compile order and the
 * pipeline checks work on these.
 */
export interface DesignUnit {
  name: string;
  lang: "vhdl" | "verilog";
  file: string;
  line: number;
  ports: { name: string; mode: PortMode; line: number }[];
  instances: { label: string; target: string; line: number }[];
  /** VHDL: an architecture exists. Verilog: always. */
  hasBody: boolean;
  /** No ports: a testbench. */
  testbench: boolean;
}

/** rst, reset, rst_n, nreset, arst, sys_rst … but not reset_z (a flag clear). */
export const RESET_NAME = /^(?:n|a|s)?(?:rst|reset)(?:_?n|_?b|_?l)?$|_(?:rst|reset)(?:_?n)?$/i;

/** Grouped list of names for a finding message: "a, b, c and 4 more". */
export function nameList(ds: { name: string }[], max = 8): string {
  return ds.slice(0, max).map((d) => d.name).join(", ") + (ds.length > max ? ` and ${ds.length - max} more` : "");
}

/** Source lines around a finding, for the "Show the code" excerpt. */
export function excerptOf(lines: string[] | undefined, line: number): Finding["excerpt"] {
  if (!lines || line < 1) return undefined;
  const start = Math.max(1, line - 2);
  const end = Math.min(lines.length, line + 2);
  return { start, lines: lines.slice(start - 1, end).map((l) => l.replace(/\t/g, "  ").slice(0, 200)), focus: line };
}

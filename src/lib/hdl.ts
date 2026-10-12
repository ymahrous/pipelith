/**
 * Hardware description languages Pipelith works with.
 *
 * The choice is a design setting (`session.hdl`). It picks the testbench
 * language and simulator scripts of the hardware kit, the sample codebase and
 * the .zip guide, and which code samples the docs show. Code review reads
 * every language it finds, whatever is selected.
 */

export type Hdl = "vhdl" | "verilog" | "systemverilog";
export const HDLS: readonly Hdl[] = ["vhdl", "verilog", "systemverilog"];
export const DEFAULT_HDL: Hdl = "vhdl";

export interface HdlInfo {
  id: Hdl;
  label: string;
  /** The standard the generated code and the review follow. */
  standard: string;
  /** Design-file extensions, lower case, with the dot. */
  extensions: readonly string[];
  /** Include files: read for macros, never compiled on their own. */
  headers: readonly string[];
  /** What one design unit is called. */
  unit: "entity" | "module";
  /** Free simulators first. */
  simulators: readonly string[];
  /** Testbench file extension. */
  tbExt: string;
  /** Glob patterns for a zip command that keeps only what the review reads. */
  zipGlobs: readonly string[];
}

export const HDL_INFO: Readonly<Record<Hdl, HdlInfo>> = {
  vhdl: {
    id: "vhdl",
    label: "VHDL",
    standard: "IEEE 1076-2008",
    extensions: [".vhd", ".vhdl", ".vho"],
    headers: [],
    unit: "entity",
    simulators: ["GHDL", "ModelSim/Questa", "Vivado"],
    tbExt: ".vhd",
    zipGlobs: ["*.vhd", "*.vhdl", "*.asm"],
  },
  verilog: {
    id: "verilog",
    label: "Verilog",
    standard: "IEEE 1364-2005",
    extensions: [".v"],
    headers: [".vh"],
    unit: "module",
    simulators: ["Icarus Verilog", "Verilator", "ModelSim/Questa", "Vivado"],
    tbExt: ".v",
    zipGlobs: ["*.v", "*.vh", "*.asm"],
  },
  systemverilog: {
    id: "systemverilog",
    label: "SystemVerilog",
    standard: "IEEE 1800-2017",
    extensions: [".sv"],
    headers: [".svh"],
    unit: "module",
    simulators: ["Icarus Verilog (-g2012)", "Verilator", "ModelSim/Questa", "Vivado"],
    tbExt: ".sv",
    zipGlobs: ["*.sv", "*.svh", "*.v", "*.vh", "*.asm"],
  },
};

export const hdlInfo = (h: Hdl): HdlInfo => HDL_INFO[h];

/** Validate an untrusted value (storage, share link). */
export function toHdl(x: unknown): Hdl | null {
  return x === "vhdl" || x === "verilog" || x === "systemverilog" ? x : null;
}

/** The language a file is written in, from its extension; headers count as their language. */
export function hdlOfPath(path: string): Hdl | null {
  const m = /\.([a-z]+)$/i.exec(path);
  if (!m) return null;
  const ext = "." + m[1].toLowerCase();
  for (const h of HDLS) if (HDL_INFO[h].extensions.includes(ext) || HDL_INFO[h].headers.includes(ext)) return h;
  return null;
}

/** True for Verilog and SystemVerilog include files (.vh, .svh). */
export function isHeaderPath(path: string): boolean {
  return /\.(vh|svh)$/i.test(path);
}

/** Verilog and SystemVerilog share one parser; VHDL has its own. */
export const isVerilogFamily = (h: Hdl | null): h is "verilog" | "systemverilog" => h === "verilog" || h === "systemverilog";

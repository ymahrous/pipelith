/**
 * A ready-to-paste prompt that asks an AI assistant to reorganise an upload
 * the Code review can't use as it is. It carries the file *names* and the
 * problems the structure check found — never file contents — and spells out
 * exactly what Pipelith expects for the selected language and depth.
 * Pipelith never sends it anywhere; the visitor copies it.
 */
import { HDL_INFO, type Hdl } from "../hdl";
import { geometry, type Depth } from "../pipeline/pipeline";
import { BRAND } from "../site";
import { REVIEW_LIMITS } from "./intake";

export interface PromptInput {
  hdl: Hdl;
  depth: Depth;
  /** Every path in the upload as it arrived (reviewed or not); null when the visitor will paste the list. */
  paths: string[] | null;
  /** Problems from checkStructure(), or a plain description when nothing could be read. */
  problems: string[];
  /** Name of the uploaded .zip or folder. */
  uploadName?: string;
}

export const MAX_PROMPT_PATHS = 300;

const NEEDS: Record<Hdl, string[]> = {
  vhdl: [
    "Every .vhd/.vhdl file of ONE design: all entities and architectures, every component it instantiates and every package it uses (use work.…).",
    "One entity per file, with the file named after the entity (alu.vhd holds entity alu).",
    "Testbenches are entities without ports; they may be included.",
  ],
  verilog: [
    "Every .v file of ONE design: every module it instantiates, plus every header it `includes (.vh) — the review finds headers by name, in any folder.",
    "One module per file, with the file named after the module (alu.v holds module alu).",
    "Testbenches are modules without ports; they may be included.",
  ],
  systemverilog: [
    "Every .sv file of ONE design: every module and interface it instantiates, every package it imports (import pkg::*) and every header it `includes (.svh).",
    "One module, interface or package per file, with the file named after it (alu.sv holds module alu).",
    "Testbenches are modules without ports; they may be included.",
  ],
};

export function restructurePrompt(i: PromptInput): string {
  const info = HDL_INFO[i.hdl];
  const g = geometry(i.depth);
  const regs = g.registers.map((r) => r.toLowerCase().replace("/", "_")).join(", ");
  const paths = [...new Set(i.paths ?? [])].sort((a, b) => a.localeCompare(b));
  const shown = paths.slice(0, MAX_PROMPT_PATHS);
  // A .zip or folder name becomes the folder in the zip command; a single file's name doesn't.
  const upload = i.uploadName && (/\.zip$/i.test(i.uploadName) || !/\.[A-Za-z0-9]{1,5}$/.test(i.uploadName)) ? i.uploadName : "my-cpu";
  const top = upload.replace(/\.zip$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 40) || "my-cpu";
  const globs = info.zipGlobs.map((x) => `'${x}'`).join(" ");
  const L: string[] = [];
  L.push(
    `I'm checking a ${i.depth}-stage pipelined processor written in ${info.label} with ${BRAND}, a browser tool that reviews processor designs, and its structure check says my upload isn't usable as it is. Please help me reorganise the project's files so it is. Don't change any code: only move, rename, add or remove files.`,
    "",
    `What ${BRAND} needs (${info.label}, ${info.standard}):`,
    ...NEEDS[i.hdl].map((n) => `- ${n}`),
    "- Any folder layout is fine; one shared top folder is removed automatically.",
    `- Pipeline registers named after the stages they sit between (${regs}) and units with "forward" and "hazard" in their names, so the pipeline checks can find them.`,
    "- Optional: .asm test programs, anywhere.",
    "- Leave out: simulator output (work/, xsim.dir/, .Xil/, db/, obj_dir/), backup or duplicate copies of the same design, zips inside the zip, and password protection.",
    `- At most ${REVIEW_LIMITS.files.toLocaleString("en-US")} source files, ${REVIEW_LIMITS.fileBytes / 1024 / 1024} MB each, ${REVIEW_LIMITS.zipBytes / 1024 / 1024} MB per .zip.`,
    "",
    "What the structure check found:",
    ...(i.problems.length ? i.problems.map((p) => `- ${p[0].toUpperCase()}${p.slice(1)}.`) : ["- Nothing specific; please check the layout against the list above."]),
    "",
    ...(i.paths === null
      ? [
          `My current files (I'll paste the list below — on macOS or Linux: find ${top} -type f; on Windows: dir /s /b ${top}):`,
          "<paste the file list here>",
        ]
      : [`My current files (paths only, ${paths.length} file${paths.length === 1 ? "" : "s"}):`, ...shown, ...(paths.length > shown.length ? [`… and ${paths.length - shown.length} more`] : [])]),
    "",
    "Please reply with:",
    "1. What is wrong, in a few plain sentences.",
    "2. Exactly which files to move, rename or delete — and, for any file the design needs that isn't in my list, its name and where I'd normally find it. Don't write the missing code yourself.",
    "3. A script that makes the changes on a copy of the folder: bash for macOS/Linux, and PowerShell for Windows.",
    `4. The resulting folder tree, and the command to zip it: zip -r ${top}.zip ${top} -i ${globs}`,
  );
  return L.join("\n");
}

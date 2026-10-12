/**
 * The post-upload structure check: does the upload look like one complete
 * design Code review can work with? Shared by the review page and the AI
 * restructuring prompt, so both say the same thing.
 */
import { HDL_INFO, HDLS, type Hdl } from "../hdl";
import type { ReviewReport } from "./review";

export interface StructureInput {
  /** HDL files reviewed (paths after the shared root folder was removed). */
  files: string[];
  report: ReviewReport | null;
  /** The language selected in the settings. */
  hdl: Hdl;
}

export interface StructureResult {
  ok: boolean;
  /** Plain sentences, without a trailing full stop. */
  problems: string[];
  missingPackages: string[];
  missingIncludes: string[];
  unknownUnits: string[];
  duplicates: string[];
  noTop: boolean;
  /** Only files of another language were uploaded. */
  otherLanguage: Hdl | null;
}

const uniq = (xs: string[]) => [...new Set(xs)];
const named = (xs: string[]) => (xs.length ? ` (${xs.slice(0, 6).join(", ")}${xs.length > 6 ? ", …" : ""})` : "");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function checkStructure({ files, report, hdl }: StructureInput): StructureResult {
  const res: StructureResult = { ok: true, problems: [], missingPackages: [], missingIncludes: [], unknownUnits: [], duplicates: [], noTop: false, otherLanguage: null };
  if (!report || !files.length) {
    res.ok = false;
    res.problems.push(`the upload has no ${HDLS.map((h) => HDL_INFO[h].extensions.join("/")).join(", ")} files`);
    return res;
  }
  const titleName = (rule: string, re: RegExp) => uniq(report.findings.filter((f) => f.rule === rule).map((f) => re.exec(f.title)?.[1] ?? "?"));
  res.missingPackages = titleName("missing-package", /^Package (\S+)/);
  res.missingIncludes = titleName("missing-include", /^Include file (\S+)/);
  res.unknownUnits = uniq(report.findings.filter((f) => f.rule === "unknown-unit" && f.severity === "error").map((f) => / uses (\S+), which/.exec(f.title)?.[1] ?? "?"));
  res.duplicates = titleName("duplicate-entity", /^Entity (\S+)/).concat(titleName("duplicate-module", /^Module (\S+)/));
  res.noTop = !report.top;
  if (res.missingPackages.length) res.problems.push(`${plural(res.missingPackages.length, "package is", "packages are")} missing${named(res.missingPackages)}`);
  if (res.missingIncludes.length) res.problems.push(`${plural(res.missingIncludes.length, "include file is", "include files are")} missing${named(res.missingIncludes)}`);
  if (res.unknownUnits.length) res.problems.push(`${plural(res.unknownUnits.length, "unit is", "units are")} instantiated but not in the upload${named(res.unknownUnits)}`);
  if (res.duplicates.length) res.problems.push(`${plural(res.duplicates.length, "unit is", "units are")} defined twice${named(res.duplicates)}`);
  if (res.noTop) res.problems.push("no top-level entity or module was found");
  const counts = report.languages;
  const own = hdl === "vhdl" ? counts.vhdl : counts.verilog + counts.systemverilog;
  if (!own) res.otherLanguage = counts.vhdl ? "vhdl" : counts.systemverilog > counts.verilog ? "systemverilog" : "verilog";
  res.ok = res.problems.length === 0;
  return res;
}

/**
 * Code review: static analysis of a processor codebase in VHDL, Verilog or
 * SystemVerilog (or a mix).
 *
 * Language rules live in vhdl.ts and verilog/review.ts; this file parses the
 * upload, runs them, and adds the design-level checks every language shares:
 * reset polarity, hierarchy, compile order and the pipeline structure for the
 * selected depth and forwarding. Every finding names a file and line, explains
 * why it matters and suggests a concrete fix.
 */
import { hdlOfPath, isVerilogFamily, type Hdl } from "../hdl";
import { activePaths, describeForwarding, FULL_FORWARDING, geometry, type Depth, type ForwardingConfig } from "../pipeline/pipeline";
import { excerptOf, type DesignUnit, type Finding, type FindingInput, type ResetUse, type Severity } from "./common";
import type { SourceFile } from "./intake";
import type { Entity } from "./parse";
import { parseVhdlFiles, reviewVhdl } from "./vhdl";
import { parseVerilogCodebase, reviewVerilog } from "./verilog/review";

export type { Category, Finding, Severity } from "./common";
export type { Assoc } from "./parse";

export interface HierarchyNode {
  entity: string;
  label: string;
  file: string | null;
  children: HierarchyNode[];
}

export interface PipelineSummary {
  selected: Depth;
  inferred: Depth | null;
  registersFound: { pair: string; entity: string; file: string }[];
  expected: string[];
  stages: { stage: string; entity: string | null }[];
  forwardingUnit: string | null;
  hazardUnit: string | null;
  /** Forwarding the user selected, and the paths the forwarding unit's ports suggest. */
  forwarding: { description: string; selected: string[]; found: string[] };
}

export interface ReviewReport {
  files: number;
  lines: number;
  /** Source files per language (headers included). */
  languages: Record<Hdl, number>;
  entities: number;
  architectures: number;
  processes: number;
  /** Verilog/SystemVerilog modules, interfaces and programs. */
  modules: number;
  /** Verilog/SystemVerilog always, always_ff, always_comb and always_latch blocks. */
  alwaysBlocks: number;
  instances: number;
  findings: Finding[];
  counts: Record<Severity, number>;
  top: string | null;
  testbenches: string[];
  hierarchy: HierarchyNode | null;
  compileOrder: string[];
  compileOrderNote: string | null;
  pipeline: PipelineSummary;
  unparsed: string[];
}

/* ---------- helpers ---------- */

const PIPE_TOKENS = ["if", "id", "ex", "ex1", "ex2", "mem", "wb"];
const PIPE_RE = /(?:^|_)(if|id|ex1|ex2|ex|mem|wb)_(id|ex1|ex2|ex|mem|wb)(?:_|$)/;

function pipelinePair(name: string): string | null {
  const m = PIPE_RE.exec(name.toLowerCase());
  if (!m || PIPE_TOKENS.indexOf(m[1]) >= PIPE_TOKENS.indexOf(m[2])) return null;
  return `${m[1].toUpperCase()}/${m[2].toUpperCase()}`;
}

/* ---------- main ---------- */

export function reviewCodebase(sources: SourceFile[], depth: Depth, forwarding: ForwardingConfig = FULL_FORWARDING): ReviewReport {
  const vhdlFiles = parseVhdlFiles(sources.filter((s) => hdlOfPath(s.path) === "vhdl"));
  const verilog = parseVerilogCodebase(sources.filter((s) => isVerilogFamily(hdlOfPath(s.path))));
  const linesOf = new Map<string, string[]>();
  for (const f of vhdlFiles) linesOf.set(f.path, f.lines);
  for (const f of verilog.files) linesOf.set(f.path, f.lines);

  const findings: Finding[] = [];
  let seq = 0;
  const add = (f: FindingInput) => findings.push({ id: `F${++seq}`, excerpt: excerptOf(linesOf.get(f.file), f.line), ...f });
  const resetUses: ResetUse[] = [];

  // Units each language can instantiate from the other.
  const verilogAsEntities = new Map<string, Entity>();
  for (const u of verilog.units) {
    verilogAsEntities.set(u.name.toLowerCase(), {
      name: u.name.toLowerCase(),
      file: u.file,
      line: u.line,
      generics: [],
      ports: u.ports.map((p) => ({ name: p.name.toLowerCase(), mode: p.mode === "out" ? "out" : p.mode === "inout" ? "inout" : "in", type: [], defaultValue: null, line: p.line })),
    });
  }
  const vhdl = reviewVhdl(vhdlFiles, { add, resetUses, foreign: verilogAsEntities });
  const vlog = reviewVerilog(verilog, { add, resetUses, foreign: vhdl.units });

  const units: DesignUnit[] = [...vhdl.units, ...vlog.units];
  const exact = new Map<string, DesignUnit>();
  const folded = new Map<string, DesignUnit>();
  for (const u of units) {
    if (!exact.has(u.name)) exact.set(u.name, u);
    if (!folded.has(u.name.toLowerCase())) folded.set(u.name.toLowerCase(), u);
  }
  const unitOf = (name: string) => exact.get(name) ?? folded.get(name.toLowerCase());

  // Reset polarity across the design
  const lows = resetUses.filter((r) => r.level === "0");
  const highs = resetUses.filter((r) => r.level === "1");
  if (lows.length && highs.length) {
    const minority = lows.length < highs.length ? lows : highs;
    add({
      rule: "reset-polarity",
      category: "Processes",
      severity: "warning",
      file: minority[0].file,
      line: minority[0].line,
      title: "Reset polarity is mixed across the design",
      message: `${lows.length} process${lows.length > 1 ? "es treat" : " treats"} reset as active-low and ${highs.length} as active-high (minority: ${minority
        .slice(0, 4)
        .map((r) => `${r.file.split("/").pop()}:${r.line}`)
        .join(", ")}). Some blocks will be held in reset while others run.`,
      fix: "Pick one polarity for the whole design (the top level's reset port) and use it everywhere.",
    });
  }

  // Hierarchy, top, compile order
  // Instances inside testbenches don't count: the unit a testbench wraps is still the top level.
  const instantiated = new Set(units.filter((u) => !u.testbench).flatMap((u) => u.instances.map((i) => i.target.toLowerCase())));
  const testbenches = units.filter((u) => u.testbench).map((u) => u.name);
  const childrenOf = (name: string) => units.filter((u) => u.name === name).flatMap((u) => u.instances);
  const candidates = units.filter((u) => !instantiated.has(u.name.toLowerCase()) && !u.testbench && u.hasBody);
  candidates.sort((x, y) => childrenOf(y.name).length - childrenOf(x.name).length);
  const top = candidates[0]?.name ?? null;
  const buildTree = (entity: string, label: string, seen: Set<string>): HierarchyNode => {
    const unit = unitOf(entity);
    const node: HierarchyNode = { entity: unit?.name ?? entity, label, file: unit?.file ?? null, children: [] };
    if (seen.has(node.entity) || seen.size > 60) return node;
    const next = new Set(seen).add(node.entity);
    for (const i of childrenOf(node.entity)) node.children.push(buildTree(i.target, i.label, next));
    return node;
  };
  const hierarchy = top ? buildTree(top, top, new Set()) : null;

  const deps = new Map<string, Set<string>>();
  for (const [file, d] of [...vhdl.deps, ...vlog.deps]) deps.set(file, new Set(d));
  for (const u of units) {
    const d = deps.get(u.file) ?? new Set<string>();
    for (const i of u.instances) {
      const tf = unitOf(i.target)?.file;
      if (tf && tf !== u.file) d.add(tf);
    }
    deps.set(u.file, d);
  }
  const order: string[] = [];
  const state = new Map<string, number>();
  let cyclic = false;
  const visit = (p: string) => {
    const st = state.get(p);
    if (st === 2) return;
    if (st === 1) {
      cyclic = true;
      return;
    }
    state.set(p, 1);
    for (const d of [...(deps.get(p) ?? [])].sort()) visit(d);
    state.set(p, 2);
    order.push(p);
  };
  const compiled = [...vhdlFiles.map((f) => f.path), ...verilog.files.filter((f) => !vlog.notCompiled.has(f.path)).map((f) => f.path)];
  for (const path of compiled.sort((x, y) => x.localeCompare(y))) {
    const own = units.filter((u) => u.file === path);
    const onlyTb = own.length && own.every((u) => u.testbench);
    if (!onlyTb) visit(path);
  }
  const compileOrder = order.filter((p) => !vlog.notCompiled.has(p));
  const compileOrderNote = cyclic ? "Some files depend on each other in a cycle; the order shown breaks the cycle arbitrarily." : null;

  // Pipeline structure (depth-aware)
  const geo = geometry(depth);
  const foundPaths: string[] = [];
  const pairs: PipelineSummary["registersFound"] = [];
  for (const e of units) {
    const pair = pipelinePair(e.name);
    if (pair && !pairs.some((p) => p.pair === pair)) pairs.push({ pair, entity: e.name, file: e.file });
  }
  // Also count pipeline registers built inline in the top level (signals named like if_id_*).
  const inferred: Depth | null = pairs.length >= 4 ? (pairs.some((p) => /EX1|EX2/.test(p.pair)) || pairs.length >= 5 ? 6 : 5) : null;
  const expected = geo.registers.map((p) => p.toUpperCase());
  const stageWords: Record<string, RegExp[]> = {
    IF: [/^fetch(_stage)?$/, /fetch/],
    ID: [/^decode(_stage)?$/, /decode/],
    EX: [/^execute(_stage)?$/, /^ex(_stage)?$/, /execute(?!_?\d)/],
    EX1: [/^execute_?1(_stage)?$/, /execute_?1/],
    EX2: [/^execute_?2(_stage)?$/, /execute_?2/],
    MEM: [/^memory_stage$/, /^mem(_stage)?$/, /mem(ory)?_stage/],
    WB: [/^write_?back(_stage)?$/, /write_?back/],
  };
  const stages = geo.stages.map((s) => {
    for (const re of stageWords[s]) {
      const hit = units.find((e) => re.test(e.name.toLowerCase()));
      if (hit) return { stage: s, entity: hit.name };
    }
    return { stage: s, entity: null as string | null };
  });
  const fwd = units.find((e) => /forward/i.test(e.name))?.name ?? null;
  const hz = units.find((e) => /hazard/i.test(e.name))?.name ?? null;
  const pipeAnchor = pairs[0] ?? (top ? { file: unitOf(top)!.file, entity: top } : null);

  if (pipeAnchor) {
    if (inferred && inferred !== depth) {
      add({
        rule: "pipeline-depth",
        category: "Pipeline",
        severity: "warning",
        file: pipeAnchor.file,
        line: unitOf(pipeAnchor.entity)?.line ?? 1,
        title: `The code looks like a ${inferred}-stage pipeline, but ${depth} stages are selected`,
        message: `Pipeline registers found: ${pairs.map((p) => p.pair).join(", ")}. Timing estimates, the testbench length and the stage checks below assume ${depth} stages.`,
        fix: `Switch the depth to ${inferred} stages at the top of this page (and in the workbench), or add/remove the pipeline registers you intended.`,
      });
    }
    for (const want of expected) {
      if (pairs.some((p) => p.pair === want)) continue;
      add({
        rule: "pipeline-register-missing",
        category: "Pipeline",
        severity: inferred === depth || !inferred ? "warning" : "info",
        file: pipeAnchor.file,
        line: 1,
        title: `No ${want} pipeline register found`,
        message: `A ${depth}-stage pipeline (${geo.stages.join(" → ")}) needs a register between ${want.replace("/", " and ")}. None of the entities is named like it.`,
        fix: `Add an entity such as ${want.toLowerCase().replace("/", "_")}_register with clock, reset, stall and flush inputs, or rename the existing one so it can be found.`,
      });
    }
    for (const s of stages) {
      if (s.entity) continue;
      add({
        rule: "pipeline-stage-missing",
        category: "Pipeline",
        severity: "info",
        file: pipeAnchor.file,
        line: 1,
        title: `No separate entity for the ${s.stage} stage`,
        message: `Expected something named like “${s.stage === "WB" ? "writeback" : s.stage.toLowerCase()}_stage”. That's fine if the logic lives in the top level — this only affects how findable it is.`,
        fix: "Optional: keep each stage in its own entity so it can be reviewed and tested alone.",
      });
    }
    const wanted = activePaths(geo, forwarding);
    const fwdDesc = describeForwarding(geo, forwarding);
    const portsMention = (names: string, src: string) => {
      const [x, y] = src.toLowerCase().split("/");
      return new RegExp(`${x}_?${y}|${x}${y}`).test(names);
    };
    if (fwd) {
      const fe = unitOf(fwd)!;
      const names = fe.ports.map((p) => p.name.toLowerCase()).join(" ");
      foundPaths.push(...geo.forwardingSources.filter((src) => portsMention(names, src)));
      if (!wanted.length) {
        add({
          rule: "forwarding-unexpected",
          category: "Pipeline",
          severity: "info",
          file: fe.file,
          line: fe.line,
          title: "A forwarding unit exists, but forwarding is set to off",
          message: `The review and the timing estimate assume ${fwdDesc}. ${fwd} looks like it forwards from ${foundPaths.join(", ") || "later stages"}.`,
          fix: "If the design forwards, turn forwarding on and pick its paths in the settings at the top. If the unit is disabled on purpose, ignore this.",
        });
      } else {
        const missing = wanted.filter((src) => !foundPaths.includes(src));
        if (missing.length) {
          add({
            rule: "forwarding-sources",
            category: "Pipeline",
            severity: "warning",
            file: fe.file,
            line: fe.line,
            title: `Forwarding unit has no inputs from ${missing.join(", ")}`,
            message: `You selected ${fwdDesc}, but no port of ${fwd} is named after ${missing.join(", ")}. A dependent instruction that needs that path will read a stale register.`,
            fix: `Add the ${missing.join(" and ")} path(s) to the forwarding mux, or deselect them in the settings so the hazard unit is expected to stall instead.`,
          });
        }
        const extra = foundPaths.filter((src) => !wanted.includes(src));
        if (extra.length) {
          add({
            rule: "forwarding-extra",
            category: "Pipeline",
            severity: "info",
            file: fe.file,
            line: fe.line,
            title: `Forwarding unit also uses ${extra.join(", ")}`,
            message: `Those paths aren't in your forwarding selection (${fwdDesc}), so the timing estimate is more pessimistic than the design.`,
            fix: `Select ${extra.join(", ")} in the forwarding settings if the design really forwards from there.`,
          });
        }
      }
    } else if (wanted.length) {
      add({
        rule: "no-forwarding",
        category: "Pipeline",
        severity: "warning",
        file: pipeAnchor.file,
        line: 1,
        title: "Forwarding is selected, but no forwarding unit was found",
        message: `You selected ${fwdDesc}. Without a unit that bypasses results from ${wanted.join(", ")}, back-to-back dependent instructions read stale registers unless the hazard unit stalls them.`,
        fix: "Add a forwarding unit that compares the source registers in EX with destination registers in later pipeline registers — or select “No forwarding” if the design stalls instead.",
      });
    }
    if (!hz) {
      const noFwd = !wanted.length;
      add({
        rule: "no-hazard-unit",
        category: "Pipeline",
        severity: noFwd ? "warning" : "info",
        file: pipeAnchor.file,
        line: 1,
        title: "No hazard-detection unit found",
        message: noFwd
          ? `With ${fwdDesc}, every instruction that reads a register written by one of the previous ${geo.depth - 2} instructions must stall until write-back. Nothing in the design appears to do that.`
          : `A load's result is ready only after ${geo.stages[geo.memory]}, so a dependent instruction right behind it needs ${geo.memory - geo.execute} stall cycle(s) on ${depth} stages.`,
        fix: noFwd
          ? "Add a hazard unit that compares ID's source registers with the destinations in EX…WB and freezes PC and IF/ID until the value is written."
          : "Add a hazard unit that detects load-use and freezes PC and IF/ID while inserting a bubble.",
      });
    }
    for (const p of pairs) {
      const e = unitOf(p.entity)!;
      const names = e.ports.map((x) => x.name);
      if (!names.some((n) => /flush|stall|enable|(^|_)en$|clear|bubble|freeze|hold/i.test(n))) {
        add({
          rule: "pipeline-register-control",
          category: "Pipeline",
          severity: "info",
          file: e.file,
          line: e.line,
          title: `${p.pair} register has no stall or flush input`,
          message: "Hazard handling needs to freeze (stall) or clear (flush) pipeline registers.",
          fix: "Add stall and flush inputs and gate the register update with them.",
        });
      }
      const ins = e.ports.filter((x) => x.mode === "in" && /_in$/.test(x.name)).map((x) => x.name.replace(/_in$/, ""));
      const outs = new Set(e.ports.filter((x) => x.mode === "out" && /_out$/.test(x.name)).map((x) => x.name.replace(/_out$/, "")));
      for (const f of ins) {
        if (outs.has(f)) continue;
        add({
          rule: "pipeline-field-dropped",
          category: "Pipeline",
          severity: "warning",
          file: e.file,
          line: e.ports.find((x) => x.name === `${f}_in`)!.line,
          title: `${p.pair} register takes ${f}_in but has no ${f}_out`,
          message: "The field is latched but never passed to the next stage, so later stages can't see it.",
          fix: `Add “${f}_out : out …” and assign it in the clocked process, or remove ${f}_in.`,
        });
      }
    }
  }

  const unparsed = [...vhdlFiles.filter((f) => !f.parsed), ...verilog.files.filter((f) => !f.parsed)].map((f) => f.path);
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const sev = { error: 0, warning: 1, info: 2 };
  findings.sort((x, y) => sev[x.severity] - sev[y.severity] || x.file.localeCompare(y.file) || x.line - y.line);
  const languages: Record<Hdl, number> = { vhdl: 0, verilog: 0, systemverilog: 0 };
  for (const s of sources) {
    const h = hdlOfPath(s.path);
    if (h) languages[h]++;
  }

  return {
    files: vhdlFiles.length + verilog.files.length,
    lines: [...linesOf.values()].reduce((n, l) => n + l.length, 0),
    languages,
    entities: vhdl.entities,
    architectures: vhdl.architectures,
    processes: vhdl.processes,
    modules: vlog.modules,
    alwaysBlocks: vlog.alwaysBlocks,
    instances: vhdl.instances + vlog.instances,
    findings,
    counts,
    top,
    testbenches,
    hierarchy,
    compileOrder,
    compileOrderNote,
    pipeline: {
      selected: depth,
      inferred,
      registersFound: pairs,
      expected,
      stages,
      forwardingUnit: fwd,
      hazardUnit: hz,
      forwarding: { description: describeForwarding(geo, forwarding), selected: activePaths(geo, forwarding), found: foundPaths },
    },
    unparsed,
  };
}

/** Keep the finding list readable when one rule fires hundreds of times. */
export function groupFindings(findings: Finding[]) {
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const l = byFile.get(f.file) ?? [];
    l.push(f);
    byFile.set(f.file, l);
  }
  return byFile;
}

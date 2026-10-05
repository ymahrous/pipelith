/**
 * Pure pipeline: Session → assembly → simulation → check results.
 * The UI memoises this; tests call it directly.
 */
import type { AddressInfo, AssemblyResult, Diagnostic } from "../asm/assembler";
import { assemble } from "../asm/assembler";
import { disassemble, parseMemFile, type DisasmRow } from "../asm/memfile";
import type { Check, CheckResult, InputHint } from "../check/expectations";
import { evaluateChecks, extractChecks, inferInputs } from "../check/expectations";
import type { ProcessorProfile } from "../isa/profile";
import { DEFAULT_PROFILE, getProfile } from "../isa/risc6";
import type { SimResult } from "../sim/simulator";
import { simulate } from "../sim/simulator";
import { estimateTiming, type TimingEstimate } from "../pipeline/pipeline";
import { addrKey, type Session } from "./session";

export interface InputRow extends InputHint {
  values: number[];
  source: "comment" | "user" | "none";
}

export interface Analysis {
  profile: ProcessorProfile;
  asm: AssemblyResult | null;
  memory: Map<number, number>;
  sourceMap: Map<number, AddressInfo>;
  diagnostics: Diagnostic[];
  disassembly: DisasmRow[] | null;
  canRun: boolean;
  inputRows: InputRow[];
  inputs: Map<number, number[]>;
  sim: SimResult | null;
  checks: Check[];
  checkResults: CheckResult[];
  /** Cycle estimate for the selected pipeline depth. */
  timing: TimingEstimate | null;
}

export function analyze(s: Session): Analysis {
  const profile = getProfile(s.profileId) ?? DEFAULT_PROFILE;
  let asm: AssemblyResult | null = null;
  let memory = new Map<number, number>();
  let sourceMap = new Map<number, AddressInfo>();
  let diagnostics: Diagnostic[] = [];
  let disassembly: DisasmRow[] | null = null;
  let hints: InputHint[] = [];

  if (s.sourceKind === "asm") {
    asm = assemble(s.source, profile);
    memory = asm.memory;
    sourceMap = asm.sourceMap;
    diagnostics = asm.diagnostics;
    hints = inferInputs(asm);
  } else {
    const imp = parseMemFile(s.source, profile);
    memory = imp.memory;
    diagnostics = imp.diagnostics;
    disassembly = disassemble(memory, profile);
    for (const row of disassembly) {
      if (row.kind === "instruction" && row.text.startsWith("IN ")) {
        hints.push({ address: row.address, line: 0, text: row.text, value: null });
      }
    }
  }

  const hasSource = s.source.trim().length > 0;
  const canRun = hasSource && !diagnostics.some((d) => d.severity === "error") && memory.size > 0;

  const inputRows: InputRow[] = hints.map((h) => {
    const user = s.inputs[addrKey(h.address)];
    if (user && user.length) return { ...h, values: user, source: "user" };
    if (h.value !== null) return { ...h, values: [h.value], source: "comment" };
    return { ...h, values: [], source: "none" };
  });
  const inputs = new Map(inputRows.filter((r) => r.values.length).map((r) => [r.address, r.values]));

  let sim: SimResult | null = null;
  if (canRun) {
    sim = simulate({
      profile,
      options: s.options,
      memory,
      sourceMap,
      inputs,
      interrupts: s.interrupts,
      maxSteps: s.maxSteps,
    });
  }

  const disabled = new Set(s.disabledChecks);
  const commentChecks = asm ? extractChecks(asm).map((c) => ({ ...c, enabled: !disabled.has(c.id) })) : [];
  const checks = [...commentChecks, ...s.userChecks];
  const checkResults = sim ? evaluateChecks(checks, sim) : [];

  const timing = sim ? estimateTiming(sim, profile, s.stages, s.forwarding) : null;
  return { profile, asm, memory, sourceMap, diagnostics, disassembly, canRun, inputRows, inputs, sim, checks, checkResults, timing };
}

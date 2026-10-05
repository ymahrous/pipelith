/**
 * Expectations ("checks") — turn the comments test authors already write,
 * such as `#R1=5, C --> 1` or `#this statement shouldn't be executed`,
 * into assertions evaluated against the reference model.
 */
import type { AssemblyResult } from "../asm/assembler";
import { hex } from "../asm/assembler";
import type { SimResult, StepEvent } from "../sim/simulator";
import { FLAG_C, FLAG_N, FLAG_Z, flagsToString } from "../sim/simulator";

export type CheckKind = "reg" | "sp" | "mem" | "flag" | "flags-unchanged" | "not-executed" | "branch" | "out";

export interface Check {
  id: string;
  /** Source line the check belongs to; 0 for checks on the final state. */
  line: number;
  when: "after-line" | "end";
  kind: CheckKind;
  reg?: number;
  addr?: number;
  flag?: "Z" | "N" | "C";
  /** Expected value; "unchanged" for flags that must not change. */
  value?: number | "unchanged";
  taken?: boolean;
  origin: "comment" | "user";
  enabled: boolean;
  /** Text the check was parsed from, for display. */
  sourceText?: string;
}

export interface CheckResult {
  check: Check;
  status: "pass" | "fail" | "not-run";
  expected: string;
  actual: string;
  message?: string;
}

const FLAG_BIT = { Z: FLAG_Z, N: FLAG_N, C: FLAG_C } as const;
const BRANCHES = new Set(["JZ", "JN", "JC", "JMP"]);
const NUM = "([0-9A-Fa-f][0-9A-Fa-f_]*)";

const num = (s: string) => parseInt(s.replace(/_/g, ""), 16) >>> 0;

export function describeCheck(c: Check): string {
  switch (c.kind) {
    case "reg":
      return `R${c.reg} = ${hex(c.value as number, 1)}`;
    case "sp":
      return `SP = ${hex(c.value as number, 1)}`;
    case "mem":
      return `M[${hex(c.addr ?? 0, 1)}] = ${hex(c.value as number, 1)}`;
    case "out":
      return `OUT = ${hex(c.value as number, 1)}`;
    case "flag":
      return c.value === "unchanged" ? `${c.flag} unchanged` : `${c.flag} = ${c.value}`;
    case "flags-unchanged":
      return "Flags unchanged";
    case "not-executed":
      return "Never executes";
    case "branch":
      return c.taken ? "Branch taken" : "Branch not taken";
  }
}

/** Parse expectations from one instruction's comment. */
export function parseComment(comment: string, line: number, mnemonic: string): Check[] {
  const checks: Check[] = [];
  // "R2 = 00010018 ... OR R2=18 if implementing sign extend": keep the first alternative.
  const text = comment.split(/\sOR\s/)[0];
  let n = 0;
  const add = (c: Omit<Check, "id" | "line" | "when" | "origin" | "enabled">) =>
    checks.push({ id: `L${line}-${n++}`, line, when: "after-line", origin: "comment", enabled: true, ...c });

  if (/(shouldn'?t|should\s*not|shouldnot)\s+be\s+executed(?!\s+(till|until))/i.test(text)) {
    add({ kind: "not-executed", sourceText: text });
    return checks; // other values on a dead line are meaningless
  }

  if (BRANCHES.has(mnemonic)) {
    if (/(shouldn'?t|should\s*not|\bnot)\s+(be\s+)?taken/i.test(text)) add({ kind: "branch", taken: false, sourceText: text });
    else if (/\btaken\b/i.test(text)) add({ kind: "branch", taken: true, sourceText: text });
  }

  for (const m of text.matchAll(new RegExp(`\\bR([0-7])\\s*=\\s*${NUM}`, "g"))) {
    add({ kind: "reg", reg: Number(m[1]), value: num(m[2]), sourceText: m[0] });
  }
  for (const m of text.matchAll(new RegExp(`\\bSP\\s*=\\s*${NUM}`, "gi"))) {
    add({ kind: "sp", value: num(m[1]), sourceText: m[0] });
  }
  for (const m of text.matchAll(new RegExp(`\\bM\\[\\s*${NUM}\\s*\\]\\s*=\\s*${NUM}`, "gi"))) {
    add({ kind: "mem", addr: num(m[1]), value: num(m[2]), sourceText: m[0] });
  }
  let explicitFlag = false;
  for (const m of text.matchAll(/\b([CNZ])\s*(?:-->|->|=)\s*(0|1|no\s*change)/g)) {
    explicitFlag = true;
    const v = m[2].startsWith("no") ? "unchanged" : Number(m[2]);
    add({ kind: "flag", flag: m[1] as "Z" | "N" | "C", value: v, sourceText: m[0] });
  }
  if (!explicitFlag && /flags?\s+(no\s+change|not\s+changed|unchanged)/i.test(text)) {
    add({ kind: "flags-unchanged", sourceText: text });
  }
  return checks;
}

export interface InputHint {
  address: number;
  line: number;
  text: string;
  value: number | null;
}

/** Every IN instruction with the value its comment suggests (`#R1=30`, `#add 5 in R1`). */
export function inferInputs(asm: AssemblyResult): InputHint[] {
  const hints: InputHint[] = [];
  for (const sl of asm.lines) {
    const m = /^IN\s+R([0-7])\b/i.exec(sl.code);
    if (!m) continue;
    const address = asm.lineAddress.get(sl.line);
    if (address === undefined) continue;
    const rd = m[1];
    const c = sl.comment.split(/\sOR\s/)[0];
    const fromReg = new RegExp(`\\bR${rd}\\s*=\\s*${NUM}`, "i").exec(c);
    const fromAdd = new RegExp(`\\badd\\s+${NUM}`, "i").exec(c);
    const bare = /^([0-9A-Fa-f][0-9A-Fa-f_]*)\s*$/.exec(c.trim());
    const v = fromReg ? num(fromReg[1]) : fromAdd ? num(fromAdd[1]) : bare ? num(bare[1]) : null;
    hints.push({ address, line: sl.line, text: sl.code, value: v });
  }
  return hints;
}

export function extractChecks(asm: AssemblyResult): Check[] {
  const out: Check[] = [];
  for (const sl of asm.lines) {
    if (!sl.comment || !sl.code || /^\.ORG\b/i.test(sl.code)) continue;
    const info = asm.sourceMap.get(asm.lineAddress.get(sl.line) ?? -1);
    if (!info || info.kind !== "instruction") continue;
    const mnemonic = sl.code.split(/[\s,]+/)[0].toUpperCase();
    out.push(...parseComment(sl.comment, sl.line, mnemonic));
  }
  return out;
}

function firstEventForLine(sim: SimResult, line: number): StepEvent | undefined {
  return sim.events.find((e) => e.kind === "instruction" && e.line === line);
}

export function evaluateChecks(checks: Check[], sim: SimResult): CheckResult[] {
  // Running state, so "after line" checks can see registers that line did not write.
  const regsAfter: number[][] = [];
  const memAfterCache = new Map<number, Map<number, number>>();
  {
    const regs = [...sim.initial.regs];
    for (const e of sim.events) {
      for (const w of e.regWrites) regs[w.reg] = w.after;
      regsAfter.push([...regs]);
    }
  }
  const memAt = (step: number) => {
    let m = memAfterCache.get(step);
    if (!m) {
      m = new Map(sim.initial.memory);
      for (let i = 0; i <= step; i++) for (const w of sim.events[i].memWrites) m.set(w.addr, w.after);
      memAfterCache.set(step, m);
    }
    return m;
  };
  const execCount = (line: number) => sim.events.filter((e) => e.kind === "instruction" && e.line === line).length;

  return checks.map((check): CheckResult => {
    const expected = describeCheck(check);
    if (!check.enabled) return { check, status: "not-run", expected, actual: "—", message: "Turned off" };

    if (check.when === "end") {
      const f = sim.final;
      let actual = 0;
      if (check.kind === "reg") actual = f.regs[check.reg ?? 0];
      else if (check.kind === "sp") actual = f.sp;
      else if (check.kind === "mem") actual = f.memory.get(check.addr ?? 0) ?? 0;
      else if (check.kind === "out") actual = f.out ?? 0;
      else if (check.kind === "flag") {
        const bit = FLAG_BIT[check.flag ?? "Z"];
        const v = f.flags & bit ? 1 : 0;
        return { check, status: v === check.value ? "pass" : "fail", expected, actual: `${check.flag} = ${v}` };
      }
      const pass = actual === check.value;
      return { check, status: pass ? "pass" : "fail", expected, actual: hex(actual, 1) };
    }

    if (check.kind === "not-executed") {
      const n = execCount(check.line);
      return {
        check,
        status: n === 0 ? "pass" : "fail",
        expected,
        actual: n === 0 ? "Never executed" : `Executed ${n}×`,
      };
    }

    const e = firstEventForLine(sim, check.line);
    if (!e) {
      return { check, status: "not-run", expected, actual: "—", message: "This line never executed" };
    }
    const n = execCount(check.line);
    const note = n > 1 ? `Line executed ${n}×; checked the first time` : undefined;

    switch (check.kind) {
      case "reg": {
        const v = regsAfter[e.step][check.reg ?? 0];
        return { check, status: v === check.value ? "pass" : "fail", expected, actual: `R${check.reg} = ${hex(v, 1)}`, message: note };
      }
      case "sp":
        return { check, status: e.spAfter === check.value ? "pass" : "fail", expected, actual: `SP = ${hex(e.spAfter, 1)}`, message: note };
      case "mem": {
        const v = memAt(e.step).get(check.addr ?? 0) ?? 0;
        return { check, status: v === check.value ? "pass" : "fail", expected, actual: `M[${hex(check.addr ?? 0, 1)}] = ${hex(v, 1)}`, message: note };
      }
      case "flag": {
        const bit = FLAG_BIT[check.flag ?? "Z"];
        const after = e.flagsAfter & bit ? 1 : 0;
        const before = e.flagsBefore & bit ? 1 : 0;
        const pass = check.value === "unchanged" ? after === before : after === check.value;
        const actual = check.value === "unchanged" && after !== before ? `${check.flag}: ${before} → ${after}` : `${check.flag} = ${after}`;
        return { check, status: pass ? "pass" : "fail", expected, actual, message: note };
      }
      case "flags-unchanged": {
        const pass = e.flagsAfter === e.flagsBefore;
        return {
          check,
          status: pass ? "pass" : "fail",
          expected,
          actual: pass ? flagsToString(e.flagsAfter) : `${flagsToString(e.flagsBefore)} → ${flagsToString(e.flagsAfter)}`,
          message: note,
        };
      }
      case "branch": {
        const taken = e.branch?.taken ?? false;
        return { check, status: taken === check.taken ? "pass" : "fail", expected, actual: taken ? "Taken" : "Not taken", message: note };
      }
      case "out": {
        const v = e.out;
        return { check, status: v === check.value ? "pass" : "fail", expected, actual: v === undefined ? "No output" : hex(v, 1), message: note };
      }
    }
  });
}

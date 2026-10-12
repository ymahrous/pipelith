import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Hdl } from "../hdl";
import { RULE_CATEGORIES, RULES, ruleInfo } from "./rules";

/** Where rules are emitted, and the languages each file checks. */
const SOURCES: [string, Hdl[]][] = [
  ["vhdl.ts", ["vhdl"]],
  ["verilog/review.ts", ["verilog", "systemverilog"]],
  ["review.ts", ["vhdl", "verilog", "systemverilog"]],
];
const emitted = new Map<string, Set<string>>();
const langs = new Map<string, Set<Hdl>[]>();
for (const [file, hdl] of SOURCES) {
  const source = readFileSync(join(__dirname, file), "utf8");
  for (const m of source.matchAll(/rule:\s*"([a-z0-9-]+)",\s*category:\s*"(\w+)"/g)) {
    if (!emitted.has(m[1])) emitted.set(m[1], new Set());
    emitted.get(m[1])!.add(m[2]);
    langs.set(m[1], [...(langs.get(m[1]) ?? []), new Set(hdl)]);
  }
}

describe("review rule catalog", () => {
  it("documents exactly the rules the engines emit", () => {
    expect(emitted.size).toBeGreaterThan(55);
    expect([...RULES.map((r) => r.id)].sort()).toEqual([...emitted.keys()].sort());
  });

  it("uses the same category as the engine", () => {
    for (const r of RULES) expect(emitted.get(r.id), r.id).toContain(r.category);
  });

  it("lists the languages of the files that emit each rule", () => {
    for (const r of RULES) {
      const sets = langs.get(r.id)!;
      const union = new Set(sets.flatMap((s) => [...s]));
      for (const l of r.languages) expect(union.has(l), `${r.id} claims ${l}`).toBe(true);
      for (const s of sets) expect(r.languages.some((l) => s.has(l)), `${r.id} misses a language it is emitted for`).toBe(true);
    }
  });

  it("has unique ids, valid categories and real text", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    for (const r of RULES) {
      expect(RULE_CATEGORIES).toContain(r.category);
      expect(r.languages.length).toBeGreaterThan(0);
      expect(r.why.length).toBeGreaterThan(20);
      expect(r.fix.length).toBeGreaterThan(8);
    }
    expect(ruleInfo("latch")?.category).toBe("Processes");
    expect(ruleInfo("ff-blocking")?.languages).toEqual(["verilog", "systemverilog"]);
    expect(ruleInfo("__proto__")).toBeUndefined();
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RULE_CATEGORIES, RULES, ruleInfo } from "./rules";

const source = readFileSync(join(__dirname, "review.ts"), "utf8");
const emitted = new Map<string, Set<string>>();
for (const m of source.matchAll(/rule:\s*"([a-z0-9-]+)",\s*category:\s*"(\w+)"/g)) {
  if (!emitted.has(m[1])) emitted.set(m[1], new Set());
  emitted.get(m[1])!.add(m[2]);
}

describe("review rule catalog", () => {
  it("documents exactly the rules the engine emits", () => {
    expect(emitted.size).toBeGreaterThan(40);
    expect([...RULES.map((r) => r.id)].sort()).toEqual([...emitted.keys()].sort());
  });

  it("uses the same category as the engine", () => {
    for (const r of RULES) expect(emitted.get(r.id), r.id).toContain(r.category);
  });

  it("has unique ids, valid categories and real text", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    for (const r of RULES) {
      expect(RULE_CATEGORIES).toContain(r.category);
      expect(r.why.length).toBeGreaterThan(20);
      expect(r.fix.length).toBeGreaterThan(8);
    }
    expect(ruleInfo("latch")?.category).toBe("Processes");
    expect(ruleInfo("__proto__")).toBeUndefined();
  });
});

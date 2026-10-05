// Regenerates src/lib/examples/programs.ts from a testcases/ folder.
// Usage: node scripts/sync-examples.mjs ../risc-pipelined-processor/testcases
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/sync-examples.mjs <testcases dir>");
  process.exit(1);
}
const items = [
  ["one-operand", "One-operand ALU", "OneOperand.asm", "NOT, INC, IN, OUT, SETC and their flag effects."],
  ["two-operand", "Two-operand ALU", "TwoOperand.asm", "MOV, ADD, SUB, AND, IADD and SWAP."],
  ["memory", "Memory and stack", "Memory.asm", "PUSH, POP, LDM, LDD and STD, including load-use hazards."],
  ["branch", "Branches, calls and interrupts", "Branch.asm", "JZ, JMP, CALL/RET, flag forwarding and an interrupt handler."],
];
const rows = items.map(([id, title, file, summary]) =>
  "  " + JSON.stringify({ id, title, file, summary, source: readFileSync(join(dir, file), "utf8") }) + ",",
);
writeFileSync(
  "src/lib/examples/programs.ts",
  [
    "// Test programs from github.com/ymahrous/risc-pipelined-processor (MIT, © 2026 Yousef Mahrous).",
    "// Regenerate with: node scripts/sync-examples.mjs <path-to>/testcases",
    "",
    "export interface ExampleProgram { id: string; title: string; file: string; summary: string; source: string }",
    "",
    "export const EXAMPLES: ExampleProgram[] = [",
    ...rows,
    "];",
    "",
  ].join("\n"),
);
console.log(`Wrote ${rows.length} programs.`);

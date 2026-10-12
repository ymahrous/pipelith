#!/usr/bin/env node
/**
 * The 5-stage reference designs in reference/: the Verilog-2005 sources are
 * the original; the SystemVerilog copy is derived from them with a few
 * mechanical rewrites (logic, always_ff, always_comb, .sv/.svh).
 *
 *   node scripts/build-reference.mjs          # rewrite reference/systemverilog/rtl
 *   node scripts/build-reference.mjs --zip    # also rebuild public/samples/reference-rtl-{verilog,systemverilog}.zip (needs `zip`)
 *   node scripts/build-reference.mjs --check  # exit 1 if reference/systemverilog is out of date
 *
 * Then refresh the 5-stage sample waveforms:
 *   UPDATE_SAMPLES=1 npx vitest run src/lib/icarus.integration.test.ts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vDir = join(root, "reference/verilog");
const svDir = join(root, "reference/systemverilog");

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

/** Verilog-2005 → SystemVerilog, for the coding style used in reference/verilog. */
export function toSystemVerilog(text) {
  return text
    .replace(/`include "([A-Za-z0-9_]+)\.vh"/g, '`include "$1.svh"')
    .replace(/\b([A-Z0-9_]+)_VH\b/g, "$1_SVH")
    .replace(/\b(input|output|inout)(\s+)reg {2}/g, "$1$2logic ")
    .replace(/\b(input|output|inout)(\s+)(wire|reg)\b/g, "$1$2logic")
    .replace(/^(\s*)reg(\s)/gm, "$1logic$2")
    // Declarations with an initialiser stay nets (a continuous assignment); plain ones become logic.
    .replace(/^(\s*)wire(\s+(?:\[[^\]]*\]\s*)?[A-Za-z_][^=;]*;)/gm, "$1logic$2")
    .replace(/^(.*)\n(\s*)always @\(posedge/gm, (m, prev, ind) => (prev.includes("not always_ff") ? m : `${prev}\n${ind}always_ff @(posedge`))
    .replace(/always @\*/g, "always_comb")
    .replace(/\bVerilog-2005\b/g, "SystemVerilog")
    .replace(/(\w)\.v\b/g, "$1.sv");
}

function svFiles() {
  const out = new Map();
  for (const f of walk(join(vDir, "rtl"))) {
    const rel = relative(join(vDir, "rtl"), f).replace(/\.v$/, ".sv").replace(/\.vh$/, ".svh");
    out.set(rel, toSystemVerilog(readFileSync(f, "utf8")));
  }
  return out;
}

const check = process.argv.includes("--check");
const files = svFiles();
let stale = false;
for (const [rel, text] of files) {
  const dest = join(svDir, "rtl", rel);
  let current = null;
  try {
    current = readFileSync(dest, "utf8");
  } catch {
    /* missing */
  }
  if (current === text) continue;
  stale = true;
  if (!check) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
    console.log(`wrote reference/systemverilog/rtl/${rel}`);
  }
}
if (check) {
  if (stale) {
    console.error("reference/systemverilog is out of date: run node scripts/build-reference.mjs");
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes("--zip")) {
  // Test programs come from src/lib/examples/programs.ts (one JSON object per line).
  const programs = readFileSync(join(root, "src/lib/examples/programs.ts"), "utf8")
    .split("\n")
    .filter((l) => l.trim().startsWith('{"id"'))
    .map((l) => JSON.parse(l.trim().replace(/,$/, "")));
  for (const [lang, dir] of [
    ["verilog", vDir],
    ["systemverilog", svDir],
  ]) {
    const stage = mkdtempSync(join(tmpdir(), "pipelith-ref-"));
    const top = `pipelith-reference-${lang}`;
    for (const f of walk(join(dir, "rtl"))) {
      const dest = join(stage, top, "rtl", relative(join(dir, "rtl"), f));
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(f, dest);
    }
    copyFileSync(join(dir, "README.md"), join(stage, top, "README.md"));
    mkdirSync(join(stage, top, "programs"), { recursive: true });
    for (const p of programs) writeFileSync(join(stage, top, "programs", p.file), p.source);
    const zip = join(root, `public/samples/reference-rtl-${lang}.zip`);
    rmSync(zip, { force: true });
    execFileSync("zip", ["-9", "-q", "-r", "-X", zip, top], { cwd: stage });
    rmSync(stage, { recursive: true, force: true });
    console.log(`wrote public/samples/reference-rtl-${lang}.zip`);
  }
}

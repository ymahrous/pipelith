import { describe, expect, it } from "vitest";
import { disassemble, parseMemFile } from "./asm/memfile";
import { assemble } from "./asm/assembler";
import { risc6 } from "./isa/risc6";
import { EXAMPLES } from "./examples/programs";
import { decodeShare, emptySession, encodeShare, parseSession } from "./session/session";
import { generateTestbench, safeFileName, safeIdent, safeRelPath } from "./tb/testbench";
import { crc32, createZip } from "./util/zip";
import { analyze } from "./session/analyze";
import { buildReport, reportToMarkdown } from "./report/report";
import { LEGACY_STORAGE_KEYS, migrateLegacyStorage, resetLegacyMigrationForTests } from "./util/storage";
import { STORAGE_KEY } from "./session/session";
import { ANALYTICS_OPT_OUT_KEY } from "./util/privacy";
import { SITE } from "./site";

describe(".mem import", () => {
  it("round-trips an assembled program", () => {
    const asm = assemble(EXAMPLES[0].source, risc6);
    const lines = [...Array(asm.highestAddress + 1)].map((_, a) => (asm.memory.get(a) ?? 0).toString(2).padStart(32, "0"));
    const imp = parseMemFile(lines.join("\n"), risc6);
    expect(imp.diagnostics).toEqual([]);
    const rows = disassemble(imp.memory, risc6);
    expect(rows.find((r) => r.address === 0xa1)?.text).toBe("NOT R1");
  });
  it("reports lines the VHDL loader would skip", () => {
    const imp = parseMemFile("0101\n" + "0".repeat(32), risc6);
    expect(imp.diagnostics[0].code).toBe("bad-word");
  });
});

describe("session validation", () => {
  it("rejects non-sessions", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession({ v: 2 })).toBeNull();
    expect(parseSession("x")).toBeNull();
  });
  it("drops malformed and hostile fields", () => {
    const s = parseSession({
      v: 1,
      profileId: "__proto__",
      name: "a\u0000b",
      inputs: { "zz": [1], "1A": [1, -5, 2 ** 40, 7] },
      interrupts: [{ pc: -1 }, { pc: 16, occurrence: 2 }],
      maxSteps: 1e12,
      rtlRoot: "../../etc",
      userChecks: [{ id: "x", kind: "eval" }, { id: "y", kind: "reg", reg: 9, value: 3 }],
    })!;
    expect(s.profileId).toBe("risc6");
    expect(s.name).toBe("ab");
    expect(s.inputs).toEqual({ "1A": [1, 7] });
    expect(s.interrupts).toEqual([{ pc: 16, occurrence: 2 }]);
    expect(s.maxSteps).toBe(emptySession().maxSteps);
    expect(s.rtlRoot).toBe("src/rtl");
    expect(s.userChecks.map((c) => [c.kind, c.reg])).toEqual([["reg", undefined]]);
  });
  it("round-trips through a share link", async () => {
    const s = { ...emptySession(), name: "Branch", source: EXAMPLES[3].source, interrupts: [{ pc: 0x75, occurrence: 1 }] };
    const token = await encodeShare(s);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeLessThan(s.source.length);
    const back = await decodeShare(token);
    expect(back?.source).toBe(s.source);
    expect(back?.interrupts).toEqual(s.interrupts);
  });
  it("refuses corrupt share links", async () => {
    expect(await decodeShare("not base64!")).toBeNull();
    expect(await decodeShare("AAAA")).toBeNull();
  });
});

describe("testbench generator", () => {
  const asm = assemble(EXAMPLES[0].source, risc6);
  const tb = generateTestbench({
    profile: risc6,
    memFileName: "program.mem",
    inputs: new Map([[0xa3, [5]], [0xa4, [0x10, 0x11]]]),
    interrupts: [{ pc: 0xa5, occurrence: 1 }],
    cycles: 200,
    rtlRoot: "src/rtl",
  });
  const vhd = tb.files[0].content;
  it("drives IN values by fetch PC", () => {
    expect(vhd).toContain(`when 16#A3# => in_port_s <= x"00000005";`);
    expect(tb.notes.join()).toMatch(/different values/);
  });
  it("holds reset across a falling and a rising edge", () => {
    expect(vhd).toContain("wait for 210 ns;");
  });
  it("lists every RTL file in the GHDL script", () => {
    expect(tb.files[1].content.match(/\$RTL\//g)?.length).toBe(risc6.hardware.compileOrder.length);
    expect(asm.ok).toBe(true);
  });
  it("never lets unsafe names into generated code", () => {
    expect(safeIdent("x; rm -rf /", "ok")).toBe("ok");
    expect(safeFileName("../a.mem", "p.mem")).toBe("p.mem");
    expect(safeRelPath("a/../../b", ".")).toBe(".");
    expect(safeRelPath("src/rtl", ".")).toBe("src/rtl");
  });
});

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("writes a well-formed archive", () => {
    const z = createZip([{ name: "a.txt", content: "hello" }, { name: "b.sh", content: "#!/bin/sh", executable: true }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(z.length - 12, true)).toBe(2);
  });
});

describe("report", () => {
  it("renders Markdown with escaped table cells", () => {
    const s = { ...emptySession(), name: "a | b", source: EXAMPLES[1].source };
    const md = reportToMarkdown(buildReport(s, analyze(s), null, new Date(0)));
    expect(md).toContain("# Validation report: a \\| b");
    expect(md).toContain("| 17 | R5 = FFFFFFFF | fail");
  });
});

describe("privacy helpers", () => {
  it("reduces analytics URLs to origin and path, dropping share-link programs", async () => {
    const { scrubUrl } = await import("./util/privacy");
    expect(scrubUrl("https://x.dev/workbench/program?line=4#s=SECRETPROGRAM")).toBe("https://x.dev/workbench/program");
    expect(scrubUrl("not a url")).toBe("");
  });
  it("blocks analytics outside the browser", async () => {
    const { analyticsBlocked } = await import("./util/privacy");
    expect(analyticsBlocked()).toBe(true);
  });
});

describe("forwarding in the session", () => {
  it("defaults to full forwarding and validates stored settings", () => {
    expect(emptySession().forwarding).toEqual({ enabled: true, paths: "all", writeThrough: true });
    const s = parseSession({ v: 1, forwarding: { enabled: false, paths: ["MEM/WB", "<script>", 5], writeThrough: false } })!;
    expect(s.forwarding).toEqual({ enabled: false, paths: ["MEM/WB"], writeThrough: false });
    expect(parseSession({ v: 1, forwarding: "x" })!.forwarding.paths).toBe("all");
  });
  it("records the forwarding mode in reports", () => {
    const s = { ...emptySession(), source: EXAMPLES[0].source, stages: 5 as const, forwarding: { enabled: false, paths: [] as string[], writeThrough: true } };
    const md = reportToMarkdown(buildReport(s, analyze(s), null, new Date(0)));
    expect(md).toContain("5-stage pipeline, no forwarding");
  });
});

describe("brand and storage migration", () => {
  const memory = (init: Record<string, string>): Storage => {
    const m = new Map(Object.entries(init));
    return {
      get length() {
        return m.size;
      },
      clear: () => m.clear(),
      key: (i: number) => [...m.keys()][i] ?? null,
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };

  it("uses the Pipelith name and keys", () => {
    expect(SITE.name).toBe("Pipelith");
    expect(STORAGE_KEY).toBe("pipelith:session:v1");
    expect(ANALYTICS_OPT_OUT_KEY).toBe("pipelith:analytics-opt-out");
    expect(LEGACY_STORAGE_KEYS.map(([, to]) => to)).toEqual([STORAGE_KEY, ANALYTICS_OPT_OUT_KEY]);
  });

  it("moves old keys once and never overwrites newer data", () => {
    resetLegacyMigrationForTests();
    const s = memory({ "processor-workbench:session:v1": "old", "processor-workbench:analytics-opt-out": "1", [STORAGE_KEY]: "new" });
    migrateLegacyStorage(s);
    expect(s.getItem(STORAGE_KEY)).toBe("new");
    expect(s.getItem(ANALYTICS_OPT_OUT_KEY)).toBe("1");
    expect(s.getItem("processor-workbench:session:v1")).toBeNull();
    expect(s.getItem("processor-workbench:analytics-opt-out")).toBeNull();
    resetLegacyMigrationForTests();
  });

  it("is safe without storage", () => {
    resetLegacyMigrationForTests();
    expect(() => migrateLegacyStorage(undefined)).not.toThrow();
  });
});

describe("documentation examples", () => {
  it("the /docs/checks example assembles and every check passes", async () => {
    const { CHECKS_EXAMPLE } = await import("./content/checksExample");
    const { withProgram } = await import("./session/session");
    const a = analyze(withProgram(emptySession(), { name: "docs", source: CHECKS_EXAMPLE }));
    expect(a.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const kinds = new Set(a.checks.map((c) => c.kind));
    for (const k of ["reg", "sp", "mem", "flag", "branch", "not-executed"]) expect(kinds).toContain(k);
    expect(a.checkResults.length).toBeGreaterThanOrEqual(12);
    expect(a.checkResults.filter((r) => r.status !== "pass").map((r) => `${r.expected}: ${r.actual}`)).toEqual([]);
    expect(a.inputs.get(0x10)).toEqual([0x30]);
  });

  it("withProgram keeps the design settings and resets the program", async () => {
    const { withProgram } = await import("./session/session");
    const base = { ...emptySession(), stages: 5 as const, compileOrder: ["a.vhd"], rtlRoot: "rtl", userChecks: [] };
    base.forwarding = { enabled: false, paths: [], writeThrough: false };
    const s = withProgram({ ...base, finalValues: "R1=1", name: "old" }, { name: "new", source: "HLT" });
    expect(s).toMatchObject({ stages: 5, compileOrder: ["a.vhd"], rtlRoot: "rtl", name: "new", source: "HLT", finalValues: "" });
    expect(s.forwarding).toEqual(base.forwarding);
  });
});

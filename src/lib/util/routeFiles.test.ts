import { describe, expect, it } from "vitest";
import { routeFiles } from "./routeFiles";

describe("quick start routing", () => {
  it("sends codebases to code review", () => {
    expect(routeFiles(["cpu.zip"]).kind).toBe("review");
    expect(routeFiles(["alu.vhd", "cpu.VHDL", "test.asm"])).toEqual({ kind: "review", files: [0, 1, 2] });
    expect(routeFiles(["alu.v", "defs.vh"])).toEqual({ kind: "review", files: [0, 1] });
    expect(routeFiles(["core.sv", "pkg.svh", "notes.txt"]).kind).toBe("review");
  });
  it("opens programs, waveforms and final values", () => {
    expect(routeFiles(["t.asm"])).toEqual({ kind: "program", program: 0 });
    expect(routeFiles(["image.mem"]).kind).toBe("program");
    expect(routeFiles(["wave.vcd.gz"])).toEqual({ kind: "waveform", waveform: 0 });
    expect(routeFiles(["wave.vcd", "t.asm"])).toEqual({ kind: "program+waveform", program: 1, waveform: 0 });
    expect(routeFiles(["final.txt"])).toEqual({ kind: "values", values: 0 });
    expect(routeFiles(["t.asm", "final.txt"])).toEqual({ kind: "program+values", program: 0, values: 1 });
  });
  it("explains what it can't use", () => {
    expect(routeFiles([]).kind).toBe("unknown");
    expect(routeFiles(["a.asm", "b.asm"]).kind).toBe("unknown");
    expect(routeFiles(["a.vcd", "b.vcd"]).kind).toBe("unknown");
    const r = routeFiles(["photo.png"]);
    expect(r.kind === "unknown" && r.reason).toMatch(/\.zip/);
  });
});

import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../examples/programs";
import { analyze } from "../session/analyze";
import { emptySession } from "../session/session";
import { compareFinalValues, parseFinalValues } from "./finalValues";

describe("final values", () => {
  it("accepts the common ways people write register values", () => {
    const p = parseFinalValues(
      "R1=1E, r2: 0x5\n/processor/r3 00000019\ntb.uut.sp_value=FFF  out_port=0\nZ=1 N=0 C=0 # flags\nR4 00000000000000000000000000000101",
    );
    expect(p.errors).toEqual([]);
    expect(p.entries.map((e) => [e.key, e.value])).toEqual([
      ["R1", 0x1e],
      ["R2", 5],
      ["R3", 0x19],
      ["SP", 0xfff],
      ["OUT", 0],
      ["Z", 1],
      ["N", 0],
      ["C", 0],
      ["R4", 5],
    ]);
  });
  it("explains what is wrong with bad lines", () => {
    const p = parseFinalValues("R9=1\nfoo=2\nZ=5\nhello");
    expect(p.errors.map((e) => e.line)).toEqual([1, 2, 3, 4]);
    expect(p.errors[3].message).toMatch(/NAME=VALUE/);
  });
  it("ignores names that collide with Object.prototype", () => {
    expect(parseFinalValues("constructor=1 __proto__=2").entries).toEqual([]);
  });
  it("compares against the model's final state", () => {
    const a = analyze({ ...emptySession(), source: EXAMPLES.find((e) => e.id === "memory")!.source });
    const r = compareFinalValues(a.sim!, parseFinalValues("R2=1E R1=0 SP=FFF").entries);
    expect(r.rows.map((x) => [x.key, x.status])).toEqual([
      ["R1", "mismatch"],
      ["R2", "match"],
      ["SP", "match"],
    ]);
    expect(r.rows[0].expected).toBe("00000019");
  });
});

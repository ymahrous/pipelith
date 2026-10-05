import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { parseVcdFile, VcdError, VcdParser, vcdToNumber } from "./parser";

const SAMPLE = `$date today $end
$timescale 1 ns $end
$scope module tb $end
$var reg 1 ! clk $end
$scope module uut $end
$var wire 4 " r1 [3:0] $end
$var reg 4 # r2[3:0] $end
$upscope $end
$upscope $end
$enddefinitions $end
$comment ignore me $end
#0
$dumpvars
0!
bx "
b0 #
$end
#5
1!
b101 "
#5
b110 "
#10
0!
b1 #
`;

function parse(text: string, keep: (p: string) => boolean = () => true, chunk = 7) {
  const p = new VcdParser((sigs) => new Set(sigs.map((s) => s.path).filter(keep)));
  for (let i = 0; i < text.length; i += chunk) p.push(text.slice(i, i + chunk));
  return p.end();
}

describe("VCD parser", () => {
  it("reads scopes, widths and bus names with or without a space before the range", () => {
    const d = parse(SAMPLE);
    expect(d.signals.map((s) => [s.path, s.width])).toEqual([
      ["tb.clk", 1],
      ["tb.uut.r1", 4],
      ["tb.uut.r2", 4],
    ]);
    expect(d.timescaleFs).toBe(1e6);
  });

  it("is independent of chunk boundaries", () => {
    for (const chunk of [1, 3, 64, 10_000]) {
      expect(parse(SAMPLE, () => true, chunk).changes.get("tb.uut.r1")).toEqual([
        { t: 0, v: "x" },
        { t: 5e6, v: "110" },
      ]);
    }
  });

  it("keeps only the selected signals", () => {
    const d = parse(SAMPLE, (p) => p.endsWith("r2"));
    expect([...d.changes.keys()]).toEqual(["tb.uut.r2"]);
  });

  it("rejects files that are not VCD", () => {
    expect(() => parse("<html><script>alert(1)</script>")).toThrow(VcdError);
    expect(() => parse("$timescale 1 ns $end\n$enddefinitions $end\n#0\nzzz?? garbage")).toThrow(VcdError);
  });

  it("converts values and treats X/U/Z as undefined", () => {
    expect(vcdToNumber("101")).toBe(5);
    expect(vcdToNumber("x")).toBeNull();
    expect(vcdToNumber("1u01")).toBeNull();
    expect(vcdToNumber("1".repeat(40))).toBe(0xffffffff);
  });
});

describe("parseVcdFile", () => {
  const all = (sigs: { path: string }[]) => new Set(sigs.map((s) => s.path));
  it("reads plain and gzipped files the same way", async () => {
    const plain = await parseVcdFile(new Blob([SAMPLE]), all);
    const gz = await parseVcdFile(new Blob([gzipSync(SAMPLE)]), all, undefined, { gzip: true });
    expect([...gz.changes.entries()]).toEqual([...plain.changes.entries()]);
  });
  it("reports a corrupt .gz clearly", async () => {
    await expect(parseVcdFile(new Blob(["not gzip"]), all, undefined, { gzip: true })).rejects.toThrow(/could not be unpacked/);
  });
});

"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { MAX_SOURCE_BYTES } from "@/lib/asm/assembler";
import { MAX_MEM_BYTES } from "@/lib/asm/memfile";
import { EXAMPLES } from "@/lib/examples/programs";
import { FULL_FORWARDING } from "@/lib/pipeline/pipeline";
import { MAX_FINAL_VALUES_CHARS, withProgram, type Session } from "@/lib/session/session";
import { readTextFile } from "@/lib/util/download";
import { routeFiles } from "@/lib/util/routeFiles";
import { useWorkbench } from "./SessionProvider";

/** The bundled test the demo opens; its GHDL waveform ships in /public/samples. */
export const DEMO_EXAMPLE = "memory";

/**
 * Reference-design waveforms of the bundled tests: the 6-stage VHDL processor
 * (GHDL) in /samples, the 5-stage Verilog processor (Icarus Verilog) in /samples/verilog.
 */
export const SAMPLE_DESIGNS = {
  6: { dir: "/samples", label: "GHDL, 6-stage VHDL reference", sim: "GHDL 4.1", design: "the 6-stage VHDL reference processor" },
  5: { dir: "/samples/verilog", label: "Icarus Verilog, 5-stage Verilog reference", sim: "Icarus Verilog 12", design: "the 5-stage Verilog reference processor" },
} as const;

export async function fetchSampleWave(id: string, depth: 5 | 6 = 6): Promise<Blob> {
  const res = await fetch(`${SAMPLE_DESIGNS[depth].dir}/${id}.vcd.gz`);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  return new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).blob();
}

async function readProgram(f: File): Promise<{ name: string; source: string; sourceKind: Session["sourceKind"] }> {
  const isMem = /\.mem$/i.test(f.name);
  const text = await readTextFile(f, isMem ? MAX_MEM_BYTES : MAX_SOURCE_BYTES);
  if (text.includes("\u0000")) throw new Error(`${f.name} looks like a binary file, not text.`);
  return { name: f.name.replace(/\.(asm|s|txt|mem)$/i, ""), source: text, sourceKind: isMem ? "mem" : "asm" };
}

/**
 * Shortcuts that skip steps: open whatever files were dropped on the right
 * page, or run the full demo in one click.
 */
export function useQuickStart() {
  const { update, loadWave, toast, setHandoff } = useWorkbench();
  const router = useRouter();

  const open = useCallback(
    async (files: File[]): Promise<string | null> => {
      const d = routeFiles(files.map((f) => f.name));
      try {
        switch (d.kind) {
          case "unknown":
            return d.reason;
          case "review":
            setHandoff(files);
            router.push("/review");
            return null;
          case "program": {
            const p = await readProgram(files[d.program]);
            update((s) => withProgram(s, { ...p, goal: s.goal === "sample" ? "hardware" : s.goal }));
            toast(`Opened ${files[d.program].name}`);
            router.push("/workbench/assemble");
            return null;
          }
          case "program+waveform": {
            const p = await readProgram(files[d.program]);
            update((s) => withProgram(s, { ...p, goal: "hardware" }));
            router.push("/workbench/compare");
            await loadWave(files[d.waveform], files[d.waveform].name, "upload");
            return null;
          }
          case "waveform":
            update((s) => ({ ...s, goal: "hardware" }));
            router.push("/workbench/compare");
            await loadWave(files[d.waveform], files[d.waveform].name, "upload");
            toast("Waveform loaded. Open the program it ran to compare.");
            return null;
          case "program+values":
          case "values": {
            const values = await readTextFile(files[d.values], MAX_FINAL_VALUES_CHARS);
            const p = d.kind === "program+values" ? await readProgram(files[d.program]) : null;
            update((s) => ({ ...(p ? withProgram(s, p) : s), goal: "hardware", finalValues: values }));
            router.push("/workbench/compare");
            return null;
          }
        }
      } catch (e) {
        return e instanceof Error ? e.message : "Could not open those files.";
      }
    },
    [loadWave, router, setHandoff, toast, update],
  );

  /**
   * Bundled test + its GHDL waveform, straight to the results. Compare loads the
   * sample waveform itself as soon as it shows the "Bundled sample" option.
   */
  const runDemo = useCallback(() => {
    const ex = EXAMPLES.find((e) => e.id === DEMO_EXAMPLE)!;
    // The sample waveforms come from the 6-stage reference design with full forwarding.
    update((s) => ({ ...withProgram(s, { name: ex.title, source: ex.source, goal: "sample" }), stages: 6, forwarding: { ...FULL_FORWARDING } }));
    router.replace("/workbench/compare");
  }, [router, update]);

  return { open, runDemo };
}

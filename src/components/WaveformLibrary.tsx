"use client";

import { useRouter } from "next/navigation";
import { EXAMPLES } from "@/lib/examples/programs";
import { describeForwarding, geometry, type Depth } from "@/lib/pipeline/pipeline";
import { analyze } from "@/lib/session/analyze";
import { emptySession, withProgram } from "@/lib/session/session";
import { downloadBlob } from "@/lib/util/download";
import { expectedWaveform } from "@/lib/wave/expected";
import { PipelineSettings } from "./DepthPicker";
import { useWorkbench } from "./SessionProvider";
import { SAMPLE_DESIGNS } from "./useQuickStart";

/** Every standard test: expected waveforms for both depths, and the reference designs' simulations. */
export function WaveformLibrary() {
  const { session, update } = useWorkbench();
  const router = useRouter();
  const fwd = (d: Depth) => describeForwarding(geometry(d), session.forwarding);

  const expected = (id: string, depth: Depth) => {
    const ex = EXAMPLES.find((e) => e.id === id)!;
    const a = analyze({ ...emptySession(), source: ex.source, stages: depth, forwarding: session.forwarding, options: session.options });
    if (!a.sim || !a.timing) return;
    const w = expectedWaveform({ profile: a.profile, sim: a.sim, timing: a.timing, programName: ex.file });
    downloadBlob(`${ex.id}-expected-${depth}stage.vcd`, w.vcd, "text/plain");
  };
  const open = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id)!;
    update((s) => withProgram(s, { name: ex.title, source: ex.source }));
    router.push("/workbench/simulate");
  };

  return (
    <div className="stack">
      <details className="panel">
        <summary className="small">
          <strong>Pipeline settings for the expected waveforms</strong> — forwarding: {fwd(session.stages)}
        </summary>
        <div className="section">
          <PipelineSettings legend="Expected waveforms" />
        </div>
      </details>
      <ul className="wave-list">
        {EXAMPLES.map((ex) => (
          <li key={ex.id} className="wave-card">
            <div className="stack stack--tight">
              <h3>
                {ex.title} <span className="mono xsmall muted">{ex.file}</span>
              </h3>
              <p className="small muted">{ex.summary}</p>
            </div>
            <div className="wave-card__group">
              <span className="xsmall wave-card__label">Expected (made in your browser)</span>
              <div className="btn-row">
                {([5, 6] as Depth[]).map((d) => (
                  <button key={d} type="button" className="btn btn--small" onClick={() => expected(ex.id, d)}>
                    {d} stages (.vcd)
                    <span className="visually-hidden"> — expected waveform of {ex.file}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="wave-card__group">
              <span className="xsmall wave-card__label">Simulated reference designs</span>
              <div className="btn-row">
                {([6, 5] as const).map((d) => (
                  <a key={d} className="btn btn--small" href={`${SAMPLE_DESIGNS[d].dir}/${ex.id}.vcd.gz`} download={`${ex.id}-${d}stage-${d === 6 ? "vhdl-ghdl" : "verilog-icarus"}.vcd.gz`}>
                    {d === 6 ? "6-stage VHDL, GHDL" : "5-stage Verilog, Icarus"} (.vcd.gz)
                    <span className="visually-hidden"> — simulated waveform of {ex.file}</span>
                  </a>
                ))}
              </div>
            </div>
            <div>
              <button type="button" className="linkbtn small" onClick={() => open(ex.id)}>
                Open {ex.file} in the workbench
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

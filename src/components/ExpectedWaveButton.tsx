"use client";

import { describeForwarding } from "@/lib/pipeline/pipeline";
import { downloadBlob, slug } from "@/lib/util/download";
import { expectedWaveform } from "@/lib/wave/expected";
import { useWorkbench } from "./SessionProvider";

/**
 * Download what a correct design with the selected depth and forwarding should
 * show for the open program, as a VCD built from the model (no simulator needed).
 */
export function ExpectedWaveButton({ className = "btn" }: { className?: string }) {
  const { session, analysis, toast } = useWorkbench();
  if (!analysis.sim || !analysis.timing) return null;
  const download = () => {
    const w = expectedWaveform({ profile: analysis.profile, sim: analysis.sim!, timing: analysis.timing!, programName: session.name });
    downloadBlob(`${slug(session.name)}-expected-${session.stages}stage.vcd`, w.vcd, "text/plain");
    if (w.truncated) toast(`The waveform covers the first ${w.cycles.toLocaleString()} cycles.`);
  };
  return (
    <button type="button" className={className} onClick={download}>
      Download expected waveform (.vcd)
      <span className="visually-hidden">
        {" "}
        for {session.stages} stages, {describeForwarding(analysis.timing.geometry, analysis.timing.forwarding)}
      </span>
    </button>
  );
}

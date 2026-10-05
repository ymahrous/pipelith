"use client";

import { describeForwarding, STALL_LABEL, type StallKind, type TimingEstimate } from "@/lib/pipeline/pipeline";

const MAX_ROWS = 18;

/** Stall breakdown and a classic instruction × cycle pipeline diagram. */
export function PipelineTiming({ timing }: { timing: TimingEstimate }) {
  const g = timing.geometry;
  const rows = timing.instructions.slice(0, MAX_ROWS);
  const lastCycle = rows.length ? rows[rows.length - 1].writeback : 0;
  const cycles = Array.from({ length: Math.min(lastCycle, 60) }, (_, i) => i + 1);
  const stallTotal = Object.values(timing.stalls).reduce((a, b) => a + b, 0);
  return (
    <div className="stack">
      <dl className="kv">
        <dt>Estimated cycles</dt>
        <dd>
          {timing.totalCycles.toLocaleString()} (CPI {timing.cpi.toFixed(2)})
        </dd>
        <dt>Bubbles</dt>
        <dd>{stallTotal.toLocaleString()}</dd>
        {(Object.keys(timing.stalls) as StallKind[])
          .filter((k) => timing.stalls[k] > 0)
          .flatMap((k) => [
            <dt key={k + "t"}>· {STALL_LABEL[k]}</dt>,
            <dd key={k + "d"}>{timing.stalls[k].toLocaleString()}</dd>,
          ])}
      </dl>
      <p className="muted xsmall">
        Estimate for an in-order {g.depth}-stage pipeline ({g.stages.join(" → ")}) with {describeForwarding(g, timing.forwarding)},
        conditional branches resolved in {g.stages[g.branchResolve]}, and one shared memory port. Compare it with your design&apos;s
        cycle count in step 5.
      </p>
      <div className="table-wrap">
        <table className="pipe-diagram" aria-label="Pipeline diagram">
          <thead>
            <tr>
              <th scope="col">Instruction</th>
              {cycles.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const stalled = Object.entries(r.stalls).filter(([, v]) => v);
              return (
                <tr key={i}>
                  <th scope="row" className="mono">
                    {r.event.kind === "interrupt" ? "IRQ" : r.event.text}
                    {stalled.length > 0 && (
                      <span className="pipe-stall" title={stalled.map(([k, v]) => `${STALL_LABEL[k as StallKind]}: ${v}`).join(", ")}>
                        {" "}
                        +{stalled.reduce((a, [, v]) => a + (v ?? 0), 0)}
                      </span>
                    )}
                  </th>
                  {cycles.map((c) => {
                    const idx = c - r.fetch;
                    const st = idx >= 0 && idx < g.depth ? g.stages[idx] : "";
                    return (
                      <td key={c} className={st ? `pipe-cell pipe-${st.toLowerCase()}` : undefined}>
                        {st}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {timing.instructions.length > MAX_ROWS && (
        <p className="muted xsmall">First {MAX_ROWS} of {timing.instructions.length} instructions shown.</p>
      )}
      {timing.notes.map((n) => (
        <p key={n} className="small muted">
          {n}
        </p>
      ))}
    </div>
  );
}

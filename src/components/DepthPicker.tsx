"use client";

import { activePaths, describeForwarding, geometry, type Depth } from "@/lib/pipeline/pipeline";
import { useWorkbench } from "./SessionProvider";

type Mode = "full" | "partial" | "none";

/**
 * Pipeline settings used by every scan: depth, whether forwarding is allowed,
 * and which forwarding paths exist. The workbench (timing, verdict, testbench)
 * and Code review (pipeline checks) all read the same session values.
 */
export function PipelineSettings({ legend = "Your design" }: { legend?: string }) {
  const { session, update } = useWorkbench();
  const g = geometry(session.stages);
  const f = session.forwarding;
  const active = activePaths(g, f);
  const mode: Mode = !f.enabled ? "none" : f.paths === "all" || active.length === g.forwardingSources.length ? "full" : "partial";

  const setDepth = (d: Depth) =>
    update((s) => ({
      ...s,
      stages: d,
      // Path names differ between depths; keep the mode, reset an explicit selection.
      forwarding: Array.isArray(s.forwarding.paths) && s.forwarding.enabled ? { ...s.forwarding, paths: "all" } : s.forwarding,
    }));
  const setMode = (m: Mode) =>
    update((s) => ({
      ...s,
      forwarding:
        m === "full"
          ? { ...s.forwarding, enabled: true, paths: "all" }
          : m === "none"
            ? { ...s.forwarding, enabled: false, paths: [] }
            : { ...s.forwarding, enabled: true, paths: [g.forwardingSources[g.forwardingSources.length - 1]] },
    }));
  const togglePath = (p: string, on: boolean) =>
    update((s) => {
      const cur = activePaths(g, s.forwarding);
      const next = on ? [...new Set([...cur, p])] : cur.filter((x) => x !== p);
      return { ...s, forwarding: { ...s.forwarding, enabled: true, paths: g.forwardingSources.filter((x) => next.includes(x)) } };
    });

  return (
    <div className="pipe-settings">
      <fieldset className="option-tabs">
        <legend className="field__label">{legend}: pipeline depth</legend>
        {([5, 6] as Depth[]).map((d) => (
          <label key={d} className={`option-tab${session.stages === d ? " option-tab--on" : ""}`}>
            <input type="radio" name="stages" value={d} checked={session.stages === d} onChange={() => setDepth(d)} />
            {d} stages
            <span className="option-tab__hint">{geometry(d).stages.join(" ")}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="option-tabs">
        <legend className="field__label">Forwarding allowed</legend>
        {(
          [
            ["full", "Full forwarding"],
            ["partial", "Some paths"],
            ["none", "No forwarding"],
          ] as const
        ).map(([m, label]) => (
          <label key={m} className={`option-tab${mode === m ? " option-tab--on" : ""}`}>
            <input type="radio" name="forwarding" value={m} checked={mode === m} onChange={() => setMode(m)} />
            {label}
          </label>
        ))}
      </fieldset>
      {mode !== "none" && (
        <fieldset className="fwd-paths">
          <legend className="field__label">Forwarding paths into {g.stages[g.execute]}</legend>
          {g.forwardingSources.map((p) => (
            <label key={p} className="check-row">
              <input type="checkbox" checked={active.includes(p)} onChange={(e) => togglePath(p, e.target.checked)} />
              <span>
                <span className="mono">{p} → {g.stages[g.execute]}</span>{" "}
                <span className="muted xsmall">
                  {p === g.forwardingSources[0]
                    ? "result of the instruction just ahead"
                    : p === g.forwardingSources[g.forwardingSources.length - 1]
                      ? "result about to be written back (also covers load data)"
                      : "result two instructions ahead (and load data on 6 stages)"}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <label className="check-row">
        <input
          type="checkbox"
          checked={f.writeThrough}
          onChange={(e) => update((s) => ({ ...s, forwarding: { ...s.forwarding, writeThrough: e.target.checked } }))}
        />
        <span>
          Register file writes before it reads in the same cycle{" "}
          <span className="muted xsmall">(write-back and decode can share a cycle)</span>
        </span>
      </label>
      <p className="muted xsmall">Checking against: {session.stages} stages, {describeForwarding(g, f)}.</p>
    </div>
  );
}

/** Kept for existing imports. */
export const DepthPicker = PipelineSettings;

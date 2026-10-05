"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { addrKey } from "@/lib/session/session";
import { HARD_MAX_STEPS, FLAG_C, FLAG_N, FLAG_Z, stateAt, type StepEvent } from "@/lib/sim/simulator";
import { useWorkbench } from "../SessionProvider";
import { StepFrame } from "../StepFrame";
import { Badge, Empty, h8, hx } from "../ui";
import { PipelineSettings } from "../DepthPicker";
import { PipelineTiming } from "../PipelineTiming";

const HALT_TEXT = {
  hlt: "Reached HLT",
  "max-steps": "Stopped at the step limit",
  "pc-out-of-range": "PC left memory",
} as const;

function parseValues(text: string): number[] | null {
  const parts = text
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    if (!/^(0x)?[0-9a-f_]{1,10}$/i.test(p)) return null;
    const v = parseInt(p.replace(/^0x/i, "").replace(/_/g, ""), 16);
    if (!Number.isFinite(v) || v > 0xffffffff) return null;
    out.push(v >>> 0);
  }
  return out.slice(0, 64);
}

export function effectsOf(e: StepEvent): string[] {
  const out: string[] = [];
  for (const w of e.regWrites) out.push(`R${w.reg} ← ${h8(w.after)}`);
  for (const w of e.memWrites) out.push(`M[${hx(w.addr)}] ← ${h8(w.after)}`);
  if (e.spAfter !== e.spBefore) out.push(`SP ${hx(e.spBefore)} → ${hx(e.spAfter)}`);
  if (e.flagsAfter !== e.flagsBefore) {
    const f = (x: number) => `${x & FLAG_Z ? "Z" : "z"}${x & FLAG_N ? "N" : "n"}${x & FLAG_C ? "C" : "c"}`;
    out.push(`flags ${f(e.flagsBefore)} → ${f(e.flagsAfter)}`);
  }
  if (e.out !== undefined) out.push(`OUT ← ${h8(e.out)}`);
  if (e.branch) out.push(e.branch.taken ? `jump → ${hx(e.branch.target)}` : "not taken");
  return out;
}

function InputRow({
  address,
  line,
  text,
  values,
  source,
  onChange,
}: {
  address: number;
  line: number;
  text: string;
  values: number[];
  source: string;
  onChange: (v: number[] | null) => void;
}) {
  const shown = values.map((v) => v.toString(16).toUpperCase()).join(", ");
  // While the field is being edited, show what the user typed; otherwise the stored values.
  const [draft, setDraft] = useState<string | null>(null);
  const bad = draft !== null && parseValues(draft) === null;
  return (
    <tr>
      <td className="mono">{line ? line : hx(address)}</td>
      <td className="mono">{text}</td>
      <td>
        <input
          type="text"
          className="mono"
          aria-label={`IN-port value for ${text} at ${hx(address)}`}
          aria-invalid={bad}
          value={draft ?? shown}
          size={14}
          placeholder="hex, e.g. 1F"
          onChange={(e) => {
            setDraft(e.target.value);
            const v = parseValues(e.target.value);
            if (v !== null) onChange(v.length ? v : null);
          }}
          onBlur={() => setDraft(null)}
        />
        <span
          className={`input-source${source === "none" ? " input-source--warn" : source === "user" ? " input-source--user" : ""}`}
        >
          {bad ? "Use hex values separated by commas" : source === "comment" ? "From the comment" : source === "user" ? "Set by you" : "Not set — reads 0"}
        </span>
      </td>
    </tr>
  );
}

export function SimulateStep() {
  const { session, update, analysis } = useWorkbench();
  const sim = analysis.sim;
  const total = sim?.events.length ?? 0;
  // The cursor belongs to one run; a new run (edited program or inputs) starts at its last step.
  const [cursor, setCursor] = useState<{ sim: typeof sim; p: number }>({ sim: null, p: 0 });
  const p = cursor.sim === sim ? Math.min(cursor.p, total) : total;
  const setPos = (v: number) => setCursor({ sim, p: v });

  const state = useMemo(() => (sim ? stateAt(sim, p) : null), [sim, p]);
  const last = sim && p > 0 ? sim.events[p - 1] : null;
  const changed = new Set(last?.regWrites.map((w) => w.reg));

  const instrAddrs = useMemo(
    () =>
      [...analysis.sourceMap.entries()]
        .filter(([, i]) => i.kind === "instruction")
        .sort((a, b) => a[0] - b[0]),
    [analysis.sourceMap],
  );
  const [irqAddr, setIrqAddr] = useState<string>("");
  const [irqOcc, setIrqOcc] = useState("1");

  const memWritten = useMemo(() => {
    if (!sim) return [];
    const m = new Map<number, number>();
    for (let i = 0; i < p; i++) for (const w of sim.events[i].memWrites) m.set(w.addr, w.after);
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [sim, p]);

  const windowStart = Math.max(0, p - 100);
  const traceRows = sim ? sim.events.slice(windowStart, windowStart + 200) : [];

  if (!session.source.trim() || !analysis.canRun) {
    return (
      <StepFrame slug="simulate" intro="Runs the program one instruction at a time on the reference ISA model.">
        <Empty title={session.source.trim() ? "The program does not assemble yet" : "There is no program yet"}>
          <p className="muted">
            {session.source.trim() ? "Fix the errors listed in Assemble, then come back." : "Load or write a program first."}
          </p>
          <Link className="btn btn--primary" href={session.source.trim() ? "/workbench/assemble" : "/workbench/program"}>
            {session.source.trim() ? "Go to Assemble" : "Go to Program"}
          </Link>
        </Empty>
      </StepFrame>
    );
  }

  const opt = session.options;
  const setOpt = (patch: Partial<typeof opt>) => update((s) => ({ ...s, options: { ...s.options, ...patch } }));

  return (
    <StepFrame
      slug="simulate"
      intro="The reference model executes one instruction per step with no pipeline. It defines what every register, flag and memory word must be — the hardware is compared against this."
    >
      <div className="split">
        <div className="stack">
          {sim && (
            <section aria-labelledby="run-h" className="stack">
              <div className="section__head">
                <h2 id="run-h">Run</h2>
                <div className="btn-row">
                  <Badge tone={sim.haltReason === "hlt" ? "pass" : "warn"}>{HALT_TEXT[sim.haltReason]}</Badge>
                  <span className="muted small">{total.toLocaleString()} steps</span>
                </div>
              </div>
              {sim.warnings.map((w) => (
                <div key={w} className="notice">
                  <span aria-hidden="true">!</span>
                  <span>{w}</span>
                </div>
              ))}

              <div className="panel">
                <div className="scrubber">
                  <button className="btn btn--small" onClick={() => setPos(Math.max(0, p - 1))} disabled={p === 0}>
                    Previous
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={total}
                    value={p}
                    onChange={(e) => setPos(Number(e.target.value))}
                    aria-label="Step"
                    aria-valuetext={`Step ${p} of ${total}`}
                  />
                  <button className="btn btn--small" onClick={() => setPos(Math.min(total, p + 1))} disabled={p === total}>
                    Next
                  </button>
                </div>
                <div className="now-executing" aria-live="polite">
                  <span className="muted">
                    Step {p} of {total}
                  </span>
                  {last ? (
                    <>
                      <span className="instr">{last.kind === "interrupt" ? "⚡ " + last.text : last.text}</span>
                      <span className="mono muted">@ {hx(last.pc)}</span>
                      {last.line && <span className="muted">line {last.line}</span>}
                    </>
                  ) : (
                    <span className="muted">Reset — PC loaded from M[0]</span>
                  )}
                </div>
                {last && (
                  <div className="effects small mono" aria-label="Effects of this step">
                    {effectsOf(last).map((x) => (
                      <span key={x}>{x}</span>
                    ))}
                  </div>
                )}
                {last?.notes.map((n) => (
                  <p key={n} className="small" role="note">
                    <Badge tone="warn">Note</Badge> {n}
                  </p>
                ))}
              </div>

              {state && (
                <div className="stack">
                  <div className="regfile" role="group" aria-label="Registers">
                    {state.regs.map((v, i) => (
                      <div key={i} className={`reg${changed.has(i) ? " reg--changed" : ""}`}>
                        <span className="reg__name">R{i}</span>
                        <span className="reg__val">{h8(v)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="btn-row">
                    <div className="flags" role="group" aria-label="Flags">
                      {(["Z", "N", "C"] as const).map((f) => {
                        const on = !!(state.flags & { Z: FLAG_Z, N: FLAG_N, C: FLAG_C }[f]);
                        return (
                          <span key={f} className={`flag${on ? " flag--on" : ""}`} title={`${f} = ${on ? 1 : 0}`}>
                            {f}
                            <span className="visually-hidden"> = {on ? 1 : 0}</span>
                          </span>
                        );
                      })}
                    </div>
                    <dl className="kv">
                      <dt>PC</dt>
                      <dd>{hx(state.pc)}</dd>
                      <dt>SP</dt>
                      <dd>{hx(state.sp)}</dd>
                      <dt>OUT</dt>
                      <dd>{state.out === null ? "—" : h8(state.out)}</dd>
                    </dl>
                  </div>
                </div>
              )}

              {memWritten.length > 0 && (
                <details className="panel">
                  <summary className="small">
                    <strong>Memory written so far</strong> ({memWritten.length} address{memWritten.length > 1 ? "es" : ""})
                  </summary>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th scope="col">Address</th>
                          <th scope="col">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {memWritten.map(([a, v]) => (
                          <tr key={a}>
                            <td className="mono">{hx(a)}</td>
                            <td className="mono">{h8(v)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </section>
          )}

          <section aria-labelledby="trace-h">
            <div className="section__head">
              <h2 id="trace-h">Trace</h2>
              <p>Select a row to jump to that step.</p>
            </div>
            <div className="panel panel--flush">
              <div className="table-wrap table-wrap--tall">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Step</th>
                      <th scope="col">PC</th>
                      <th scope="col">Instruction</th>
                      <th scope="col">Effect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traceRows.map((e) => (
                      <tr
                        key={e.step}
                        className={`is-clickable${e.step === p - 1 ? " is-current" : ""}`}
                        onClick={() => setPos(e.step + 1)}
                      >
                        <td className="mono num">
                          <button
                            className="linkbtn"
                            aria-label={`Go to step ${e.step + 1}`}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setPos(e.step + 1);
                            }}
                          >
                            {e.step + 1}
                          </button>
                        </td>
                        <td className="mono">{hx(e.pc)}</td>
                        <td className="mono">
                          {e.kind === "interrupt" ? "⚡ IRQ" : e.text}
                          {e.notes.length > 0 && " ⚠"}
                        </td>
                        <td className="mono xsmall">{effectsOf(e).join("  ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {total > 200 && (
              <p className="muted xsmall">Showing steps {windowStart + 1}–{windowStart + traceRows.length}. Move the slider to see others.</p>
            )}
          </section>

          {analysis.timing && (
            <section aria-labelledby="pipe-h" className="stack">
              <div className="section__head">
                <h2 id="pipe-h">Pipeline timing</h2>
                <p>How long this run should take on your pipeline.</p>
              </div>
              <PipelineSettings legend="Timing for" />
              <PipelineTiming timing={analysis.timing} />
            </section>
          )}
        </div>

        <aside className="stack" aria-label="Simulation setup">
          <section className="panel stack stack--tight" aria-labelledby="in-h">
            <h2 id="in-h">IN port values</h2>
            <p className="muted small">
              The value each IN instruction reads. Values from comments are filled in; type to override. Separate several
              values with commas if the instruction runs more than once.
            </p>
            {analysis.inputRows.length ? (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">{session.sourceKind === "asm" ? "Line" : "Addr"}</th>
                      <th scope="col">Instruction</th>
                      <th scope="col">Value (hex)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.inputRows.map((r) => (
                      <InputRow
                        key={r.address}
                        {...r}
                        onChange={(v) =>
                          update((s) => {
                            const inputs = { ...s.inputs };
                            if (v) inputs[addrKey(r.address)] = v;
                            else delete inputs[addrKey(r.address)];
                            return { ...s, inputs };
                          })
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="small">This program has no IN instructions.</p>
            )}
          </section>

          <section className="panel stack stack--tight" aria-labelledby="irq-h">
            <h2 id="irq-h">External interrupts</h2>
            <p className="muted small">
              Raise the interrupt just before an instruction executes. The handler address is read from M[
              {analysis.profile.extIntVector}].
            </p>
            {session.interrupts.length > 0 && (
              <ul className="diag-list">
                {session.interrupts.map((i, k) => (
                  <li key={k} className="diag">
                    <span className="mono xsmall">{hx(i.pc)}</span>
                    <div className="btn-row">
                      <span className="small">
                        {analysis.sourceMap.get(i.pc)?.text ?? "?"} · execution #{i.occurrence}
                      </span>
                      <button
                        className="btn btn--ghost btn--small"
                        onClick={() => update((s) => ({ ...s, interrupts: s.interrupts.filter((_, j) => j !== k) }))}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {instrAddrs.length > 0 && (
              <form
                className="stack stack--tight"
                onSubmit={(e) => {
                  e.preventDefault();
                  const pc = Number(irqAddr || instrAddrs[0][0]);
                  const occurrence = Math.max(1, Math.min(10000, parseInt(irqOcc, 10) || 1));
                  update((s) => ({ ...s, interrupts: [...s.interrupts, { pc, occurrence }].slice(0, 32) }));
                }}
              >
                <label className="field">
                  <span className="field__label">Before instruction</span>
                  <select value={irqAddr} onChange={(e) => setIrqAddr(e.target.value)}>
                    {instrAddrs.map(([a, info]) => (
                      <option key={a} value={a}>
                        {hx(a)} — {info.text}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">On execution number</span>
                  <input type="number" min={1} value={irqOcc} onChange={(e) => setIrqOcc(e.target.value)} />
                </label>
                <button className="btn" type="submit">
                  Add interrupt
                </button>
              </form>
            )}
          </section>

          <section className="panel stack stack--tight" aria-labelledby="opt-h">
            <h2 id="opt-h">Model options</h2>
            <p className="muted small">Where the ISA sheet leaves room for interpretation, choose the behaviour you intend.</p>
            <label className="check-row">
              <input type="checkbox" checked={opt.iaddSignExtend} onChange={(e) => setOpt({ iaddSignExtend: e.target.checked })} />
              <span>IADD sign-extends its 16-bit immediate</span>
            </label>
            <label className="field">
              <span className="field__label">SUB carry flag</span>
              <select value={opt.subCarry} onChange={(e) => setOpt({ subCarry: e.target.value as typeof opt.subCarry })}>
                <option value="notBorrow">C = 1 when there is no borrow (Rsrc1 ≥ Rsrc2)</option>
                <option value="borrow">C = 1 when there is a borrow (Rsrc1 &lt; Rsrc2)</option>
              </select>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={opt.inUpdatesFlags} onChange={(e) => setOpt({ inUpdatesFlags: e.target.checked })} />
              <span>IN updates Z and N</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={opt.extIntPushesFlags}
                onChange={(e) => setOpt({ extIntPushesFlags: e.target.checked })}
              />
              <span>External interrupt also pushes the flags</span>
            </label>
            <label className="field">
              <span className="field__label">Step limit</span>
              <input
                type="number"
                min={1}
                max={HARD_MAX_STEPS}
                value={session.maxSteps}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v)) update({ maxSteps: Math.max(1, Math.min(HARD_MAX_STEPS, v)) });
                }}
              />
              <span className="field__hint">Stops runaway loops. Up to {HARD_MAX_STEPS.toLocaleString()}.</span>
            </label>
          </section>
        </aside>
      </div>
    </StepFrame>
  );
}

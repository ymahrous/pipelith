"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toMemFile } from "@/lib/asm/assembler";
import type { ChannelResult, SignalMapping } from "@/lib/compare/compare";
import { EXAMPLES } from "@/lib/examples/programs";
import { generateTestbench, safeRelPath } from "@/lib/tb/testbench";
import { downloadBlob, slug } from "@/lib/util/download";
import { createZip } from "@/lib/util/zip";
import { MAX_VCD_BYTES } from "@/lib/vcd/parser";
import { describeForwarding, geometry, suggestedCycles } from "@/lib/pipeline/pipeline";
import { PipelineSettings } from "../DepthPicker";
import { judgeTiming } from "@/lib/compare/compare";
import { MAX_FINAL_VALUES_CHARS } from "@/lib/session/session";
import { readTextFile } from "@/lib/util/download";
import { FileDrop } from "../FileDrop";
import { fetchSampleWave } from "../useQuickStart";
import { useWorkbench } from "../SessionProvider";
import { StepFrame } from "../StepFrame";
import { Badge, Empty, hx } from "../ui";

const STATUS: Record<ChannelResult["status"], { tone?: "pass" | "fail" | "warn"; text: string }> = {
  match: { tone: "pass", text: "Match" },
  mismatch: { tone: "fail", text: "Differs" },
  extra: { tone: "fail", text: "Extra write" },
  incomplete: { tone: "warn", text: "Ends early" },
  missing: { text: "Not mapped" },
};

function SequenceTable({ c }: { c: ChannelResult }) {
  if (c.id === "pc") {
    const at = c.divergeAt ?? 0;
    const from = Math.max(0, at - 8);
    return (
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Fetch PC</th>
              <th scope="col">Time</th>
              <th scope="col">Cycle</th>
            </tr>
          </thead>
          <tbody>
            {c.hw.slice(from, at + 6).map((p, i) => (
              <tr key={i} className={from + i === c.divergeAt ? "is-current" : undefined}>
                <td className="mono num">{from + i + 1}</td>
                <td className="mono">{hx(p.value)}</td>
                <td className="mono">{p.timeNs} ns</td>
                <td className="mono num">{p.cycle ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const n = Math.max(c.ref.length, c.hw.length);
  const at = c.divergeAt ?? 0;
  const from = c.divergeAt === null ? 0 : Math.max(0, at - 10);
  const to = Math.min(n, c.divergeAt === null ? 200 : at + 10);
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Model</th>
            <th scope="col">Written by</th>
            <th scope="col">Hardware</th>
            <th scope="col">Time</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: to - from }, (_, k) => {
            const i = from + k;
            const r = c.ref[i];
            const h = c.hw[i];
            const bad = c.divergeAt !== null && i >= c.divergeAt;
            return (
              <tr key={i} className={i === c.divergeAt ? "is-current" : bad ? "is-dim" : undefined}>
                <td className="mono num">{i + 1}</td>
                <td className="mono">{r ? c.format(r.value) : "—"}</td>
                <td className="mono xsmall">
                  {r?.event ? `${r.event.text}${r.event.line ? ` (line ${r.event.line})` : ""}` : r ? "reset" : ""}
                </td>
                <td className="mono">{h ? c.format(h.value) : "—"}</td>
                <td className="mono xsmall">{h ? `${h.timeNs} ns` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {n > to && <p className="muted xsmall">{n - to} more value(s) not shown.</p>}
    </div>
  );
}

function MappingEditor({
  mapping,
  signals,
  onApply,
}: {
  mapping: SignalMapping;
  signals: { path: string; width: number }[];
  onApply: (m: SignalMapping) => void;
}) {
  const [draft, setDraft] = useState(mapping);
  const opts = (width: number | null) =>
    signals.filter((s) => width === null || s.width === width).map((s) => s.path);
  const pick = (label: string, value: string | null, width: number | null, set: (v: string | null) => void) => (
    <label className="field" key={label}>
      <span className="field__label">{label}</span>
      <select value={value ?? ""} onChange={(e) => set(e.target.value || null)}>
        <option value="">— not mapped —</option>
        {opts(width).map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="stack stack--tight">
      <div className="stack stack--tight">
        {pick("Clock", draft.clock, 1, (v) => setDraft({ ...draft, clock: v }))}
        {pick("Reset", draft.reset, 1, (v) => setDraft({ ...draft, reset: v }))}
        <label className="field">
          <span className="field__label">Reset is active</span>
          <select value={draft.resetActive} onChange={(e) => setDraft({ ...draft, resetActive: e.target.value as "low" | "high" })}>
            <option value="low">low (asserted at 0)</option>
            <option value="high">high (asserted at 1)</option>
          </select>
        </label>
        {draft.registers.map((r, i) =>
          pick(`R${i}`, r, 32, (v) => setDraft({ ...draft, registers: draft.registers.map((x, j) => (j === i ? v : x)) })),
        )}
        {pick("OUT port", draft.out, 32, (v) => setDraft({ ...draft, out: v }))}
        {pick("Stack pointer", draft.sp, 32, (v) => setDraft({ ...draft, sp: v }))}
        {pick("Flags (CCR)", draft.flags, null, (v) => setDraft({ ...draft, flags: v }))}
        {pick("Fetch PC", draft.pc, 32, (v) => setDraft({ ...draft, pc: v }))}
      </div>
      <div>
        <button className="btn btn--primary" onClick={() => onApply(draft)}>
          Compare with this mapping
        </button>
      </div>
    </div>
  );
}

type WaveCtx = ReturnType<typeof useWorkbench>;

function WaveResults({ ctx }: { ctx: WaveCtx }) {
  const { wave, report, remap, analysis, session } = ctx;
  const verdict =
    report?.lastChangeCycle != null && analysis.timing
      ? judgeTiming(report.lastChangeCycle, analysis.timing.lastResultCycle, session.stages, session.forwarding)
      : null;
  const [open, setOpen] = useState<string | null>(null);
  const fails = report?.channels.filter((c) => c.status !== "match" && c.status !== "missing") ?? [];
  const first = report?.firstDivergence;
  return (
    <>
            {!report ? (
              <p className="muted small">Results appear here once a waveform is loaded.</p>
            ) : (
              <>
                {report.failed === 0 ? (
                  <div className="notice notice--pass" role="status">
                    <span aria-hidden="true">✓</span>
                    <div>
                      <strong>The hardware matches the reference model</strong>
                      {report.passed} channels produced exactly the expected sequence of values.
                    </div>
                  </div>
                ) : (
                  first && (
                    <div className="notice notice--fail" role="status">
                      <span aria-hidden="true">✕</span>
                      <div>
                        <strong>
                          First divergence: {first.channel.label}
                          {first.hw ? ` at ${first.hw.timeNs} ns` : ""}
                          {first.hw?.cycle != null ? ` (cycle ${first.hw.cycle})` : ""}
                        </strong>
                        {first.channel.summary}
                        {report.failed > 1 && (
                          <div className="xsmall">
                            {report.failed} channels differ in total. Later differences are often consequences of the first.
                          </div>
                        )}
                      </div>
                    </div>
                  )
                )}
                {verdict && (
                  <p className="small">
                    <Badge tone={verdict.tone === "ok" ? "pass" : "warn"}>Timing</Badge> Last result at cycle {verdict.hardware}; the{" "}
                    {session.stages}-stage estimate is {verdict.estimate}. {verdict.message}
                  </p>
                )}
                {report.warnings.map((w) => (
                  <p key={w} className="small">
                    <Badge tone="warn">Note</Badge> {w}
                  </p>
                ))}
                <ul className="channel-list">
                  {[...fails, ...report.channels.filter((c) => !fails.includes(c))].map((c) => (
                    <li key={c.id}>
                      <button aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                        <span className="ch-name">{c.label}</span>
                        <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].text}</Badge>
                        <span className="ch-summary muted">{c.summary}</span>
                      </button>
                      {open === c.id && (
                        <div className="seq">
                          <p className="xsmall muted mono">{c.signal ?? "no signal mapped"}</p>
                          <SequenceTable c={c} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {wave.mapping && (
                  <details className="panel">
                    <summary className="small">
                      <strong>Signal mapping</strong> — found automatically; change it if your design uses other names
                    </summary>
                    <div className="section">
                      <MappingEditor key={JSON.stringify(wave.mapping)} mapping={wave.mapping} signals={wave.signals} onApply={remap} />
                    </div>
                  </details>
                )}
              </>
            )}
    </>
  );
}

function WaveStatus({ ctx }: { ctx: WaveCtx }) {
  const { wave, report, clearWave } = ctx;
  if (wave.progress !== null) {
    return (
      <div className="stack stack--tight" aria-live="polite">
        <span className="small">Reading {wave.name}…</span>
        <progress max={1} value={wave.progress} aria-label="Reading waveform" />
      </div>
    );
  }
  return (
    <>
      {wave.vcd && (
        <div className="btn-row">
          <Badge tone="probe">{wave.name}</Badge>
          <span className="muted small">
            {wave.signals.length.toLocaleString()} signals · reset released at {report?.resetReleaseNs ?? "?"} ns ·{" "}
            {report?.cyclesAfterReset ?? "?"} cycles
          </span>
          <button className="btn btn--ghost btn--small" onClick={clearWave}>
            Remove
          </button>
        </div>
      )}
      {wave.error && (
        <div className="notice notice--fail" role="alert">
          <span aria-hidden="true">!</span>
          <div>
            <strong>That file could not be read</strong>
            {wave.error}
          </div>
        </div>
      )}
    </>
  );
}

type Method = "waveform" | "values" | "sample";

export function CompareStep() {
  const ctx = useWorkbench();
  const { session, update, analysis, wave, loadWave, finalParse, finalReport, toast } = ctx;
  const [rtl, setRtl] = useState(session.rtlRoot);
  const sim = analysis.sim;
  const defaultCycles = analysis.timing ? suggestedCycles(analysis.timing) : sim ? Math.min(1_000_000, sim.events.length * 8 + 100) : 500;
  const cycles = session.tbCycles ?? defaultCycles;
  const example = EXAMPLES.find((e) => e.source === session.source);
  // Until the user picks one, the option follows the session (which loads after the first render).
  const [picked, setMethod] = useState<Method | null>(null);
  const method: Method =
    picked ?? (session.goal === "sample" ? "sample" : session.finalValues.trim() ? "values" : "waveform");

  const tb = useMemo(
    () =>
      generateTestbench({
        profile: analysis.profile,
        memFileName: "program.mem",
        inputs: analysis.inputs,
        interrupts: session.interrupts,
        cycles,
        rtlRoot: session.rtlRoot,
        compileOrder: session.compileOrder,
        stages: session.stages,
        forwardingNote: describeForwarding(geometry(session.stages), session.forwarding),
      }),
    [analysis.profile, analysis.inputs, session.interrupts, cycles, session.rtlRoot, session.compileOrder, session.stages, session.forwarding],
  );

  // "Bundled sample" needs no files: load the matching waveform as soon as the option is shown.
  const autoLoaded = useRef<string | null>(null);
  useEffect(() => {
    if (method !== "sample" || !example || !sim || wave.progress !== null) return;
    const have = wave.origin === "sample" && wave.name.startsWith(`${example.id}.vcd`);
    if (have || autoLoaded.current === example.id) return;
    autoLoaded.current = example.id;
    fetchSampleWave(example.id)
      .then((b) => loadWave(b, `${example.id}.vcd (GHDL, reference RTL)`, "sample", session.stages))
      .catch(() => toast("Could not load the sample waveform."));
  }, [method, example, sim, wave.progress, wave.origin, wave.name, loadWave, toast, session.stages]);

  if (!sim) {
    return (
      <StepFrame slug="compare" intro="Compares results from your processor design with the reference model.">
        <Empty title="Run the program first">
          <p className="muted">The comparison needs a program that assembles and runs on the reference model.</p>
          <Link className="btn btn--primary" href="/workbench/program">
            Go to Program
          </Link>
        </Empty>
      </StepFrame>
    );
  }

  const downloadKit = () => {
    const files = [
      { name: "program.mem", content: toMemFile(analysis.memory, analysis.profile) },
      ...tb.files.map((f) => ({ name: f.name, content: f.content, executable: f.mode === "executable" })),
    ];
    downloadBlob(`${slug(session.name)}-hardware-run.zip`, createZip(files), "application/zip");
  };

  const loadSample = async (id: string) => {
    try {
      await loadWave(await fetchSampleWave(id), `${id}.vcd (GHDL, reference RTL)`, "sample");
    } catch {
      toast("Could not load the sample waveform.");
    }
  };

  const openMemoryTest = () => {
    const ex = EXAMPLES.find((e) => e.id === "memory")!;
    update((s) => ({ ...s, name: ex.title, source: ex.source, sourceKind: "asm", inputs: {}, interrupts: [], userChecks: [], disabledChecks: [] }));
    ctx.clearWave();
  };

  const regNames = `R0–R${analysis.profile.registerCount - 1}`;
  const METHODS: { id: Method; label: string }[] = [
    { id: "waveform", label: "Waveform from my simulation" },
    { id: "values", label: "Final register values" },
    { id: "sample", label: "Bundled sample" },
  ];

  return (
    <StepFrame
      slug="compare"
      intro="Give the workbench results from your processor design, and it checks them against the reference model. Pick whichever you have; a waveform gives the most detailed answer."
    >
      <fieldset className="option-tabs">
        <legend>
          <h2>What do you have from your design?</h2>
        </legend>
        {METHODS.map((m) => (
          <label key={m.id} className={`option-tab${method === m.id ? " option-tab--on" : ""}`}>
            <input type="radio" name="method" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} />
            {m.label}
          </label>
        ))}
      </fieldset>

      <details className="panel section">
        <summary className="small">
          <strong>Pipeline settings</strong> — {session.stages} stages, {describeForwarding(geometry(session.stages), session.forwarding)}. Used for the
          testbench length and the timing verdict.
        </summary>
        <div className="section">
          <PipelineSettings />
        </div>
      </details>

      {method === "waveform" && (
        <>
          <div className="needs-box section">
            <strong>You need to upload</strong>
            <ul>
              <li>
                <code>wave.vcd</code> (or <code>wave.vcd.gz</code>), up to {MAX_VCD_BYTES / 1024 / 1024} MB, from simulating your
                design with <em>this</em> program.
              </li>
              <li>
                It must contain the processor&apos;s clock, reset and {regNames}. With SP, the flags, the OUT port and the
                fetch PC as well, every part is checked. The kit below dumps all of them.
              </li>
            </ul>
            <p className="muted xsmall">Already have a VCD from your own testbench? Skip to step 2.</p>
          </div>
          <ol className="sublist section">
            <li>
              <section className="stack stack--tight" aria-labelledby="kit-h">
                <h2 id="kit-h">Make the waveform</h2>
                <p className="muted small prose">
                  The kit contains <code>program.mem</code> (this program), <code>tb_processor.vhd</code> (a VHDL-2008
                  testbench that feeds each IN instruction the value the model used) and scripts for GHDL and
                  ModelSim/Questa. Running a script writes <code>wave.vcd</code>.
                </p>
                <div className="btn-row">
                  <label className="field">
                    <span className="field__label">RTL folder</span>
                    <input
                      type="text"
                      className="mono"
                      value={rtl}
                      size={22}
                      onChange={(e) => setRtl(e.target.value)}
                      onBlur={() => {
                        const v = safeRelPath(rtl.trim(), "");
                        if (v) update({ rtlRoot: v });
                        else setRtl(session.rtlRoot);
                      }}
                    />
                    <span className="field__hint">Where your .vhd files are, relative to the unzipped kit</span>
                  </label>
                  <label className="field">
                    <span className="field__label">Clock cycles</span>
                    <input
                      type="number"
                      min={10}
                      max={1_000_000}
                      value={cycles}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        update({ tbCycles: Number.isFinite(v) ? Math.max(10, Math.min(1_000_000, v)) : null });
                      }}
                    />
                    <span className="field__hint">
                      ~{analysis.timing?.totalCycles ?? sim.events.length} cycles expected on {session.stages} stages
                    </span>
                  </label>
                </div>
                <div className="btn-row">
                  <button className="btn btn--primary" onClick={downloadKit}>
                    Download hardware kit (.zip)
                  </button>
                </div>
                <p className="muted xsmall">
                  {session.compileOrder ? (
                    <>
                      Compile order: {session.compileOrder.length} files from your code review.{" "}
                      <button className="linkbtn" onClick={() => update({ compileOrder: null })}>
                        Use the default list
                      </button>
                    </>
                  ) : (
                    <>
                      Compile order: the reference processor&apos;s {analysis.profile.hardware.compileOrder.length} files. For your own
                      design, run <Link href="/review">Code review</Link> first and it will fill this in.
                    </>
                  )}
                </p>
                {tb.notes.map((n) => (
                  <p key={n} className="small">
                    <Badge tone="warn">Note</Badge> {n}
                  </p>
                ))}
                <details>
                  <summary className="small">Commands</summary>
                  <pre className="code-block">{`unzip ${slug(session.name)}-hardware-run.zip -d run && cd run
chmod +x run_ghdl.sh && ./run_ghdl.sh path/to/src/rtl

# or, in ModelSim / Questa (edit RTL at the top first):
do run_modelsim.do`}</pre>
                </details>
              </section>
            </li>
            <li>
              <section className="stack stack--tight" aria-labelledby="up-h">
                <h2 id="up-h">Upload the waveform</h2>
                {!wave.vcd && wave.progress === null && (
                  <FileDrop
                    accept=".vcd,.gz"
                    label="Choose wave.vcd"
                    hint="From GHDL, ModelSim, Questa, Vivado or Icarus. Read in this tab only; nothing is uploaded to a server."
                    onFile={(f) => loadWave(f, f.name, "upload")}
                  />
                )}
                <WaveStatus ctx={ctx} />
              </section>
            </li>
            <li>
              <section className="stack" aria-labelledby="res-h">
                <h2 id="res-h">Results</h2>
                <WaveResults ctx={ctx} />
              </section>
            </li>
          </ol>
        </>
      )}

      {method === "values" && (
        <div className="split section">
          <section className="stack" aria-label="Enter final values">
            <div className="needs-box">
              <strong>You need</strong>
              <ul>
                <li>
                  The value of each register after your design reaches HLT — from your simulator&apos;s register view,
                  ModelSim&apos;s <code>examine</code>, or an FPGA board.
                </li>
                <li>Type or paste them below, or upload a .txt file. Any subset is fine.</li>
              </ul>
              <p className="muted xsmall">
                Only the end state is compared, so this tells you <em>whether</em> the result is right, not where it went
                wrong. Use a waveform for that.
              </p>
            </div>
            <label className="field">
              <span className="field__label" id="fv-h">
                Final values (hex)
              </span>
              <textarea
                className="final-values"
                spellCheck={false}
                value={session.finalValues}
                maxLength={MAX_FINAL_VALUES_CHARS}
                placeholder={"R1=19  R2=1E  R3=19\nSP=FFF  OUT=0\nZ=0  N=0  C=0"}
                onChange={(e) => update({ finalValues: e.target.value })}
              />
              <span className="field__hint">
                Write NAME=VALUE: {regNames}, SP, OUT, Z, N, C. Paths like /processor/r1 and 0x prefixes are fine.
              </span>
            </label>
            <FileDrop
              accept=".txt,.log,.lst,text/plain"
              label="Upload a .txt file"
              hint="Up to 8 KB. Read on this device."
              onFile={async (f) => {
                try {
                  const text = await readTextFile(f, MAX_FINAL_VALUES_CHARS);
                  update({ finalValues: text });
                  toast(`Read ${f.name}`);
                } catch (e) {
                  toast(e instanceof Error ? e.message : "Could not read that file.");
                }
              }}
            />
            {finalParse.errors.length > 0 && (
              <ul className="diag-list">
                {finalParse.errors.slice(0, 20).map((e, i) => (
                  <li key={i} className="diag diag--warning">
                    <span className="mono xsmall">Line {e.line}</span>
                    <span>{e.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="stack" aria-labelledby="fvr-h">
            <h2 id="fvr-h">Results</h2>
            {!finalReport ? (
              <p className="muted small">Enter at least one value to compare.</p>
            ) : (
              <>
                {finalReport.failed === 0 ? (
                  <div className="notice notice--pass" role="status">
                    <span aria-hidden="true">✓</span>
                    <div>
                      <strong>All {finalReport.passed} values match</strong>
                      The design ended in the state the reference model predicts.
                    </div>
                  </div>
                ) : (
                  <div className="notice notice--fail" role="status">
                    <span aria-hidden="true">✕</span>
                    <div>
                      <strong>
                        {finalReport.failed} of {finalReport.rows.length} values differ
                      </strong>
                      Load a waveform to find the instruction where they first go wrong.
                    </div>
                  </div>
                )}
                <div className="panel panel--flush">
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th scope="col">Register</th>
                          <th scope="col">Model</th>
                          <th scope="col">Your design</th>
                          <th scope="col">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {finalReport.rows.map((r) => (
                          <tr key={r.key} className={r.status === "mismatch" ? "is-fail" : undefined}>
                            <td className="mono">{r.key}</td>
                            <td className="mono">{r.expected}</td>
                            <td className="mono">{r.actual}</td>
                            <td>
                              <Badge tone={r.status === "match" ? "pass" : "fail"}>{r.status === "match" ? "Match" : "Differs"}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {method === "sample" && (
        <div className="stack section">
          <div className="needs-box">
            <strong>You need nothing</strong>
            <ul>
              <li>
                Each bundled test program comes with a waveform of the reference RTL running it in GHDL 4.1, made with the
                same kit you can download.
              </li>
            </ul>
          </div>
          {example ? (
            <>
              <div className="btn-row">
                <button className="btn btn--primary" onClick={() => loadSample(example.id)} disabled={wave.progress !== null}>
                  Load the waveform for {example.file}
                </button>
              </div>
              <WaveStatus ctx={ctx} />
              <section className="stack" aria-labelledby="res-s-h">
                <h2 id="res-s-h">Results</h2>
                <WaveResults ctx={ctx} />
              </section>
            </>
          ) : (
            <div className="empty">
              <p>The open program isn&apos;t one of the bundled tests, so there is no sample waveform for it.</p>
              <button className="btn btn--primary" onClick={openMemoryTest}>
                Open the Memory test program
              </button>
            </div>
          )}
        </div>
      )}
    </StepFrame>
  );
}

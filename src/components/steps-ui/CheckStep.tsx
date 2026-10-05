"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Check } from "@/lib/check/expectations";
import { useWorkbench } from "../SessionProvider";
import { StepFrame } from "../StepFrame";
import { Badge, Empty } from "../ui";

type Filter = "all" | "fail" | "not-run";

const TARGETS = [
  ...Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, label: `R${i}` })),
  { id: "sp", label: "SP" },
  { id: "out", label: "OUT port" },
  { id: "mem", label: "Memory word" },
  { id: "Z", label: "Flag Z" },
  { id: "N", label: "Flag N" },
  { id: "C", label: "Flag C" },
];

function NewCheckForm({ onAdd }: { onAdd: (c: Check) => void }) {
  const [target, setTarget] = useState("r1");
  const [addr, setAddr] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hex = (s: string) => (/^(0x)?[0-9a-f]{1,8}$/i.test(s.trim()) ? parseInt(s.trim().replace(/^0x/i, ""), 16) >>> 0 : null);
  return (
    <form
      className="stack stack--tight"
      onSubmit={(e) => {
        e.preventDefault();
        const isFlag = ["Z", "N", "C"].includes(target);
        const v = isFlag ? (value.trim() === "1" ? 1 : value.trim() === "0" ? 0 : null) : hex(value);
        if (v === null) return setError(isFlag ? "Enter 0 or 1." : "Enter a hex value, e.g. 1F.");
        const a = target === "mem" ? hex(addr) : 0;
        if (a === null) return setError("Enter the memory address in hex.");
        setError(null);
        const base = { id: `U${Date.now().toString(36)}`, line: 0, when: "end" as const, origin: "user" as const, enabled: true, value: v };
        if (isFlag) onAdd({ ...base, kind: "flag", flag: target as "Z" | "N" | "C" });
        else if (target === "sp") onAdd({ ...base, kind: "sp" });
        else if (target === "out") onAdd({ ...base, kind: "out" });
        else if (target === "mem") onAdd({ ...base, kind: "mem", addr: a });
        else onAdd({ ...base, kind: "reg", reg: Number(target.slice(1)) });
        setValue("");
      }}
    >
      <div className="btn-row">
        <label className="field">
          <span className="field__label">At the end, this</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {TARGETS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {target === "mem" && (
          <label className="field">
            <span className="field__label">Address (hex)</span>
            <input type="text" className="mono" size={8} value={addr} onChange={(e) => setAddr(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span className="field__label">should equal</span>
          <input
            type="text"
            className="mono"
            size={10}
            value={value}
            placeholder={["Z", "N", "C"].includes(target) ? "0 or 1" : "hex"}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? "newcheck-err" : undefined}
          />
        </label>
      </div>
      {error && (
        <p id="newcheck-err" className="small" role="alert">
          <Badge tone="fail">Check</Badge> {error}
        </p>
      )}
      <div>
        <button className="btn" type="submit">
          Add check
        </button>
      </div>
    </form>
  );
}

export function CheckStep() {
  const { session, update, analysis } = useWorkbench();
  const [filter, setFilter] = useState<Filter>("all");
  const results = analysis.checkResults;
  const counts = useMemo(
    () => ({
      pass: results.filter((r) => r.status === "pass").length,
      fail: results.filter((r) => r.status === "fail").length,
      notRun: results.filter((r) => r.status === "not-run").length,
    }),
    [results],
  );
  const shown = results.filter((r) => (filter === "all" ? true : filter === "fail" ? r.status === "fail" : r.status === "not-run"));
  const lineCode = (line: number) => analysis.asm?.lines.find((l) => l.line === line)?.code ?? "";

  if (!analysis.sim) {
    return (
      <StepFrame slug="check" intro="Checks compare the reference model against what your program's comments say should happen.">
        <Empty title="Nothing to check yet">
          <p className="muted">The program needs to assemble and run first.</p>
          <Link className="btn btn--primary" href="/workbench/program">
            Go to Program
          </Link>
        </Empty>
      </StepFrame>
    );
  }

  const toggle = (id: string, on: boolean) =>
    update((s) => {
      if (id.startsWith("U")) {
        return { ...s, userChecks: s.userChecks.map((c) => (c.id === id ? { ...c, enabled: on } : c)) };
      }
      const set = new Set(s.disabledChecks);
      if (on) set.delete(id);
      else set.add(id);
      return { ...s, disabledChecks: [...set] };
    });

  return (
    <StepFrame
      slug="check"
      nextSlug={session.goal === "program" ? "report" : undefined}
      extraNext={
        session.goal === "program" ? (
          <Link className="btn btn--ghost" href="/workbench/compare">
            Compare with hardware (optional)
          </Link>
        ) : undefined
      }
      intro="Comments such as #R1=5, SP=FFE, C --> 1 or “shouldn't be executed” are read as expectations and tested against the reference model. A failure here means the comment and the ISA disagree — the hardware isn't involved yet."
    >
      <div className="split">
        <section className="stack" aria-labelledby="res-h">
          <div className="section__head">
            <h2 id="res-h">Results</h2>
            <div className="btn-row">
              <Badge tone="pass">{counts.pass} passed</Badge>
              <Badge tone={counts.fail ? "fail" : undefined}>{counts.fail} failed</Badge>
              {counts.notRun > 0 && <Badge>{counts.notRun} not run</Badge>}
            </div>
          </div>
          {results.length === 0 ? (
            <Empty title="No checks found">
              <p className="muted">
                Add expectations as comments, for example <code>INC R1 #R1=6, Z --&gt; 0</code>, or add a check on the final
                state.
              </p>
            </Empty>
          ) : (
            <>
              <div className="tabs" role="tablist" aria-label="Filter checks">
                {(
                  [
                    ["all", `All (${results.length})`],
                    ["fail", `Failed (${counts.fail})`],
                    ["not-run", `Not run (${counts.notRun})`],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="panel panel--flush">
                <div className="table-wrap table-wrap--tall">
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">On</th>
                        <th scope="col">Line</th>
                        <th scope="col">Instruction</th>
                        <th scope="col">Expected</th>
                        <th scope="col">Model</th>
                        <th scope="col">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.check.id} className={r.status === "fail" ? "is-fail" : r.status === "not-run" ? "is-dim" : undefined}>
                          <td>
                            <input
                              type="checkbox"
                              checked={r.check.enabled}
                              aria-label={`Run check “${r.expected}”`}
                              onChange={(e) => toggle(r.check.id, e.target.checked)}
                            />
                          </td>
                          <td className="mono num">{r.check.line || "end"}</td>
                          <td className="mono">{r.check.line ? lineCode(r.check.line) : "final state"}</td>
                          <td className="mono">{r.expected}</td>
                          <td className="mono">{r.actual}</td>
                          <td>
                            {r.status === "pass" ? (
                              <Badge tone="pass">Pass</Badge>
                            ) : r.status === "fail" ? (
                              <Badge tone="fail">Fail</Badge>
                            ) : (
                              <Badge>Not run</Badge>
                            )}
                            {r.message && <div className="xsmall muted">{r.message}</div>}
                            {r.check.origin === "user" && (
                              <button
                                className="btn btn--ghost btn--small"
                                onClick={() => update((s) => ({ ...s, userChecks: s.userChecks.filter((c) => c.id !== r.check.id) }))}
                              >
                                Remove
                              </button>
                            )}
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

        <aside className="stack" aria-label="Add checks">
          <section className="panel stack stack--tight">
            <h2>Add a check</h2>
            <p className="muted small">For results the comments don&apos;t cover, check the final state.</p>
            <NewCheckForm onAdd={(c) => update((s) => ({ ...s, userChecks: [...s.userChecks, c].slice(0, 500) }))} />
          </section>
          <section className="panel stack stack--tight">
            <h2>What comments are understood</h2>
            <ul className="small prose">
              <li>
                <code>R3=19</code>, <code>SP=FFE</code>, <code>M[FFF]=300</code>
              </li>
              <li>
                <code>C --&gt; 1</code>, <code>Z = 0</code>, <code>N --&gt; no change</code>, <code>flags no change</code>
              </li>
              <li>
                <code>this statement shouldn&apos;t be executed</code>
              </li>
              <li>
                On jumps: <code>taken</code>, <code>not taken</code>
              </li>
              <li>
                In <code>A OR B</code>, only <code>A</code> is checked
              </li>
            </ul>
            <p className="muted xsmall">
              Checks run after the first execution of their line. {session.sourceKind === "mem" && "A .mem file has no comments."}
            </p>
          </section>
        </aside>
      </div>
    </StepFrame>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toMemFile } from "@/lib/asm/assembler";
import { downloadBlob, slug } from "@/lib/util/download";
import { useWorkbench } from "../SessionProvider";
import { StepFrame } from "../StepFrame";
import { Badge, DiagnosticList, Empty, h8, hx } from "../ui";
import Link from "next/link";

export function AssembleStep() {
  const { session, analysis } = useWorkbench();
  const router = useRouter();
  const [binary, setBinary] = useState(false);
  const { asm, memory, diagnostics, profile } = analysis;
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;

  const rows = useMemo(() => {
    if (analysis.disassembly) {
      return analysis.disassembly.map((r) => ({ addr: r.address, word: r.word, line: null as number | null, text: r.text, kind: r.kind }));
    }
    if (!asm) return [];
    return [...asm.sourceMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([addr, info]) => ({ addr, word: memory.get(addr) ?? 0, line: info.line, text: info.text, kind: info.kind }));
  }, [analysis.disassembly, asm, memory]);

  const lineText = (line: number) => asm?.lines.find((l) => l.line === line)?.code;
  const vectors = [
    { label: "Reset", addr: profile.resetVector },
    { label: "External interrupt", addr: profile.extIntVector },
    ...Array.from({ length: profile.maxIntIndex + 1 }, (_, i) => ({ label: `INT ${i}`, addr: profile.intVectorBase + i })),
  ];

  if (!session.source.trim()) {
    return (
      <StepFrame slug="assemble" intro="Turns your program into the 32-bit memory image the processor loads.">
        <Empty title="There is no program yet">
          <p className="muted">Load a test program or write your own first.</p>
          <Link className="btn btn--primary" href="/workbench/program">
            Go to Program
          </Link>
        </Empty>
      </StepFrame>
    );
  }

  return (
    <StepFrame
      slug="assemble"
      intro="The assembler matches the project's assembler.py bit for bit, and also reports problems the original tool lets through silently."
      nextDisabled={errors > 0}
      nextHint="Fix the errors first"
    >
      <div className="stack">
        <div className="section__head">
          <div className="btn-row">
            {errors ? <Badge tone="fail">{errors} error{errors > 1 ? "s" : ""}</Badge> : <Badge tone="pass">Assembled</Badge>}
            {warnings > 0 && <Badge tone="warn">{warnings} warning{warnings > 1 ? "s" : ""}</Badge>}
            <span className="muted small">
              {memory.size} words · highest address {hx(memory.size ? Math.max(...memory.keys()) : 0)} of{" "}
              {hx(profile.memoryWords - 1)}
            </span>
          </div>
          <button
            className="btn btn--primary"
            disabled={errors > 0 || !memory.size}
            onClick={() => downloadBlob(`${slug(session.name)}.mem`, toMemFile(memory, profile), "text/plain")}
          >
            Download .mem
          </button>
        </div>

        {diagnostics.length > 0 && (
          <section className="section" aria-labelledby="diag-h">
            <div className="section__head">
              <h2 id="diag-h">Problems</h2>
              {session.sourceKind === "asm" && <p>Select a line number to edit it.</p>}
            </div>
            <DiagnosticList
              items={diagnostics}
              lineText={lineText}
              onLine={session.sourceKind === "asm" ? (l) => router.push(`/workbench/program?line=${l}`) : undefined}
            />
          </section>
        )}

        <section className="section" aria-labelledby="vec-h">
          <div className="section__head">
            <h2 id="vec-h">Vectors</h2>
            <p>Where the processor looks up its start and interrupt-handler addresses.</p>
          </div>
          <dl className="kv">
            {vectors.flatMap((v) => [
              <dt key={v.label + "t"}>
                {v.label} · M[{v.addr}]
              </dt>,
              <dd key={v.label + "d"}>{memory.has(v.addr) ? hx(memory.get(v.addr)!) : "not set"}</dd>,
            ])}
          </dl>
        </section>

        <section className="section" aria-labelledby="list-h">
          <div className="section__head">
            <h2 id="list-h">Listing</h2>
            <label className="check-row">
              <input type="checkbox" checked={binary} onChange={(e) => setBinary(e.target.checked)} />
              Show binary
            </label>
          </div>
          <div className="panel panel--flush">
            <div className="table-wrap table-wrap--tall">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Address</th>
                    <th scope="col">Word</th>
                    {session.sourceKind === "asm" && <th scope="col">Line</th>}
                    <th scope="col">{session.sourceKind === "asm" ? "Source" : "Disassembly"}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.addr} className={r.kind === "immediate" ? "is-dim" : undefined}>
                      <td className="mono">{h8(r.addr).slice(5)}</td>
                      <td className="mono">{binary ? (r.word >>> 0).toString(2).padStart(32, "0") : h8(r.word)}</td>
                      {session.sourceKind === "asm" && <td className="mono num">{r.line}</td>}
                      <td className="mono">{r.kind === "immediate" ? "  ↳ immediate" : r.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </StepFrame>
  );
}

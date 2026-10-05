"use client";

import { useEffect, useRef } from "react";
import { MAX_SOURCE_BYTES } from "@/lib/asm/assembler";
import { MAX_MEM_BYTES } from "@/lib/asm/memfile";
import { EXAMPLES } from "@/lib/examples/programs";
import { withProgram } from "@/lib/session/session";
import { readTextFile } from "@/lib/util/download";
import { CodeEditor, type CodeEditorHandle } from "../CodeEditor";
import { FileDrop } from "../FileDrop";
import { useWorkbench } from "../SessionProvider";
import { StepFrame } from "../StepFrame";
import { GOALS, REVIEW_OPTION } from "../goals";
import { PipelineSettings } from "../DepthPicker";
import Link from "next/link";
import type { Goal } from "@/lib/session/session";

const BLANK = `# Comments start with #, ; or //. Numbers are hex.
.ORG 0
10          # reset vector: execution starts at 0x10

.ORG 10
LDM R1, 5   #R1=5
INC R1      #R1=6, C --> 0, N --> 0, Z --> 0
OUT R1
HLT
`;

export function ProgramStep() {
  const { session, update, analysis, toast } = useWorkbench();
  const editor = useRef<CodeEditorHandle>(null);
  const fresh = (name: string, source: string, sourceKind: "asm" | "mem") =>
    // Settings about the design under test survive a program change.
    update((s) => withProgram(s, { name, source, sourceKind }));

  const onFile = async (f: File) => {
    try {
      const isMem = /\.mem$/i.test(f.name);
      const text = await readTextFile(f, isMem ? MAX_MEM_BYTES : MAX_SOURCE_BYTES);
      if (text.includes("\u0000")) throw new Error(`${f.name} looks like a binary file, not text.`);
      fresh(f.name.replace(/\.(asm|s|txt|mem)$/i, ""), text, isMem ? "mem" : "asm");
      toast(`Opened ${f.name}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not open that file.");
    }
  };

  // Arriving from a diagnostic in Assemble: jump to that line.
  useEffect(() => {
    const line = Number(new URLSearchParams(window.location.search).get("line"));
    if (Number.isInteger(line) && line > 0) {
      const t = setTimeout(() => editor.current?.goToLine(line), 50);
      return () => clearTimeout(t);
    }
  }, []);

  const errors = analysis.diagnostics.filter((d) => d.severity === "error").length;
  const activeExample = EXAMPLES.find((e) => e.source === session.source)?.id;

  const chooseGoal = (goal: Goal) => {
    update({ goal });
    // The quickest path loads a bundled test that has a matching waveform.
    if (goal === "sample" && !activeExample) {
      const ex = EXAMPLES.find((e) => e.id === "memory")!;
      update((s) => withProgram(s, { name: ex.title, source: ex.source, goal }));
      toast(`Loaded ${ex.file}. Its waveform is waiting in step 5.`);
    }
  };

  return (
    <StepFrame
      slug="program"
      intro="Choose how you want to test, then pick a bundled test program, open your own file, or write one."
      nextDisabled={!session.source.trim()}
      nextHint="Add a program first"
    >
      <fieldset className="goals">
        <legend>
          <h2>How do you want to test?</h2>
        </legend>
        {GOALS.map((g) => (
          <label key={g.id} className={`goal${session.goal === g.id ? " goal--on" : ""}`}>
            <input type="radio" name="goal" value={g.id} checked={session.goal === g.id} onChange={() => chooseGoal(g.id)} />
            <span className="goal__body">
              <span className="goal__title">{g.title}</span>
              <span className="goal__blurb">{g.blurb}</span>
              <span className="goal__needs">
                <span className="goal__needs-label">You need</span>
                <ul>
                  {g.needs.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </span>
            </span>
          </label>
        ))}
        <Link href={REVIEW_OPTION.href} className="goal goal--link">
          <span className="goal__arrow" aria-hidden="true">
            ↗
          </span>
          <span className="goal__body">
            <span className="goal__title">{REVIEW_OPTION.title}</span>
            <span className="goal__blurb">{REVIEW_OPTION.blurb}</span>
            <span className="goal__needs">
              <span className="goal__needs-label">You need</span>
              <ul>
                {REVIEW_OPTION.needs.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </span>
          </span>
        </Link>
      </fieldset>
      <div className="section depth-row">
        <PipelineSettings />
        <p className="muted xsmall">
          The instruction set is the same for both. The depth changes the timing estimate, the testbench length, signal names
          in the waveform and the code review&apos;s pipeline checks.
        </p>
      </div>

      <div className="split split--wide-side">
        <section className="stack" aria-labelledby="src-h">
          <div className="section__head">
            <h2 id="src-h">{session.sourceKind === "mem" ? "Memory image (.mem)" : "Assembly source"}</h2>
            <span className="muted small">
              {errors ? `${errors} error${errors > 1 ? "s" : ""} — see Assemble` : session.source.trim() ? "Assembles cleanly" : ""}
            </span>
          </div>
          <label className="field">
            <span className="field__label">Program name</span>
            <input
              type="text"
              value={session.name}
              maxLength={120}
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>
          {session.source.trim() || session.sourceKind === "asm" ? (
            <CodeEditor
              ref={editor}
              label={session.sourceKind === "mem" ? "Memory image" : "Assembly source"}
              value={session.source}
              onChange={(v) => update({ source: v })}
              diagnostics={analysis.diagnostics}
            />
          ) : null}
          {session.sourceKind === "mem" && (
            <p className="muted small">
              A .mem file is one 32-bit binary word per line, as the VHDL memory loads it. It is disassembled in the next
              step; checks from comments need assembly source.
            </p>
          )}
        </section>

        <aside className="stack" aria-label="Load a program">
          <section>
            <div className="section__head">
              <h2>Test programs</h2>
            </div>
            <ul className="examples">
              {EXAMPLES.map((ex) => (
                <li key={ex.id}>
                  <button
                    type="button"
                    aria-pressed={activeExample === ex.id}
                    onClick={() => {
                      fresh(ex.title, ex.source, "asm");
                      toast(`Loaded ${ex.file}`);
                    }}
                  >
                    <span className="ex-title">{ex.title}</span>
                    <span className="ex-file">{ex.file}</span>
                    <span className="ex-summary">{ex.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="stack stack--tight">
            <h2>Your own file</h2>
            <FileDrop
              accept=".asm,.s,.txt,.mem,text/plain"
              label="Open a file"
              hint="Or drop it here. It is read on this device and never uploaded."
              onFile={onFile}
            />
            <dl className="formats">
              <dt>
                <code>.asm</code> <span className="muted">recommended</span>
              </dt>
              <dd>
                Assembly source for this ISA. Comments such as <code>#R1=5</code> become checks, and values on{" "}
                <code>IN</code> lines feed the IN port. Up to 512 KB.
              </dd>
              <dt>
                <code>.mem</code>
              </dt>
              <dd>
                An assembled image: one 32-bit binary word per line, starting at address 0 — the file your VHDL memory
                loads. No comments, so no automatic checks. Up to 4096 words.
              </dd>
            </dl>
            <button type="button" className="btn btn--ghost" onClick={() => fresh("Untitled program", BLANK, "asm")}>
              Start from a blank template
            </button>
          </section>
        </aside>
      </div>
    </StepFrame>
  );
}

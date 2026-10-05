"use client";

import { useMemo, useState } from "react";
import { buildReport, reportToMarkdown } from "@/lib/report/report";
import { encodeShare, MAX_SHARE_CHARS } from "@/lib/session/session";
import { downloadBlob, slug } from "@/lib/util/download";
import { useWorkbench } from "../SessionProvider";
import { StepFrame } from "../StepFrame";
import { Badge } from "../ui";

export function ReportStep() {
  const { session, analysis, report, finalReport, toast } = useWorkbench();
  const data = useMemo(
    () => buildReport(session, analysis, report, new Date(), finalReport),
    [session, analysis, report, finalReport],
  );
  const [link, setLink] = useState<string | null>(null);
  const md = useMemo(() => reportToMarkdown(data), [data]);
  const name = slug(session.name);

  const share = async () => {
    try {
      const token = await encodeShare(session);
      if (token.length > MAX_SHARE_CHARS) {
        toast("This program is too large for a link. Share the .asm file instead.");
        return;
      }
      const url = `${window.location.origin}/workbench/program#s=${token}`;
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        toast("Share link copied");
      } catch {
        toast("Share link ready — copy it below");
      }
    } catch {
      toast("Could not create a share link in this browser.");
    }
  };

  const rows: [string, React.ReactNode][] = [
    [
      "Assembly",
      data.assembly.errors ? (
        <Badge tone="fail">{data.assembly.errors} errors</Badge>
      ) : (
        <span>
          <Badge tone="pass">OK</Badge> {data.assembly.words} words, {data.assembly.warnings} warnings
        </span>
      ),
    ],
    [
      "Reference model",
      data.simulation ? (
        <span>
          <Badge tone={data.simulation.halt === "hlt" ? "pass" : "warn"}>{data.simulation.halt === "hlt" ? "Halted" : "Did not halt"}</Badge>{" "}
          {data.simulation.steps} steps
        </span>
      ) : (
        <Badge>Not run</Badge>
      ),
    ],
    [
      "Checks",
      data.checks.total ? (
        <span>
          <Badge tone={data.checks.failed ? "fail" : "pass"}>
            {data.checks.passed}/{data.checks.total} passed
          </Badge>{" "}
          {data.checks.notRun ? `${data.checks.notRun} not run` : ""}
        </span>
      ) : (
        <Badge>None</Badge>
      ),
    ],
    [
      "Hardware",
      data.hardware ? (
        <span>
          <Badge tone={data.hardware.failed ? "fail" : "pass"}>
            {data.hardware.failed ? `${data.hardware.failed} channels differ` : "All channels match"}
          </Badge>
        </span>
      ) : (
        <Badge>No waveform</Badge>
      ),
    ],
    [
      "Final values",
      data.finalValues ? (
        <Badge tone={data.finalValues.failed ? "fail" : "pass"}>
          {data.finalValues.passed}/{data.finalValues.rows.length} match
        </Badge>
      ) : (
        <Badge>None entered</Badge>
      ),
    ],
  ];

  return (
    <StepFrame
      slug="report"
      intro="Download the results for a lab write-up, a pull request or CI, or share the whole setup as a link. Links carry the program in the URL fragment, which browsers never send to a server."
    >
      <div className="split">
        <section className="stack" aria-labelledby="sum-h">
          <h2 id="sum-h">Summary</h2>
          <dl className="kv">
            {rows.flatMap(([k, v]) => [<dt key={k + "k"}>{k}</dt>, <dd key={k + "v"}>{v}</dd>])}
          </dl>
          {data.hardware?.firstDivergence && (
            <div className="notice notice--fail">
              <span aria-hidden="true">✕</span>
              <div>
                <strong>First hardware divergence</strong>
                {data.hardware.firstDivergence}
              </div>
            </div>
          )}
          <section className="stack stack--tight" aria-labelledby="pv-h">
            <h2 id="pv-h">Markdown preview</h2>
            <pre className="code-block table-wrap--tall">{md}</pre>
          </section>
        </section>
        <aside className="stack" aria-label="Export">
          <section className="panel stack stack--tight">
            <h2>Download</h2>
            <button className="btn btn--primary" onClick={() => downloadBlob(`${name}-report.md`, md, "text/markdown")}>
              Download report (.md)
            </button>
            <button
              className="btn"
              onClick={() => downloadBlob(`${name}-report.json`, JSON.stringify(data, null, 2), "application/json")}
            >
              Download data (.json)
            </button>
            <button className="btn btn--ghost" onClick={() => window.print()}>
              Print or save as PDF
            </button>
          </section>
          <section className="panel stack stack--tight">
            <h2>Share</h2>
            <p className="muted small">
              The link holds the program, IN values, interrupts, options and your checks. Waveforms are not included.
            </p>
            <button className="btn" onClick={share}>
              Copy share link
            </button>
            {link && (
              <label className="field">
                <span className="field__label">Link</span>
                <input type="text" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="mono" />
                <span className="field__hint">{link.length.toLocaleString()} characters</span>
              </label>
            )}
          </section>
        </aside>
      </div>
    </StepFrame>
  );
}

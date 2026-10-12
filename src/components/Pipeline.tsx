"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkbench } from "./SessionProvider";
import { STEPS, type StepSlug } from "./steps";
import { goalInfo } from "./goals";
import { describeForwarding, geometry } from "@/lib/pipeline/pipeline";
import { HDL_INFO } from "@/lib/hdl";

type Tone = "idle" | "ok" | "warn" | "fail";

/** The workflow drawn as a six-stage pipeline: each step is a stage register. */
export function Pipeline() {
  const path = usePathname() ?? "";
  const { session, analysis, report, finalReport, ready } = useWorkbench();
  const current = STEPS.find((s) => path.endsWith("/" + s.slug))?.slug;

  const status = (slug: StepSlug): [Tone, string] => {
    if (!ready) return ["idle", "…"];
    const src = session.source.trim();
    const errors = analysis.diagnostics.filter((d) => d.severity === "error").length;
    const warnings = analysis.diagnostics.filter((d) => d.severity === "warning").length;
    switch (slug) {
      case "program":
        return src ? ["ok", `${session.source.split("\n").length} lines`] : ["idle", "Empty"];
      case "assemble":
        if (!src) return ["idle", "Waiting"];
        if (errors) return ["fail", `${errors} error${errors > 1 ? "s" : ""}`];
        if (warnings) return ["warn", `${warnings} warning${warnings > 1 ? "s" : ""}`];
        return ["ok", `${analysis.memory.size} words`];
      case "simulate": {
        const sim = analysis.sim;
        if (!sim) return ["idle", "Waiting"];
        if (sim.haltReason === "hlt") return ["ok", `${sim.events.length} steps`];
        return ["warn", sim.haltReason === "max-steps" ? "No HLT" : "PC left memory"];
      }
      case "check": {
        const r = analysis.checkResults;
        if (!analysis.sim) return ["idle", "Waiting"];
        if (!r.length) return ["idle", "No checks"];
        const fail = r.filter((x) => x.status === "fail").length;
        const pass = r.filter((x) => x.status === "pass").length;
        return fail ? ["fail", `${fail} failed`] : ["ok", `${pass}/${r.length} pass`];
      }
      case "compare":
        if (report) return report.failed ? ["fail", `${report.failed} differ`] : ["ok", "All match"];
        if (finalReport) return finalReport.failed ? ["fail", `${finalReport.failed} value${finalReport.failed > 1 ? "s" : ""} differ${finalReport.failed > 1 ? "" : "s"}`] : ["ok", "Values match"];
        return ["idle", session.goal === "program" ? "Optional" : "No results yet"];
      case "report":
        return ["idle", "Export"];
    }
  };

  return (
    <nav className="pipeline" aria-label="Workbench steps">
      <div className="pipeline__inner">
        <div className="pipeline__meta">
          <span className="pipeline__program">{ready ? session.name : " "}</span>
          <span>
            {analysis.profile.name}, {session.stages}-stage pipeline,{" "}
            {describeForwarding(geometry(session.stages), session.forwarding).split(" (")[0]}, {HDL_INFO[session.hdl].label}
          </span>
          <span>{goalInfo(session.goal).title}</span>
        </div>
        <ol>
          {STEPS.map((s, i) => {
            const [tone, text] = status(s.slug);
            return (
              <li key={s.slug} className="stage" aria-current={current === s.slug ? "step" : undefined}>
                <Link href={`/workbench/${s.slug}`}>
                  <span className="stage__name">
                    <span className="stage__num">{i + 1}</span>
                    <span className="stage__label">{s.label}</span>
                  </span>
                  <span className="stage__status">
                    <span className={`led led--${tone}`} aria-hidden="true" />
                    <span>{text}</span>
                  </span>
                  <span className="visually-hidden">
                    , status: {text}
                    {current === s.slug ? ", current step" : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

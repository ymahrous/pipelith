"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { geometry } from "@/lib/pipeline/pipeline";
import { readFileList, readZip, REVIEW_LIMITS, stripCommonRoot, type IntakeResult, type SourceFile } from "@/lib/review/intake";
import { reviewToMarkdown } from "@/lib/review/report";
import { reviewCodebase, type Category, type Finding, type HierarchyNode, type Severity } from "@/lib/review/review";
import { withProgram } from "@/lib/session/session";
import { downloadBlob, slug } from "@/lib/util/download";
import { PipelineSettings } from "../DepthPicker";
import { FileDrop } from "../FileDrop";
import { useWorkbench } from "../SessionProvider";
import { Badge } from "../ui";
import { ZipGuide } from "./ZipGuide";

interface Loaded {
  name: string;
  /** Folder removed from every path (shared by all files). */
  root: string;
  files: SourceFile[];
  programs: SourceFile[];
  skipped: IntakeResult["skipped"];
}

const SEV_LABEL: Record<Severity, string> = { error: "Error", warning: "Warning", info: "Note" };
const SEV_TONE: Record<Severity, "fail" | "warn" | undefined> = { error: "fail", warning: "warn", info: undefined };

function FindingCard({ f }: { f: Finding }) {
  return (
    <li className={`finding finding--${f.severity}`}>
      <div className="finding__head">
        <Badge tone={SEV_TONE[f.severity]}>{SEV_LABEL[f.severity]}</Badge>
        <h3 className="finding__title">{f.title}</h3>
        <span className="mono xsmall finding__where">
          {f.file}:{f.line}
        </span>
      </div>
      <p className="small">{f.message}</p>
      <div className="finding__fix small">
        <strong>Suggested fix</strong> {f.fix}
      </div>
      <a className="xsmall finding__rule" href={`/docs/review-rules#${f.rule}`}>
        About this rule <span className="mono">{f.rule}</span>
      </a>
      {f.fixCode && <pre className="code-block">{f.fixCode}</pre>}
      {f.excerpt && (
        <details className="finding__src">
          <summary className="xsmall">Show the code</summary>
          <pre className="code-block excerpt">
            {f.excerpt.lines.map((l, i) => {
              const n = f.excerpt!.start + i;
              return (
                <span key={n} className={n === f.excerpt!.focus ? "excerpt__focus" : undefined}>
                  <span className="excerpt__ln">{String(n).padStart(4, " ")}</span> {l}
                  {"\n"}
                </span>
              );
            })}
          </pre>
        </details>
      )}
    </li>
  );
}

function Tree({ node }: { node: HierarchyNode }) {
  return (
    <li>
      <span className="mono small">
        {node.label !== node.entity ? `${node.label} : ` : ""}
        <strong>{node.entity}</strong>
      </span>
      {!node.file && <span className="xsmall muted"> (not found)</span>}
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c, i) => (
            <Tree key={i} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

function StructureCheck({ loaded, report }: { loaded: Loaded; report: NonNullable<ReturnType<typeof reviewCodebase>> }) {
  const folders = new Set(loaded.files.map((f) => f.path.split("/").slice(0, -1).join("/") || "."));
  const missingPkgs = report.findings.filter((f) => f.rule === "missing-package").length;
  const unknownUnits = report.findings.filter((f) => f.rule === "unknown-unit").length;
  const dupes = report.findings.filter((f) => f.rule === "duplicate-entity").length;
  const verilog = loaded.skipped.filter((s) => /Verilog/.test(s.reason)).length;
  const problems = [
    missingPkgs && `${missingPkgs} package${missingPkgs > 1 ? "s are" : " is"} missing`,
    unknownUnits && `${unknownUnits} instance${unknownUnits > 1 ? "s use" : " uses"} a unit that isn't in the upload`,
    dupes && `${dupes} entit${dupes > 1 ? "ies are" : "y is"} defined twice`,
    !report.top && "no top-level entity was found",
  ].filter(Boolean) as string[];
  return (
    <div className={`notice ${problems.length ? "notice--probe" : ""}`} role="status">
      <span aria-hidden="true">{problems.length ? "!" : "✓"}</span>
      <div className="stack stack--tight">
        <strong>{problems.length ? "Check the upload's structure" : "The upload looks complete"}</strong>
        <span className="small">
          {loaded.files.length} VHDL files in {folders.size} folder{folders.size > 1 ? "s" : ""}
          {loaded.root ? (
            <>
              {" "}
              under <code>{loaded.root}/</code> (removed from paths)
            </>
          ) : null}
          ; top level <code>{report.top ?? "not found"}</code>; {report.testbenches.length} testbench
          {report.testbenches.length === 1 ? "" : "es"}; {loaded.programs.length} .asm program{loaded.programs.length === 1 ? "" : "s"}
          {verilog ? `; ${verilog} Verilog file${verilog > 1 ? "s" : ""} skipped` : ""}.
        </span>
        {problems.length > 0 && (
          <span className="small">
            {problems.join("; ")}. Add the missing files to the .zip — see “How to structure your .zip” above — and upload again.
          </span>
        )}
      </div>
    </div>
  );
}

export function ReviewPage() {
  const { session, update, toast, takeHandoff } = useWorkbench();
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sev, setSev] = useState<Severity | "all">("all");
  const [cat, setCat] = useState<Category | "all">("all");
  const [file, setFile] = useState("all");
  const [tab, setTab] = useState<"findings" | "overview">("findings");
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
    folderInput.current?.setAttribute("directory", "");
  }, []);

  const report = useMemo(
    () => (loaded && loaded.files.length ? reviewCodebase(loaded.files, session.stages, session.forwarding) : null),
    [loaded, session.stages, session.forwarding],
  );

  const take = async (name: string, read: () => Promise<IntakeResult>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await read();
      if (!r.files.length) {
        setError(
          r.skipped.length
            ? `No VHDL files found. Skipped: ${r.skipped.slice(0, 3).map((s) => `${s.path} (${s.reason})`).join("; ")}.`
            : "No .vhd or .vhdl files found. Upload the folder (or a .zip of it) that contains your VHDL sources.",
        );
        setLoaded(null);
      } else {
        const stripped = stripCommonRoot(r.files);
        const root = r.files.length > 1 ? r.files[0].path.slice(0, r.files[0].path.length - stripped[0].path.length).replace(/\/$/, "") : "";
        setLoaded({ name, root, files: stripped, programs: stripCommonRoot(r.programs), skipped: r.skipped });
        setTab("findings");
        setSev("all");
        setCat("all");
        setFile("all");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the upload.");
    } finally {
      setBusy(false);
    }
  };

  const fromFiles = (list: FileList | File[], name: string) => take(name, () => readFileList(Array.from(list)));

  // Files dropped on the home page's quick start arrive here, once.
  const handedOver = useRef(false);
  useEffect(() => {
    if (handedOver.current) return;
    handedOver.current = true;
    const files = takeHandoff();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time intake of files handed over from the home page
    if (files?.length) void fromFiles(files, files.length === 1 ? files[0].name : `${files.length} files`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on arrival
  }, []);
  const sample = () =>
    take("Reference processor (risc-pipelined-processor)", async () => {
      const res = await fetch("/samples/reference-rtl.zip");
      if (!res.ok) throw new Error("Could not load the sample.");
      return readZip(await res.blob());
    });

  const shown = useMemo(
    () =>
      (report?.findings ?? []).filter(
        (f) => (sev === "all" || f.severity === sev) && (cat === "all" || f.category === cat) && (file === "all" || f.file === file),
      ),
    [report, sev, cat, file],
  );
  const filesWithFindings = useMemo(() => [...new Set((report?.findings ?? []).map((f) => f.file))].sort(), [report]);
  const categories = useMemo(() => [...new Set((report?.findings ?? []).map((f) => f.category))], [report]);
  const geo = geometry(session.stages);

  const openProgram = (p: SourceFile) => {
    const name = p.path.split("/").pop()!.replace(/\.(asm|s)$/i, "");
    update((s) => withProgram(s, { name, source: p.text, goal: "hardware" }));
    router.push("/workbench/program");
  };

  return (
    <div className="step">
      <header className="step-head">
        <h1>Review your processor code</h1>
        <p>
          Upload your VHDL and get a review: syntax and structure errors, broken connections, sensitivity-list and latch
          problems, and pipeline checks for your chosen depth. Each finding says where it is and how to fix it.
        </p>
      </header>

      <div className="split">
        <section className="stack" aria-labelledby="up-h">
          <div className="needs-box">
            <strong>What to upload</strong>
            <ul>
              <li>
                All the VHDL files of your design (<code>.vhd</code>, <code>.vhdl</code>), including packages and every
                component — the review checks how files connect to each other.
              </li>
              <li>As a .zip, a folder, or the files themselves. Other files are ignored; .asm test programs are listed so you can open them.</li>
              <li>
                Limits: {REVIEW_LIMITS.files.toLocaleString()} files, {REVIEW_LIMITS.fileBytes / 1024 / 1024} MB each,{" "}
                {REVIEW_LIMITS.zipBytes / 1024 / 1024} MB per .zip. Nothing leaves this browser.
              </li>
            </ul>
          </div>
          <ZipGuide />
          <h2 id="up-h" className="visually-hidden">
            Upload
          </h2>
          <FileDrop
            accept=".zip,application/zip"
            label="Upload a .zip"
            hint="Or drop a .zip or several .vhd files here."
            onFile={(f) => (/\.zip$/i.test(f.name) ? take(f.name, () => readZip(f)) : fromFiles([f], f.name))}
          />
          <div className="btn-row">
            <input
              ref={folderInput}
              type="file"
              multiple
              className="visually-hidden"
              aria-label="Choose a folder"
              onChange={(e) => {
                if (e.target.files?.length) fromFiles(e.target.files, e.target.files[0].webkitRelativePath.split("/")[0] || "Folder");
                e.target.value = "";
              }}
            />
            <button className="btn" onClick={() => folderInput.current?.click()} disabled={busy}>
              Choose a folder
            </button>
            <input
              ref={filesInput}
              type="file"
              multiple
              accept=".vhd,.vhdl,.asm"
              className="visually-hidden"
              aria-label="Choose files"
              onChange={(e) => {
                if (e.target.files?.length) fromFiles(e.target.files, `${e.target.files.length} files`);
                e.target.value = "";
              }}
            />
            <button className="btn" onClick={() => filesInput.current?.click()} disabled={busy}>
              Choose .vhd files
            </button>
            <button className="btn btn--ghost" onClick={sample} disabled={busy}>
              Try the reference processor
            </button>
          </div>
          {busy && <p className="small" aria-live="polite">Reading files…</p>}
          {error && (
            <div className="notice notice--fail" role="alert">
              <span aria-hidden="true">!</span>
              <div>
                <strong>Nothing to review</strong>
                {error}
              </div>
            </div>
          )}
        </section>
        <aside className="panel stack stack--tight" aria-label="Review settings">
          <PipelineSettings />
          <p className="muted xsmall">
            Pipeline checks look for the {geo.registers.length} pipeline registers of a {session.stages}-stage design (
            {geo.registers.join(", ")}). With forwarding allowed they expect a forwarding unit fed from the selected paths; with
            no forwarding they expect a hazard unit that stalls every dependent instruction. Changing a setting re-runs the review.
          </p>
        </aside>
      </div>

      {report && loaded && (
        <section className="section stack" aria-labelledby="res-h">
          <div className="section__head">
            <h2 id="res-h">Review of {loaded.name}</h2>
            <div className="btn-row">
              <button
                className="btn btn--small"
                onClick={() => downloadBlob(`${slug(loaded.name, "code")}-review.md`, reviewToMarkdown(report, loaded.name), "text/markdown")}
              >
                Download report (.md)
              </button>
              <button
                className="btn btn--small btn--ghost"
                onClick={() =>
                  downloadBlob(
                    `${slug(loaded.name, "code")}-review.json`,
                    JSON.stringify({ ...report, findings: report.findings.map((f) => ({ ...f, excerpt: undefined })) }, null, 2),
                    "application/json",
                  )
                }
              >
                JSON
              </button>
            </div>
          </div>

          <div className="review-summary">
            <div>
              <span className="review-summary__n">{report.counts.error}</span>
              <span>errors</span>
            </div>
            <div>
              <span className="review-summary__n">{report.counts.warning}</span>
              <span>warnings</span>
            </div>
            <div>
              <span className="review-summary__n">{report.counts.info}</span>
              <span>notes</span>
            </div>
            <p className="small muted">
              {report.files} files · {report.lines.toLocaleString()} lines · {report.entities} entities · {report.processes} processes ·{" "}
              {report.instances} instances · top level <code>{report.top ?? "?"}</code>
            </p>
          </div>
          <StructureCheck loaded={loaded} report={report} />
          {report.counts.error === 0 && report.counts.warning === 0 && (
            <div className="notice notice--pass" role="status">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>No errors or warnings</strong>
                The notes below are suggestions. Next, check behaviour by running programs in the workbench.
              </div>
            </div>
          )}
          {report.pipeline.inferred && report.pipeline.inferred !== session.stages && (
            <div className="notice notice--probe">
              <span aria-hidden="true">!</span>
              <div>
                <strong>This looks like a {report.pipeline.inferred}-stage design</strong>
                You selected {session.stages} stages.{" "}
                <button className="linkbtn" onClick={() => update({ stages: report.pipeline.inferred! })}>
                  Switch to {report.pipeline.inferred} stages
                </button>
              </div>
            </div>
          )}
          {report.unparsed.length > 0 && (
            <p className="small">
              <Badge tone="fail">Partly reviewed</Badge> {report.unparsed.length} file{report.unparsed.length > 1 ? "s have" : " has"} syntax errors, so
              only those errors are reported for {report.unparsed.length > 1 ? "them" : "it"}. Fix them and upload again.
            </p>
          )}

          <div className="tabs" role="tablist" aria-label="Review views">
            <button role="tab" aria-selected={tab === "findings"} onClick={() => setTab("findings")}>
              Findings ({report.findings.length})
            </button>
            <button role="tab" aria-selected={tab === "overview"} onClick={() => setTab("overview")}>
              Design overview
            </button>
          </div>

          {tab === "findings" && (
            <div className="stack">
              <div className="btn-row review-filters">
                <fieldset className="option-tabs">
                  <legend className="visually-hidden">Severity</legend>
                  {(["all", "error", "warning", "info"] as const).map((v) => (
                    <label key={v} className={`option-tab${sev === v ? " option-tab--on" : ""}`}>
                      <input type="radio" name="sev" checked={sev === v} onChange={() => setSev(v)} />
                      {v === "all" ? `All (${report.findings.length})` : `${SEV_LABEL[v]}s (${report.counts[v]})`}
                    </label>
                  ))}
                </fieldset>
                <label className="field">
                  <span className="visually-hidden">Category</span>
                  <select value={cat} onChange={(e) => setCat(e.target.value as Category | "all")}>
                    <option value="all">All categories</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="visually-hidden">File</span>
                  <select value={file} onChange={(e) => setFile(e.target.value)}>
                    <option value="all">All files</option>
                    {filesWithFindings.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {shown.length === 0 ? (
                <p className="muted small">Nothing matches these filters.</p>
              ) : (
                <ul className="findings-list">
                  {shown.map((f) => (
                    <FindingCard key={f.id} f={f} />
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "overview" && (
            <div className="split split--wide-side">
              <div className="stack">
                <section className="stack stack--tight">
                  <h3>Hierarchy</h3>
                  {report.hierarchy ? (
                    <ul className="tree">
                      <Tree node={report.hierarchy} />
                    </ul>
                  ) : (
                    <p className="muted small">No top-level entity found.</p>
                  )}
                  {report.testbenches.length > 0 && <p className="xsmall muted">Testbenches: {report.testbenches.join(", ")}</p>}
                </section>
                <section className="stack stack--tight">
                  <h3>Pipeline ({session.stages} stages selected)</h3>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th scope="col">Expected</th>
                          <th scope="col">Found</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.pipeline.expected.map((p) => {
                          const hit = report.pipeline.registersFound.find((r) => r.pair === p);
                          return (
                            <tr key={p}>
                              <td>{p} register</td>
                              <td>{hit ? <code>{hit.entity}</code> : <Badge tone="warn">Missing</Badge>}</td>
                            </tr>
                          );
                        })}
                        {report.pipeline.stages.map((s) => (
                          <tr key={s.stage}>
                            <td>{s.stage} stage</td>
                            <td>{s.entity ? <code>{s.entity}</code> : <span className="muted">not a separate entity</span>}</td>
                          </tr>
                        ))}
                        <tr>
                          <td>Forwarding (selected)</td>
                          <td>{report.pipeline.forwarding.description}</td>
                        </tr>
                        <tr>
                          <td>Forwarding paths seen in the code</td>
                          <td>{report.pipeline.forwarding.found.length ? report.pipeline.forwarding.found.join(", ") : <span className="muted">none</span>}</td>
                        </tr>
                        <tr>
                          <td>Forwarding unit</td>
                          <td>
                            {report.pipeline.forwardingUnit ? (
                              <code>{report.pipeline.forwardingUnit}</code>
                            ) : report.pipeline.forwarding.selected.length ? (
                              <Badge tone="warn">Missing</Badge>
                            ) : (
                              <span className="muted">not expected (no forwarding)</span>
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td>Hazard unit</td>
                          <td>{report.pipeline.hazardUnit ? <code>{report.pipeline.hazardUnit}</code> : <Badge tone="warn">Missing</Badge>}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
              <div className="stack">
                <section className="panel stack stack--tight">
                  <h3>Compile order</h3>
                  <p className="muted xsmall">Dependencies first, top level last. {report.compileOrderNote}</p>
                  <ol className="compile-order mono xsmall">
                    {report.compileOrder.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ol>
                  <button
                    className="btn btn--small"
                    onClick={() => {
                      update({ compileOrder: report.compileOrder });
                      toast("The hardware kit will compile these files in this order.");
                    }}
                  >
                    Use this order in the hardware kit
                  </button>
                  <p className="muted xsmall">Paths are relative to the folder that holds them all — point the kit&apos;s RTL folder there.</p>
                </section>
                {loaded.programs.length > 0 && (
                  <section className="panel stack stack--tight">
                    <h3>Test programs found</h3>
                    <ul className="plain-list">
                      {loaded.programs.map((p) => (
                        <li key={p.path} className="btn-row">
                          <code className="xsmall">{p.path}</code>
                          <button className="btn btn--small btn--ghost" onClick={() => openProgram(p)}>
                            Open in the workbench
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {loaded.skipped.length > 0 && (
                  <details className="panel">
                    <summary className="small">{loaded.skipped.length} files skipped</summary>
                    <ul className="xsmall plain-list">
                      {loaded.skipped.slice(0, 50).map((s) => (
                        <li key={s.path}>
                          <code>{s.path}</code> — {s.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          )}
          <p className="muted xsmall">
            Static analysis can&apos;t see everything: logic bugs show up when you run programs. Continue in the{" "}
            <Link href="/workbench/program">workbench</Link> to simulate and compare.
          </p>
        </section>
      )}
    </div>
  );
}

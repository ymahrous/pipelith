"use client";

import { HDL_INFO, type Hdl } from "@/lib/hdl";
import { restructurePrompt } from "@/lib/review/aiPrompt";
import { REVIEW_LIMITS } from "@/lib/review/intake";
import { useWorkbench } from "../SessionProvider";
import { AiPromptPanel } from "./AiPromptPanel";

const TREES: Record<Hdl, string> = {
  vhdl: `my-cpu.zip
└── my-cpu/                     one top folder is fine — it is removed
    ├── rtl/                    any folder names, any depth
    │   ├── cpu_pkg.vhd         packages: required if any file says "use work.cpu_pkg"
    │   ├── alu.vhd             one entity per file, named after the entity
    │   ├── register_file.vhd
    │   ├── pipeline/
    │   │   ├── if_id_register.vhd
    │   │   ├── id_ex_register.vhd      names like these let the pipeline
    │   │   ├── ex_mem_register.vhd     checks find your stage registers
    │   │   └── mem_wb_register.vhd
    │   ├── stages/
    │   │   ├── fetch_stage.vhd
    │   │   └── …
    │   ├── forwarding_unit.vhd
    │   ├── hazard_unit.vhd
    │   └── cpu.vhd             top level: instantiates everything else
    ├── tb/
    │   └── tb_cpu.vhd          optional: testbenches (entities without ports)
    └── programs/
        └── test1.asm           optional: listed so you can open them`,
  verilog: `my-cpu.zip
└── my-cpu/                     one top folder is fine — it is removed
    ├── rtl/                    any folder names, any depth
    │   ├── cpu_defs.vh         headers: required if any file says \`include "cpu_defs.vh"
    │   ├── alu.v               one module per file, named after the module
    │   ├── register_file.v
    │   ├── pipeline/
    │   │   ├── if_id_register.v
    │   │   ├── id_ex_register.v        names like these let the pipeline
    │   │   ├── ex_mem_register.v       checks find your stage registers
    │   │   └── mem_wb_register.v
    │   ├── stages/
    │   │   ├── fetch_stage.v
    │   │   └── …
    │   ├── forwarding_unit.v
    │   ├── hazard_unit.v
    │   └── cpu.v               top level: instantiates everything else
    ├── tb/
    │   └── tb_cpu.v            optional: testbenches (modules without ports)
    └── programs/
        └── test1.asm           optional: listed so you can open them`,
  systemverilog: `my-cpu.zip
└── my-cpu/                     one top folder is fine — it is removed
    ├── rtl/                    any folder names, any depth
    │   ├── cpu_pkg.sv          packages: required if any file says "import cpu_pkg::*"
    │   ├── cpu_defs.svh        headers: required if any file \`includes them
    │   ├── alu.sv              one module per file, named after the module
    │   ├── register_file.sv
    │   ├── pipeline/
    │   │   ├── if_id_register.sv
    │   │   ├── id_ex_register.sv       names like these let the pipeline
    │   │   ├── ex_mem_register.sv      checks find your stage registers
    │   │   └── mem_wb_register.sv
    │   ├── forwarding_unit.sv
    │   ├── hazard_unit.sv
    │   └── cpu.sv              top level: instantiates everything else
    ├── tb/
    │   └── tb_cpu.sv           optional: testbenches (modules without ports)
    └── programs/
        └── test1.asm           optional: listed so you can open them`,
};

const SAMPLE: Record<Hdl, { href: string; label: string }> = {
  vhdl: { href: "/samples/reference-rtl.zip", label: "the 6-stage VHDL reference processor" },
  verilog: { href: "/samples/reference-rtl-verilog.zip", label: "the 5-stage Verilog reference processor" },
  systemverilog: { href: "/samples/reference-rtl-systemverilog.zip", label: "the 5-stage SystemVerilog reference processor" },
};

/** Explicit instructions for what a Code review upload must look like, for the selected language. */
export function ZipGuide({ open = false }: { open?: boolean }) {
  const { session } = useWorkbench();
  const hdl = session.hdl;
  const info = HDL_INFO[hdl];
  const exts = [...info.extensions, ...info.headers].join(", ");
  const unit = info.unit;
  return (
    <details className="panel zip-guide" open={open}>
      <summary className="small">
        <strong>How to structure your .zip</strong> — what to include, what is ignored, and how to make one ({info.label})
      </summary>
      <div className="stack section">
        <p className="small">
          The review reads every {info.label} file and works out how they connect, so the upload must contain the{" "}
          <strong>whole design</strong>. The folder layout is up to you. A layout like this works (choose another language at
          the top of the page to see its version):
        </p>
        <pre className="code-block zip-tree" aria-label="Example folder structure">
          {TREES[hdl]}
        </pre>
        <div className="split">
          <section className="stack stack--tight">
            <h3>Must be included</h3>
            <ol className="small prose">
              {hdl === "vhdl" ? (
                <li>
                  <strong>Every .vhd or .vhdl file the design needs</strong>: all entities and architectures, every component
                  you instantiate, and every package you <code>use work.…</code>. Missing ones are reported as “… isn&apos;t
                  defined” or “Package … is not in the upload”.
                </li>
              ) : (
                <li>
                  <strong>Every {exts} file the design needs</strong>: every module{hdl === "systemverilog" ? ", interface and package" : ""} you
                  instantiate{hdl === "systemverilog" ? " or import" : ""}, and every header you <code>`include</code> (any folder —
                  the review finds headers by name). Missing ones are reported as “… isn&apos;t defined”
                  {hdl === "systemverilog" ? ", “Package … is not in the upload”" : ""} or “Include file … is not in the upload”.
                </li>
              )}
              <li>
                <strong>One design per .zip.</strong> Two copies of an {unit} (an old version in a backup folder, for example) are
                reported as “defined twice”.
              </li>
              <li>
                <strong>Plain-text sources</strong> in UTF-8 or ASCII. Each file at most {REVIEW_LIMITS.fileBytes / 1024 / 1024} MB.
              </li>
            </ol>
            <h3>Recommended</h3>
            <ul className="small prose">
              <li>
                One {unit} per file, with the file named after it (<code>alu{info.extensions[0]}</code> holds {unit} <code>alu</code>).
              </li>
              <li>
                Pipeline registers named after the stages they sit between — <code>if_id</code>, <code>id_ex</code> /{" "}
                <code>id_ex1</code>, <code>ex1_ex2</code>, <code>ex_mem</code> / <code>ex2_mem</code>, <code>mem_wb</code> — and
                units named <code>…forward…</code> and <code>…hazard…</code>.
              </li>
              <li>Testbenches and .asm programs may be included; they are recognised and kept apart.</li>
              <li>Mixed-language designs are fine: VHDL, Verilog and SystemVerilog files are reviewed together.</li>
            </ul>
          </section>
          <section className="stack stack--tight">
            <h3>Ignored automatically</h3>
            <ul className="small prose">
              <li>
                Simulator and tool output: <code>work/</code>, <code>xsim.dir/</code>, <code>.Xil/</code>, <code>db/</code>,{" "}
                <code>incremental_db/</code>, <code>obj_dir/</code>, <code>sim_build/</code>
              </li>
              <li>
                <code>.git/</code>, <code>node_modules/</code>, <code>__MACOSX/</code>
              </li>
              <li>Everything that isn&apos;t an HDL source (.vhd, .vhdl, .vho, .v, .vh, .sv, .svh), .asm or .s — docs, images, scripts, .mem files</li>
            </ul>
            <h3>Not supported</h3>
            <ul className="small prose">
              <li>A .zip inside the .zip — unpack it first</li>
              <li>Password-protected archives, Zip64 archives and compression other than Deflate or Store (.7z, .rar)</li>
              <li>
                More than {REVIEW_LIMITS.files.toLocaleString()} source files, {REVIEW_LIMITS.entries.toLocaleString()} archive
                entries or {REVIEW_LIMITS.zipBytes / 1024 / 1024} MB per .zip
              </li>
            </ul>
          </section>
        </div>
        <section className="stack stack--tight">
          <h3>Making the .zip</h3>
          <ul className="small prose">
            <li>
              <strong>Windows:</strong> right-click the project folder → <em>Send to</em> → <em>Compressed (zipped) folder</em>.
            </li>
            <li>
              <strong>macOS:</strong> right-click the folder → <em>Compress “my-cpu”</em>.
            </li>
            <li>
              <strong>Linux or WSL:</strong>{" "}
              <code>
                zip -r my-cpu.zip my-cpu -i {info.zipGlobs.map((g) => `'${g}'`).join(" ")}
              </code>
            </li>
            <li>
              <strong>Or don&apos;t zip at all:</strong> use <em>Choose a folder</em> and pick the project folder.
            </li>
          </ul>
          <p className="small">
            <a href={SAMPLE[hdl].href} download>
              Download {SAMPLE[hdl].label} (.zip)
            </a>{" "}
            to see a layout that works.
          </p>
        </section>
        <section className="stack stack--tight">
          <h3>Paths and the hardware kit</h3>
          <p className="small">
            The folder shared by all files is removed, so <code>my-cpu/rtl/alu{info.extensions[0]}</code> appears as{" "}
            <code>alu{info.extensions[0]}</code> if everything lives under <code>my-cpu/rtl/</code>. The compile order uses these
            shortened paths — point the hardware kit&apos;s <em>RTL folder</em> at that shared folder.
          </p>
        </section>
        <section className="stack stack--tight">
          <h3>Not sure how to reorganise your project?</h3>
          <p className="small">
            Copy this prompt into an AI assistant, paste your file list where it says so, and ask it to do the sorting. After an
            upload, the structure check offers the same prompt with your file names already filled in.
          </p>
          <AiPromptPanel title="Ask an AI assistant to organise your files" prompt={restructurePrompt({ hdl, depth: session.stages, paths: null, problems: [] })} />
        </section>
      </div>
    </details>
  );
}

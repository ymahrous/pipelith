import { REVIEW_LIMITS } from "@/lib/review/intake";

const TREE = `my-cpu.zip
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
        └── test1.asm           optional: listed so you can open them`;

/** Explicit instructions for what a Code review upload must look like. */
export function ZipGuide({ open = false }: { open?: boolean }) {
  return (
    <details className="panel zip-guide" open={open}>
      <summary className="small">
        <strong>How to structure your .zip</strong> — what to include, what is ignored, and how to make one
      </summary>
      <div className="stack section">
        <p className="small">
          The review reads every VHDL file and works out how they connect, so the upload must contain the{" "}
          <strong>whole design</strong>. The folder layout is up to you. A layout like this works:
        </p>
        <pre className="code-block zip-tree" aria-label="Example folder structure">
          {TREE}
        </pre>
        <div className="split">
          <section className="stack stack--tight">
            <h3>Must be included</h3>
            <ol className="small prose">
              <li>
                <strong>Every .vhd or .vhdl file the design needs</strong>: all entities and architectures, every component
                you instantiate, and every package you <code>use work.…</code>. Missing ones are reported as “… isn&apos;t
                defined” or “Package … is not in the upload”.
              </li>
              <li>
                <strong>One design per .zip.</strong> Two copies of an entity (an old version in a backup folder, for example)
                are reported as “defined twice”.
              </li>
              <li>
                <strong>Plain-text sources</strong> in UTF-8 or ASCII. Each file at most{" "}
                {REVIEW_LIMITS.fileBytes / 1024 / 1024} MB.
              </li>
            </ol>
            <h3>Recommended</h3>
            <ul className="small prose">
              <li>One entity per file, with the file named after the entity (<code>alu.vhd</code> holds <code>entity alu</code>).</li>
              <li>
                Pipeline registers named after the stages they sit between — <code>if_id</code>, <code>id_ex</code> /{" "}
                <code>id_ex1</code>, <code>ex1_ex2</code>, <code>ex_mem</code> / <code>ex2_mem</code>, <code>mem_wb</code> — and
                units named <code>…forward…</code> and <code>…hazard…</code>.
              </li>
              <li>Testbenches and .asm programs may be included; they are recognised and kept apart.</li>
            </ul>
          </section>
          <section className="stack stack--tight">
            <h3>Ignored automatically</h3>
            <ul className="small prose">
              <li>
                Simulator and tool output: <code>work/</code>, <code>xsim.dir/</code>, <code>.Xil/</code>, <code>db/</code>,{" "}
                <code>incremental_db/</code>
              </li>
              <li>
                <code>.git/</code>, <code>node_modules/</code>, <code>__MACOSX/</code>
              </li>
              <li>Everything that isn&apos;t .vhd, .vhdl, .vho, .asm or .s — docs, images, scripts, .mem files</li>
              <li>Verilog and SystemVerilog (.v, .sv): listed as skipped, not reviewed yet</li>
            </ul>
            <h3>Not supported</h3>
            <ul className="small prose">
              <li>A .zip inside the .zip — unpack it first</li>
              <li>Password-protected archives, Zip64 archives and compression other than Deflate or Store (.7z, .rar)</li>
              <li>
                More than {REVIEW_LIMITS.files.toLocaleString()} VHDL files, {REVIEW_LIMITS.entries.toLocaleString()} archive
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
              <strong>Linux or WSL:</strong> <code>zip -r my-cpu.zip my-cpu -i &apos;*.vhd&apos; &apos;*.vhdl&apos; &apos;*.asm&apos;</code>
            </li>
            <li>
              <strong>Or don&apos;t zip at all:</strong> use <em>Choose a folder</em> and pick the project folder.
            </li>
          </ul>
          <p className="small">
            <a href="/samples/reference-rtl.zip" download>
              Download the reference processor&apos;s .zip
            </a>{" "}
            to see a layout that works.
          </p>
        </section>
        <section className="stack stack--tight">
          <h3>Paths and the hardware kit</h3>
          <p className="small">
            The folder shared by all files is removed, so <code>my-cpu/rtl/alu.vhd</code> appears as <code>alu.vhd</code> if
            everything lives under <code>my-cpu/rtl/</code>. The compile order uses these shortened paths — point the hardware
            kit&apos;s <em>RTL folder</em> at that shared folder.
          </p>
        </section>
      </div>
    </details>
  );
}

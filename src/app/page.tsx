import Link from "next/link";
import { STEPS } from "@/components/steps";
import { GOALS, REVIEW_OPTION } from "@/components/goals";
import { JsonLd } from "@/components/JsonLd";
import { QuickStart } from "@/components/QuickStart";
import { SITE } from "@/lib/site";

/** Bus-style waveform segment (hexagonal transitions), as drawn by logic analyzers. */
function bus(x0: number, x1: number, y: number, h: number) {
  const s = 6;
  return `M${x0},${y + h / 2} L${x0 + s},${y} L${x1 - s},${y} L${x1},${y + h / 2} L${x1 - s},${y + h} L${x0 + s},${y + h} Z`;
}

const MODEL = [
  { x0: 70, x1: 190, v: "00000000" },
  { x0: 190, x1: 330, v: "00000005" },
  { x0: 330, x1: 552, v: "00000019" },
];
const HW = [
  { x0: 70, x1: 190, v: "00000000" },
  { x0: 190, x1: 330, v: "00000005" },
  { x0: 330, x1: 552, v: "00000000", bad: true },
];

function Scope() {
  return (
    <figure className="scope" aria-labelledby="scope-cap">
      <div className="scope__legend" aria-hidden="true">
        <span>
          <i className="legend-model" />
          Reference model
        </span>
        <span>
          <i className="legend-hw" />
          Your hardware
        </span>
      </div>
      <svg className="wave" viewBox="0 0 560 176" role="img" aria-label="Register R1 over time: the model goes 0, 5, 19; the hardware goes 0, 5, 0. They diverge at POP R1.">
        <g fill="#9cbdb5">
          <text x="0" y="44">
            R1 model
          </text>
          <text x="0" y="112">
            R1 hw
          </text>
        </g>
        {/* clock ticks */}
        <g stroke="#9cbdb5" strokeOpacity="0.25">
          {Array.from({ length: 13 }, (_, i) => (
            <line key={i} x1={70 + i * 40} x2={70 + i * 40} y1="10" y2="146" />
          ))}
        </g>
        {MODEL.map((s, i) => (
          <g key={"m" + i}>
            <path className="scope__trace" d={bus(s.x0, s.x1, 26, 26)} fill="none" stroke="#48c787" strokeWidth="1.6" />
            <text x={(s.x0 + s.x1) / 2} y="43" textAnchor="middle" fill="#e6f0ec">
              {s.v}
            </text>
          </g>
        ))}
        {HW.map((s, i) => (
          <g key={"h" + i}>
            <path
              className="scope__trace scope__trace--late"
              d={bus(s.x0, s.x1, 94, 26)}
              fill={s.bad ? "rgba(255,107,91,0.14)" : "none"}
              stroke={s.bad ? "#ff6b5b" : "#e3a21a"}
              strokeWidth="1.6"
            />
            <text
              x={(s.x0 + s.x1) / 2}
              y="111"
              textAnchor="middle"
              fill={s.bad ? "#ffb4aa" : "#e6f0ec"}
            >
              {s.v}
            </text>
          </g>
        ))}
        <g className="scope__marker">
          <line x1="330" x2="330" y1="8" y2="150" stroke="#e3a21a" strokeWidth="1.5" strokeDasharray="3 3" />
          <rect x="336" y="140" width="178" height="22" rx="3" fill="#e3a21a" />
          <text x="344" y="155" fill="#1d1400">
            first divergence: POP R1
          </text>
        </g>
      </svg>
      <figcaption id="scope-cap">
        R1 in the project&apos;s own Memory.asm test, simulated in GHDL. The model pops 19; the RTL pops 0, because its
        PUSH stores R0 instead of the named register.
      </figcaption>
    </figure>
  );
}

const STEP_TEXT: Record<string, string> = {
  program: "Load one of the bundled tests, an .asm or .mem file, or write your own.",
  assemble: "Bit-exact with the project's assembler, plus warnings for silent mistakes.",
  simulate: "Step through the reference ISA model; set IN values, interrupts and options.",
  check: "Comments such as #R1=5 or C --> 1 become checks automatically.",
  compare: "Download a testbench, run GHDL or ModelSim, drop in wave.vcd.",
  report: "Export Markdown or JSON, or share the setup as a link.",
};

export default function Home() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: SITE.name,
          url: SITE.url + "/",
          description: SITE.description,
          alternateName: `${SITE.name} — ${SITE.tagline}`,
          slogan: SITE.tagline,
          image: SITE.url + "/opengraph-image.png",
          applicationCategory: "DeveloperApplication",
          applicationSubCategory: "Hardware design verification",
          operatingSystem: "Any (web browser)",
          browserRequirements: "Requires a modern browser with JavaScript",
          isAccessibleForFree: true,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          license: "https://opensource.org/licenses/MIT",
          author: { "@type": "Person", name: SITE.author },
          featureList: [
            "VHDL code review with suggested fixes",
            "5- and 6-stage pipeline support with configurable forwarding",
            "Assembler compatible with the reference assembler",
            "Reference instruction-set model with time-travel stepping",
            "Pipeline timing estimate and diagram",
            "VCD waveform and final-register comparison",
            "GHDL and ModelSim testbench generation",
            "Runs entirely in the browser, no account",
          ],
        }}
      />
      <section className="hero" aria-labelledby="hero-h">
        <div>
          <p className="hero__eyebrow">
            <strong>{SITE.name}</strong> · {SITE.tagline}
          </p>
          <h1 id="hero-h">Find where your processor stops agreeing with its ISA.</h1>
          <p className="hero__lede">
            Run a program on a reference model of the instruction set, simulate your VHDL with a generated testbench, and
            see the first register, flag or fetch where the two part ways.
          </p>
          <div className="btn-row">
            <Link className="btn btn--primary" href="/try">
              Run the demo
            </Link>
            <Link className="btn" href="/review">
              Review my code
            </Link>
            <Link className="btn btn--ghost" href="/workbench/program">
              Open the workbench
            </Link>
          </div>
          <p className="muted small hero__fine">
            The demo needs no files and shows results in one click. No account; works with 5- and 6-stage designs; everything
            runs in this browser tab.
          </p>
        </div>
        <Scope />
      </section>

      <section className="band band--quick" aria-label="Open your files">
        <div className="band__inner band__inner--single">
          <QuickStart />
        </div>
      </section>

      <section className="band" aria-labelledby="what-h">
        <div className="band__inner">
          <h2 id="what-h">What is Pipelith?</h2>
          <p className="definition">
            Pipelith is a free, browser-based tool for students and engineers who build pipelined RISC processors
            in VHDL. It reviews your code and suggests fixes, runs programs on a reference model of the instruction set,
            estimates how many cycles your 5- or 6-stage pipeline should take with the forwarding you have, and compares your
            simulator&apos;s waveform with the model to pinpoint the first wrong register, flag or fetch. No account is
            needed and your files stay on your device.
          </p>
        </div>
      </section>

      <section className="band" aria-labelledby="needs-h">
        <div className="band__inner">
          <div className="stack stack--tight">
            <h2 id="needs-h">What you need</h2>
            <p className="muted small">Pick one when you open the workbench. You can switch at any time.</p>
          </div>
          <ul className="flow">
            {[...GOALS, { id: "review", ...REVIEW_OPTION }].map((g) => (
              <li key={g.id}>
                <strong>{g.id === "review" ? <Link href="/review">{g.title}</Link> : g.title}</strong>
                <span>{g.blurb}</span>
                <ul className="needs-list">
                  {g.needs.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="band" aria-labelledby="flow-h">
        <div className="band__inner">
          <div className="stack stack--tight">
            <h2 id="flow-h">Six steps, one pass</h2>
            <p className="muted small">Each step feeds the next, and you can jump back to any of them at any time.</p>
          </div>
          <ol className="flow">
            {STEPS.map((s, i) => (
              <li key={s.slug}>
                <strong>
                  <span>{i + 1}</span>
                  <Link href={`/workbench/${s.slug}`}>{s.label}</Link>
                </strong>
                {STEP_TEXT[s.slug]}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="band" aria-labelledby="found-h">
        <div className="band__inner">
          <div className="stack stack--tight">
            <h2 id="found-h">What it found in the reference design</h2>
            <p className="muted small">Running the 6-stage RISC project&apos;s four test programs through the workbench.</p>
          </div>
          <ul className="findings">
            <li>
              <span className="file">Memory.asm</span>
              <span>PUSH writes R0 to the stack instead of the pushed register, so every POP returns 0.</span>
            </li>
            <li>
              <span className="file">Branch.asm</span>
              <span>
                After the first taken JZ, the fetch PC jumps to 0x10000000 — the encoding of the next instruction — and runs
                off the end of memory.
              </span>
            </li>
            <li>
              <span className="file">OneOperand.asm</span>
              <span>IN and SETC change Z and N, although the ISA says they leave them alone.</span>
            </li>
            <li>
              <span className="file">TwoOperand.asm</span>
              <span>
                The hardware matches the model exactly. The test&apos;s own comment for MOV R3, R5 assumes the opposite operand
                order from the ISA.
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section className="band" aria-labelledby="priv-h">
        <div className="band__inner">
          <h2 id="priv-h">Private by design</h2>
          <div className="prose small muted">
            <p>
              There are no accounts, no cookies and no server-side processing. Code, programs, waveforms and reports are read
              and produced in your browser; share links keep the program in the part of the URL that browsers never send to
              a server. On Vercel, anonymous cookieless page-view and speed counts are kept — you can switch them off.{" "}
              <Link href="/privacy">Privacy policy</Link>.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

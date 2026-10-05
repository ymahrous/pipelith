import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/DocPage";
import { CHECKS_EXAMPLE } from "@/lib/content/checksExample";

const DESCRIPTION =
  "Every assembly comment Pipelith turns into an automatic check: register, SP, memory and flag values, flags unchanged, never-executed lines, taken branches and IN-port values.";

export const metadata: Metadata = {
  title: "Check comments",
  description: DESCRIPTION,
  alternates: { canonical: "/docs/checks" },
};

const ROWS: [string, string, string][] = [
  ["R0–R7", "#R1=5   #R2 = 0001_0018", "Register value after the line runs. Hex; underscores are ignored."],
  ["SP", "#SP=FFE", "Stack pointer after the line."],
  ["Memory", "#M[FFF]=300", "Memory word at an address after the line."],
  ["One flag", "#Z=1   #C --> 0   #N -> 1", "Flag value after the line. =, -> and --> all work; the letter must be a capital Z, N or C."],
  ["One flag unchanged", "#C --> no change", "That flag keeps the value it had before the line."],
  ["All flags unchanged", "#flags no change   #flags unchanged", "Used only when the comment names no single flag."],
  ["Never runs", "#this statement shouldn't be executed", "Fails if the line ever executes. Other values on the same line are ignored. “should not be executed until…” is not a check."],
  ["Branch taken", "#Jump taken   #not taken", "Only on JZ, JN, JC and JMP lines."],
];

export default function ChecksPage() {
  return (
    <DocPage
      path="/docs/checks"
      title="Check comments"
      description={DESCRIPTION}
      lede="Write the expected result after an instruction, as test authors already do, and Pipelith checks it against the reference model."
    >
      <section className="stack stack--tight" aria-labelledby="ex-h">
        <h2 id="ex-h">Example</h2>
        <pre className="code-block">{CHECKS_EXAMPLE}</pre>
      </section>

      <section className="stack stack--tight" aria-labelledby="syn-h">
        <h2 id="syn-h">Syntax</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Checks</th>
                <th scope="col">Write</th>
                <th scope="col">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([what, write, meaning]) => (
                <tr key={what}>
                  <th scope="row">{what}</th>
                  <td className="mono small">{write}</td>
                  <td className="small">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack stack--tight prose" aria-labelledby="rules-h">
        <h2 id="rules-h">Rules</h2>
        <ul>
          <li>Comments start with <code>#</code>, <code>;</code> or <code>{"//"}</code>. Several checks can share one comment, separated by commas or spaces.</li>
          <li>All numbers are hexadecimal, with or without leading zeros.</li>
          <li>Checks belong to instruction lines only; comments on <code>.ORG</code> lines and data words are ignored.</li>
          <li>Each check is evaluated right after the <strong>first</strong> time its line executes.</li>
          <li>
            Text after <code> OR </code> is ignored, so <code>#R2=00010018 OR R2=18 if sign-extended</code> checks the first value. Pick the
            behaviour you want under <Link href="/workbench/simulate">Simulate › Model options</Link>.
          </li>
        </ul>
      </section>

      <section className="stack stack--tight prose" aria-labelledby="in-h">
        <h2 id="in-h">IN-port values</h2>
        <p>
          On an <code>IN</code> line, the value in the comment is what the IN port supplies — both to the model and to the generated
          testbench. All of these give 30: <code>#R1=30</code>, <code>#add 30 in R1</code>, <code>#30</code>. Override them in{" "}
          <Link href="/workbench/simulate">Simulate</Link>.
        </p>
      </section>

      <section className="stack stack--tight prose" aria-labelledby="own-h">
        <h2 id="own-h">Checks without comments</h2>
        <p>
          In the <Link href="/workbench/check">Check</Link> step you can add checks on the final state — any register, SP, a memory word,
          a flag or the OUT port — and turn individual comment checks off. They are saved with the session and travel in share links.
        </p>
      </section>
    </DocPage>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "License",
  description:
    "Pipelith is free software under the MIT License.",
  alternates: { canonical: "/license" },
};

const YEAR = 2026;

export default function LicensePage() {
  return (
    <div className="step">
      <header className="step-head">
        <h1>MIT License</h1>
        <p>
          Pipelith is free and open source. You may use, copy, change and redistribute it, including
          commercially, as long as the notice below stays with it.
        </p>
      </header>
      <pre className="code-block license-text">{`MIT License

Copyright (c) ${YEAR} Yousef Mahrous

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`}</pre>
      <section className="section prose small">
        <h2>Third-party material</h2>
        <ul>
          <li>
            Bundled test programs and sample waveforms come from the{" "}
            <a href="https://github.com/ymahrous/risc-pipelined-processor" rel="noopener noreferrer">
              risc-pipelined-processor
            </a>{" "}
            project (MIT).
          </li>
          <li>Fonts: Archivo and JetBrains Mono (SIL Open Font License 1.1), served from this site.</li>
          <li>Next.js and React (MIT).</li>
        </ul>
        <p>
          <Link href="/">Home</Link>
        </p>
      </section>
    </div>
  );
}

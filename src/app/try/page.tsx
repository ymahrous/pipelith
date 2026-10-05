import type { Metadata } from "next";
import { TryDemo } from "@/components/TryDemo";

export const metadata: Metadata = {
  title: "Run the demo",
  description: "See Pipelith find a real bug in one click: the bundled Memory test compared against a GHDL waveform of the reference processor.",
  alternates: { canonical: "/try" },
  robots: { index: false, follow: true },
};

export default function TryPage() {
  return (
    <div className="step">
      <header className="step-head">
        <h1>Run the demo</h1>
        <p>The bundled Memory test, compared with a GHDL simulation of the reference processor. No files needed.</p>
      </header>
      <TryDemo />
    </div>
  );
}

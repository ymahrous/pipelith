import type { Metadata } from "next";
import { CompareStep } from "@/components/steps-ui/CompareStep";

export const metadata: Metadata = {
  title: "Compare",
  description: "Compare your VHDL simulation waveform or final register values with the reference model and find the first divergence.",
  alternates: { canonical: "/workbench/compare" },
};

export default function Page() {
  return <CompareStep />;
}
